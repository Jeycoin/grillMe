/**
 * 面试编排器：一场面试的生命周期
 *
 * 负责：拼装人格 prompt、维护阶段推进、流式产出面试官的话、收尾打分、沉淀记忆。
 */
import { EventEmitter } from 'node:events'
import { streamChat, chat } from '../providers/index.js'
import { ROLE_DEFAULTS } from '../config.js'
import {
  buildSystemPrompt,
  buildOpeningInstruction,
  buildReportPrompt,
  buildStageJudgePrompt,
  STAGES,
  stagePlanFor,
  stageWeight,
  MODE_BY_ID,
  SCENE_BY_ID,
} from './persona.js'
import { absorbReport, newSessionId, saveSession, getMemory, getProfile } from '../memory/store.js'

/** 每个阶段至少问满几轮才允许推进，防止模型急着跳阶段 */
const MIN_TURNS_PER_STAGE = {
  warmup: 1,
  resume: 3,
  knowledge: 3,
  design: 2,
  coding: 2,
  behavior: 2,
  reverse: 1,
}

/** 本场计划里的下一阶段（计划跑完就进收尾） */
function nextStageIn(plan, stage) {
  const idx = plan.indexOf(stage)
  if (idx < 0 || idx >= plan.length - 1) return 'report'
  return plan[idx + 1]
}

/**
 * 两句话的相似度（字符 2-gram Jaccard）。
 * 用来检测面试官是否卡在同一个问题上反复追问 —— 高压模式下模型很容易钻进死胡同。
 */
function similarity(a, b) {
  const norm = (s) => String(s || '').replace(/[\s，。？！、,.?!；;：:'"“”‘’()（）]/g, '')
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const grams = (s) => {
    const g = new Set()
    for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2))
    return g
  }
  const gx = grams(x)
  const gy = grams(y)
  let inter = 0
  for (const g of gx) if (gy.has(g)) inter++
  const union = gx.size + gy.size - inter
  return union > 0 ? inter / union : 0
}

/**
 * 题库可能有几百道题，但 system prompt 里只带得动 60 道。
 * 之前是直接 slice(0,60)，等于"永远只考最新的那一批"；
 * 题库一旦做大（比如导进来一整本八股 PDF），后面的题永远轮不到。
 * 这里改成每场面试抽一批：题少时全带上，题多时随机取样，场场不重样。
 */
const MATERIAL_IN_PROMPT = 60

function pickMaterial(list, n = MATERIAL_IN_PROMPT) {
  const arr = Array.isArray(list) ? list.filter((q) => q && q.question) : []
  if (arr.length <= n) return arr
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, n)
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

export class InterviewSession extends EventEmitter {
  constructor(opts = {}) {
    super()
    this.id = opts.id || newSessionId()
    this.startedAt = new Date().toISOString()
    this.endedAt = null
    this.pressure = opts.pressure ?? 2
    this.archetype = opts.archetype || 'tech'
    this.brain = opts.brain || ROLE_DEFAULTS.brain
    this.quick = opts.quick || ROLE_DEFAULTS.quick
    this.profile = opts.profile || getProfile()

    // ---- 本场定制：考法 / 业务场景 / 时长 / 要不要开场自我介绍 ----
    this.mode = MODE_BY_ID[opts.mode] ? opts.mode : 'full'
    this.scene = SCENE_BY_ID[opts.scene] ? opts.scene : 'general'
    this.durationMin = clamp(Number(opts.durationMin) || 30, 5, 180)
    this.selfIntro = opts.selfIntro !== false
    this.plan = stagePlanFor(this.mode, { selfIntro: this.selfIntro })
    this.stage = this.plan[0]
    this.stageTurns = 0
    this.stageStartedAt = Date.now()

    this.materialTotal = Array.isArray(opts.material) ? opts.material.length : 0
    this.material = pickMaterial(opts.material || []) // 外部面经题目（每场随机取样）
    this.useMemory = opts.useMemory !== false
    this.history = [] // [{ role, content }] 原始对话
    this.transcript = [] // [{ q, a, stage, at }]
    this.report = null
    this.busy = false
    this.forcedMove = false // 卡壳后强制换话题
    this.forcedStage = false // 换阶段后强制切话题
  }

  /* ---------------- 时间预算 ---------------- */

  elapsedMin() {
    return (Date.now() - new Date(this.startedAt).getTime()) / 60000
  }

  /** 距离本场结束还剩多少分钟（可能为负，表示已超时） */
  timeLeftMin() {
    return this.durationMin - this.elapsedMin()
  }

  /** 当前阶段分到的时间（按阶段的默认分钟数占比切分本场时长） */
  stageBudgetMin(stage = this.stage) {
    const total = this.plan.reduce((n, s) => n + stageWeight(s), 0) || 1
    return (this.durationMin * stageWeight(stage)) / total
  }

