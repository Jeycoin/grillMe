import { useEffect, useState } from 'react'
import { api } from '../api'
import type { AppConfig, MaterialSet, ModelRef, Profile, ProviderModels } from '../types'
import type { SessionSettings } from '../App'

interface Props {
  config: AppConfig
  profile: Profile
  settings: SessionSettings
  materials: MaterialSet[]
  enabledCount: number
  onChangeProfile: (p: Partial<Profile>) => Promise<void> | void
  onChangeSettings: (s: SessionSettings) => void
  onOpenMaterial: () => void
  onStart: () => void
}

export default function Setup({
  config,
  profile,
  settings,
  enabledCount,
  onChangeProfile,
  onChangeSettings,
  onOpenMaterial,
  onStart,
}: Props) {
  const [local, setLocal] = useState<Profile>(profile)
  const [openModel, setOpenModel] = useState<null | 'brain' | 'quick'>(null)

  useEffect(() => setLocal(profile), [profile])

  const save = (patch: Partial<Profile>) => {
    setLocal((p) => ({ ...p, ...patch }))
    onChangeProfile(patch)
  }

  const readyProviders = config.providers.filter((p) => p.ready)
  const canStart = readyProviders.length > 0

  return (
    <div className="scroll">
      <div className="page">
        <div className="hero">
          <h1>
            坐好。<em>开始拷打。</em>
          </h1>
          <p>
            这不是聊天机器人。它会顺着你的回答往死里追，抓你话里的数字、钻你逻辑的漏洞，
            然后把你不懂的东西记下来，下次接着问。
          </p>
        </div>

        {/* 1 档案 */}
        <section className="card">
          <div className="card-head">
            <span className="card-num">1</span>
            <span className="card-title">候选人档案</span>
            <span className="muted" style={{ fontSize: 12.5 }}>
              填得越细，问得越狠。留空也没关系，面试官会先问你要。
            </span>
          </div>
          <div className="grid-3" style={{ marginBottom: 12 }}>
            <div className="field">
              <label>目标岗位</label>
              <input
                className="input"
                value={local.targetRole}
                onChange={(e) => save({ targetRole: e.target.value })}
                placeholder="如：后端开发 / AI Agent 工程师"
              />
            </div>
            <div className="field">
              <label>目标公司</label>
              <input
                className="input"
                value={local.company}
                onChange={(e) => save({ company: e.target.value })}
                placeholder="如：字节 / 腾讯 / 某创业公司"
              />
            </div>
            <div className="field">
              <label>工作年限</label>
              <input
                className="input"
                value={local.years}
                onChange={(e) => save({ years: e.target.value })}
                placeholder="如：3 年"
              />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>岗位 JD（可选）</label>
            <textarea
              className="textarea"
              style={{ minHeight: 70 }}
              value={local.jd}
              onChange={(e) => save({ jd: e.target.value })}
              placeholder="把 JD 粘进来，面试官会按 JD 要求的知识点来考你"
            />
          </div>
          <div className="field">
            <label>简历 / 项目经历</label>
            <textarea
              className="textarea"
              style={{ minHeight: 130 }}
              value={local.resume}
              onChange={(e) => save({ resume: e.target.value })}
              placeholder={
                '把你简历上的项目经历粘进来。\n\n写在简历上的每一句"负责""主导""从 0 到 1"，都会被逐个问穿。\n\n例：\n2023.06-2024.05  XX公司  后端开发\n- 主导订单系统重构，QPS 从 800 提升到 3000\n- 负责接入支付网关，日交易额 200w'
              }
            />
          </div>
        </section>

        {/* 2 强度 */}
        <section className="card">
          <div className="card-head">
            <span className="card-num">2</span>
            <span className="card-title">拷打强度</span>
          </div>
          <div className="pressure-list">
            {config.pressureLevels.map((p) => (
              <button
                key={p.id}
                className={`pressure-item${settings.pressure === p.id ? ' on' : ''}`}
                onClick={() => onChangeSettings({ ...settings, pressure: p.id })}
              >
                <span className="pressure-bar">
                  {[1, 2, 3, 4].map((i) => (
                    <i key={i} style={{ opacity: i <= p.id ? 1 : 0.35 }} />
                  ))}
                </span>
                <span className="pressure-item-name">{p.name}</span>
                <span className="pressure-item-desc">{p.desc}</span>
              </button>
            ))}
          </div>
        </section>

        {/* 3 面试官类型 */}
        <section className="card">
          <div className="card-head">
            <span className="card-num">3</span>
            <span className="card-title">面试官类型</span>
          </div>
          <div className="pills">
            {config.archetypes.map((a) => (
              <button
                key={a.id}
                className={`pill${settings.archetype === a.id ? ' on' : ''}`}
                onClick={() => onChangeSettings({ ...settings, archetype: a.id })}
                title={a.focus}
              >
                {a.name}
              </button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0, marginTop: 10 }}>
            {config.archetypes.find((a) => a.id === settings.archetype)?.focus}
          </p>
        </section>

        {/* 4 大脑 */}
        <section className="card">
          <div className="card-head">
            <span className="card-num">4</span>
            <span className="card-title">面试官大脑</span>
            <div className="topbar-spacer" />
            <button className="btn btn-sm btn-ghost" onClick={() => setOpenModel(openModel ? null : 'brain')}>
              {openModel ? '收起' : '切换模型'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="tag">{modelLabel(config, settings.brain)}</span>
            <span className="muted" style={{ fontSize: 12.5 }}>
              主脑 · 决定问什么、怎么追问、怎么打分
            </span>
          </div>

          {openModel && (
            <ModelPicker
              config={config}
              value={settings.brain}
              onPick={(m) => {
                onChangeSettings({ ...settings, brain: m })
                setOpenModel(null)
              }}
            />
          )}
        </section>

        {/* 5 面经 */}
        <section className="card">
          <div className="card-head">
            <span className="card-num">5</span>
            <span className="card-title">外部面经</span>
            <div className="topbar-spacer" />
            <button className="btn btn-sm" onClick={onOpenMaterial}>
              打开面经库
            </button>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {enabledCount > 0
              ? `已启用 ${enabledCount} 道题，面试官会优先从这些真实面经里出题。`
              : '还没加载面经。可以贴牛客/掘金/小红书链接自动抽取，也可以直接粘文本。'}
          </p>
        </section>

        {/* 6 语音 */}
        <VoiceCard config={config} settings={settings} onChangeSettings={onChangeSettings} />

        {/* 7 记忆 */}
        <section className="card">
          <div className="card-head">
            <span className="card-num">7</span>
            <span className="card-title">长期记忆</span>
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.useMemory}
              onChange={(e) => onChangeSettings({ ...settings, useMemory: e.target.checked })}
              style={{ marginTop: 4, accentColor: 'var(--accent)' }}
            />
            <span style={{ fontSize: 13 }}>
              让面试官记住你
              <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>
                开启后他会读取历史薄弱项，开场就朝你上次翻车的地方进攻。
                {config.memory.sessionCount > 0
                  ? `（已积累 ${config.memory.sessionCount} 场面试、${config.memory.weakPointCount} 个弱项）`
                  : '（还没有历史记录）'}
              </span>
            </span>
          </label>
        </section>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 22 }}>
          <button className="btn btn-accent" style={{ padding: '12px 30px', fontSize: 15 }} onClick={onStart} disabled={!canStart}>
            开始面试
          </button>
          {!canStart && (
            <span className="muted" style={{ fontSize: 13 }}>
              还没有可用的模型供应商，请在 .env 里配置 Key
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function modelLabel(config: AppConfig, m: ModelRef) {
  const p = config.providers.find((x) => x.id === m.provider)
  return `${p?.short || m.provider} · ${m.model}`
}

/* ---------------- 语音卡片 ---------------- */

function VoiceCard({
  config,
  settings,
  onChangeSettings,
}: {
  config: AppConfig
  settings: SessionSettings
  onChangeSettings: (s: SessionSettings) => void
}) {
  const [testing, setTesting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const v = config.voice
  const available = Boolean(v?.enabled) && v!.voices.length > 0

  const set = (patch: Partial<SessionSettings>) => onChangeSettings({ ...settings, ...patch })

  /** 试听：用当前压力档的语气念一句典型的面试官台词 */
  const audition = async () => {
    setTesting(true)
    setErr(null)
    try {
      const blob = await api.tts(SAMPLE_LINE, {
        voice: settings.voiceId,
        pressure: settings.pressure,
        archetype: settings.archetype,
      })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      await audio.play()
    } catch (e) {
      setErr(String((e as Error).message || e))
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <span className="card-num">6</span>
        <span className="card-title">语音对话</span>
        <div className="topbar-spacer" />
        {available ? (
          <span className="tag tag-ok">TTS + ASR 就绪</span>
        ) : (
          <span className="tag tag-accent">未配置</span>
        )}
      </div>

      {!available ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          需要 <code className="mono">DASHSCOPE_API_KEY</code> 才能开启语音。
          配置好后刷新页面。
        </p>
      ) : (
        <>
          <label
            style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 14 }}
          >
            <input
              type="checkbox"
              checked={settings.voiceOn}
              onChange={(e) => set({ voiceOn: e.target.checked })}
              style={{ marginTop: 4, accentColor: 'var(--accent)' }}
            />
            <span style={{ fontSize: 13.5 }}>
              开启全程语音对话
              <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>
                面试官开口问、你开口答。文字输入仍然保留，随时可以打字。
              </span>
            </span>
          </label>

          {settings.voiceOn && (
            <>
              <div className="field" style={{ marginBottom: 12 }}>
                <label>面试官音色</label>
                <div className="pills">
                  {v!.voices.map((vo) => (
                    <button
                      key={vo.id}
                      className={`pill${settings.voiceId === vo.id ? ' on' : ''}`}
                      onClick={() => set({ voiceId: vo.id })}
                      title={vo.note}
                    >
                      {vo.label}
                      <span style={{ opacity: 0.55, fontSize: 11, marginLeft: 5 }}>{vo.gender}</span>
                    </button>
                  ))}
                  <button className="btn btn-sm" onClick={audition} disabled={testing}>
                    {testing ? <span className="spinner" /> : '试听'}
                  </button>
                </div>
                <span className="muted" style={{ fontSize: 12 }}>
                  {v!.voices.find((x) => x.id === settings.voiceId)?.note}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settings.autoListen}
                    onChange={(e) => set({ autoListen: e.target.checked })}
                    style={{ marginTop: 3, accentColor: 'var(--accent)' }}
                  />
                  <span style={{ fontSize: 13 }}>
                    面试官说完自动开麦
                    <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>
                      不用碰键盘，停下来就轮到你答。停顿约 1.3 秒自动结束收音。
                    </span>
                  </span>
                </label>

                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settings.autoSubmit}
                    onChange={(e) => set({ autoSubmit: e.target.checked })}
                    style={{ marginTop: 3, accentColor: 'var(--accent)' }}
                  />
                  <span style={{ fontSize: 13 }}>
                    识别完自动提交
                    <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>
                      关掉的话，识别出的文字会先填进输入框，你看一眼再手动发送（识别不准时有用）。
                    </span>
                  </span>
                </label>
              </div>

              <div
                className="muted"
                style={{
                  fontSize: 12,
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: '1px solid var(--line)',
                }}
              >
                <b style={{ color: 'var(--text-2)' }}>当前语气</b>（由压力档 + 面试官类型自动决定）：
                <div style={{ marginTop: 5, lineHeight: 1.6 }}>
                  {v!.tones.find((t) => t.pressure === settings.pressure)?.instruction}
                  {'；'}
                  {config.archetypes.find((a) => a.id === settings.archetype)?.focus
                    ? '叠加该面试官类型的语气特征'
                    : ''}
                </div>
              </div>
            </>
          )}

          {err && (
            <div className="toast err" style={{ position: 'static', marginTop: 12 }}>
              {err}
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** 试听用的台词 —— 要能体现语气差异 */
const SAMPLE_LINE = '你说 QPS 从 800 提到了 3000，那这个数字是怎么测出来的？'

function ModelPicker({
  config,
  value,
  onPick,
}: {
  config: AppConfig
  value: ModelRef
  onPick: (m: ModelRef) => void
}) {
  const [providers, setProviders] = useState<Record<string, ProviderModels> | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    api
      .models()
      .then((r) => setProviders(r.providers))
      .catch(() => setProviders({}))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div style={{ marginTop: 14 }}>
        <span className="spinner" /> <span className="muted" style={{ fontSize: 13 }}>正在拉取可用模型…</span>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 14 }}>
      {config.providers.map((p) => {
        const pm = providers?.[p.id]
        const list = pm?.ok ? pm.models.slice(0, 40) : []
        return (
          <div className="model-group" key={p.id}>
            <div className="model-group-head">
              <span className={`dot ${pm?.ok ? 'ok' : 'bad'}`} />
              {p.label}
              {!pm?.ok && <span className="muted">（{pm?.error || '不可用'}）</span>}
            </div>
            <div className="pills">
              {list.map((mid) => (
                <button
                  key={mid}
                  className={`pill pill-model${value.provider === p.id && value.model === mid ? ' on' : ''}`}
                  onClick={() => onPick({ provider: p.id, model: mid })}
                >
                  {mid}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