  get memory() {
    return this.useMemory ? getMemory() : null
  }

  /** 组装本轮 system prompt */
  buildPrompt() {
    return buildSystemPrompt({
      stage: this.stage,
      pressure: this.pressure,
      archetype: this.archetype,
      profile: this.profile,
      memory: this.memory,
      material: this.material,
      mode: this.mode,
      scene: this.scene,
      durationMin: this.durationMin,
      timeLeftMin: Math.max(0, Math.round(this.timeLeftMin())),
    })
  }

  /** 生成会话的最小持久化快照 */
  snapshot() {
    return {
      id: this.id,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      stage: this.stage,
      pressure: this.pressure,
      archetype: this.archetype,
      mode: this.mode,
      scene: this.scene,
      durationMin: this.durationMin,
      selfIntro: this.selfIntro,
      brain: this.brain,
      quick: this.quick,
      profile: this.profile,
      materialCount: this.materialTotal ?? this.material.length,
      transcript: this.transcript,
      report: this.report,
    }
  }

  persist() {
    saveSession(this.snapshot())
  }

  stageInfo() {
    const s = STAGES.find((x) => x.id === this.stage)
    const m = MODE_BY_ID[this.mode]
    return {
      id: this.stage,
      name: s?.name || this.stage,
      turns: this.stageTurns,
      mode: this.mode,
      modeName: m?.name || this.mode,
      scene: this.scene,
      durationMin: this.durationMin,
      startedAt: this.startedAt,
      timeLeftMin: Math.max(0, Math.round(this.timeLeftMin())),
      plan: this.plan,
    }
  }

  stageName() {
    return STAGES.find((x) => x.id === this.stage)?.name || this.stage
  }

  /**
   * 卡壳检测：最近三问两两相似度都超过阈值，说明钻进死胡同了。
   */
  detectStuck(latest) {
    const qs = this.transcript.map((t) => t.q)
    const n = qs.length
    if (n < 3) return
    const s1 = similarity(qs[n - 1], qs[n - 2])
    const s2 = similarity(qs[n - 2], qs[n - 3])
    if (s1 > 0.58 && s2 > 0.58) {
      this.forcedMove = true
    }
  }

  /**
   * 面试官开口。userText 为空表示这是开场（面试官先说话）。
   * yields: {type:'delta'|'stage'|'turn'|'error', ...}
   */
  async *say(userText) {
    if (this.busy) throw new Error('上一轮还没结束')
    this.busy = true
    try {
      const messages = [{ role: 'system', content: this.buildPrompt() }]

      // 防死循环：上一轮检测到面试官卡壳，本轮强制换方向
      if (userText && this.forcedMove) {
        messages.push({
          role: 'system',
          content:
            '⚠️ 系统提示：你已经在同一个信息点上纠缠超过三轮，候选人已经明确表示答不上来。' +
            '现在立即停止追问该点，换一个全新方向提问。不要重复之前的句式。',
        })
        this.forcedMove = false
      }
      if (userText && this.forcedStage) {
        messages.push({
          role: 'system',
          content: `⚠️ 系统提示：当前阶段「${this.stageName()}」已经超时，本轮提问必须切换到下一阶段的话题，不要再留在当前话题上。`,
        })
        this.forcedStage = false
      }

      if (!userText) {
        messages.push({
          role: 'user',
          content: buildOpeningInstruction({
            profile: this.profile,
            memory: this.memory,
            mode: this.mode,
          }),
        })
      } else {
        messages.push(...this.history)
        messages.push({ role: 'user', content: userText })
      }

      let full = ''
      for await (const ev of streamChat({
        provider: this.brain.provider,
        model: this.brain.model,
        messages,
        temperature: this.pressure >= 3 ? 0.75 : 0.6,
        maxTokens: 400,
      })) {
        if (ev.type === 'delta') {
          full += ev.text
          yield { type: 'delta', text: ev.text }
        } else if (ev.type === 'reasoning') {
          yield { type: 'reasoning', text: ev.text }
        } else if (ev.type === 'usage') {
          yield { type: 'usage', usage: ev.usage }
        }
      }

      const spoken = full.trim()
      if (!spoken) throw new Error('模型返回空内容')

      // 记录历史
      if (userText) {
        this.history.push({ role: 'user', content: userText })
        const last = this.transcript[this.transcript.length - 1]
        if (last && last.a == null) {
          last.a = userText
          last.answeredAt = new Date().toISOString()
        }
      }
      this.history.push({ role: 'assistant', content: spoken })
      this.transcript.push({
        q: spoken,
        a: null,
        stage: this.stage,
        at: new Date().toISOString(),
      })
      this.stageTurns += 1

      yield { type: 'turn', text: spoken, stage: this.stageInfo() }
      this.persist()

      // 检测面试官是否卡在同一个问题上（连续两轮高度相似 → 下轮强制换方向）
      if (userText) this.detectStuck(spoken)

      // 后台判断是否需要推进阶段（不阻塞本轮）
      if (userText) this.maybeAdvanceStage()
    } finally {
      this.busy = false
    }
  }

  /** 后台异步判阶段，结果通过事件推给前端 */
  maybeAdvanceStage() {
    if (this.stage === 'report') return

    // ① 整场时间到了：直接收尾，别再开新话题
    if (this.timeLeftMin() <= 0) {
      this.finishByTime()
      return
    }

    const min = MIN_TURNS_PER_STAGE[this.stage] ?? 2
    if (this.stageTurns < min) return

    // ② 当前阶段超出它那份时间预算太多 → 强推（自定义时长主要靠这条生效）
    const budget = this.stageBudgetMin(this.stage)
    const stageUsed = (Date.now() - this.stageStartedAt) / 60000
    if (stageUsed > budget * 1.6) {
      this.goNextStage(`当前阶段已用 ${Math.round(stageUsed)} 分钟，超出预算，强制推进`)
      return
    }

    // ③ 该阶段已经问太久了，直接强推，不再等模型点头
    if (this.stageTurns >= min * 2 + 1) {
      this.goNextStage('本阶段耗时过长，强制推进')
      return
    }
    // 否则每满 min 轮评一次
    if (this.stageTurns % min !== 0) return

    const covered = this.transcript.filter((t) => t.stage === this.stage)
    const stageNow = this.stage
    const plan = this.plan
    chat({
      provider: this.quick.provider,
      model: this.quick.model,
      messages: [
        { role: 'system', content: '你只输出 JSON，不输出任何其他内容。' },
        {
          role: 'user',
          content: `${buildStageJudgePrompt({ stage: stageNow, plan })}\n\n本阶段已进行 ${this.stageTurns} 轮。\n\n【本阶段问答】\n${covered
            .map((t, i) => `${i + 1}. 问：${t.q}\n   答：${t.a || '（未作答）'}`)
            .join('\n')}`,
        },
      ],
      temperature: 0.2,
      maxTokens: 200,
      jsonMode: true,
    })
      .then((raw) => {
        if (this.stage !== stageNow) return // 已被别的轮次推进过
        const parsed = safeJSON(raw)
        if (!parsed?.next) return
        // 只允许往前走一步，防止模型乱跳
        if (parsed.next !== nextStageIn(plan, stageNow)) return
        if ((parsed.coverage ?? 0) < 50) return
        this.goNextStage(parsed.reason || '')
      })
      .catch(() => {})
  }

  goNextStage(reason) {
    if (this.stage === 'report') return
    const next = nextStageIn(this.plan, this.stage)
    this.stage = next
    this.stageTurns = 0
    this.stageStartedAt = Date.now()
    this.forcedStage = next !== 'report' // 下一轮强制把话题切过去
    this.persist()
    this.emit('event', { type: 'stage', stage: this.stageInfo(), reason })
  }

  /**
   * 时间到：不管还剩几个阶段，直接进收尾。
   * 收尾阶段里面试官只会说一句结束语（评分报告仍然要用户点「结束并评分」才生成）。
   */
  finishByTime(reason = '时间到，进入收尾') {
    if (this.stage === 'report') return
    this.stage = 'report'
    this.stageTurns = 0
    this.stageStartedAt = Date.now()
    this.forcedStage = false
    this.persist()
    this.emit('event', { type: 'stage', stage: this.stageInfo(), reason })
  }

  /** 收尾：生成评分报告并沉淀记忆 */
  async finish() {
    const pairs = this.transcript.filter((t) => t.a)
    if (pairs.length === 0) {
      this.endedAt = new Date().toISOString()
      this.stage = 'report'
      this.persist()
      return { skipped: true }
    }

    const raw = await chat({
      provider: this.brain.provider,
      model: this.brain.model,
      messages: [
        { role: 'system', content: '你是一位严格的面试评估官，只输出 JSON。' },
        { role: 'user', content: buildReportPrompt({ transcript: pairs }) },
      ],
      temperature: 0.3,
      maxTokens: 2000,
      jsonMode: true,
    })

    const report = safeJSON(raw) || { overall: 0, verdict: '评估生成失败', dimensions: [], highlights: [], weakPoints: [], nextActions: [], spokenSummary: raw.slice(0, 200) }

    this.report = report
    this.stage = 'report'
    this.endedAt = new Date().toISOString()
    this.persist()
    absorbReport(report, this.id)
    return report
  }
}

function safeJSON(text) {
  if (!text) return null
  let s = String(text).trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/* ---------------- 会话注册表 ---------------- */

const live = new Map()

export function createSession(opts) {
  const s = new InterviewSession(opts)
  live.set(s.id, s)
  s.persist()
  return s
}

export function getLiveSession(id) {
  return live.get(id) || null
}

export function dropSession(id) {
  live.delete(id)
}
