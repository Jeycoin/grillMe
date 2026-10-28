/**
 * 语音合成（TTS）
 *
 * 语气是"压迫感"真正的落地点：qwen3-tts-flash 支持用**自然语言描述语气**
 * （input.instructions），同一句话用不同描述念出来完全是两个人。
 * 如果只调 prompt 不调语气，面试官在文字上很凶、声音上却软绵绵，非常出戏。
 *
 * ⚠️ 这里踩过一个坑，值得写下来：
 * 之前写死的是 `qwen3-tts-instruct-flash`，但百炼上已经没有这个模型了，
 * 请求会直接返回 404 `Model not exist.`。
 * 又因为"只有带语气的那条路"才会走它，而面试官**开口第一句就带语气**，
 * 所以现象是：面试官一开口就没有声音，后面的文字全在，语音全丢。
 * 现在统一用 qwen3-tts-flash（它原生支持 instructions），并加了自动降级：
 * 模型名不对 / instructions 不被接受时，退成"不带语气"再合成一次，
 * 保证最差也能把话说出来，不会整个冷场。
 *
 * DashScope 返回的是音频 URL（不是直接字节），所以这里要再取一次。
 */
import { PROVIDERS } from '../config.js'

const TTS_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'

/** 基础合成模型。可用 TTS_MODEL 环境变量覆盖 */
const BASE_MODEL = process.env.TTS_MODEL || 'qwen3-tts-flash'

/**
 * 可选：单独指定"带语气"用的模型。
 * 默认留空 = 与 BASE_MODEL 同一个模型（qwen3-tts-flash 自带 instructions 能力）。
 */
let toneModel = process.env.TTS_TONE_MODEL || ''

/** 语气能力是否还可信。被供应商拒绝一次后就记住，不要每句话都白跑一次 404 */
let toneSupported = true

/** 音色表。男女声都有，面试官默认用女声 Cherry（更冷，压迫感强） */
export const VOICES = [
  { id: 'Cherry', label: 'Cherry', gender: '女', note: '默认。声线偏冷，适合高压面试' },
  { id: 'Serena', label: 'Serena', gender: '女', note: '温和一些，适合模拟面' },
  { id: 'Chelsie', label: 'Chelsie', gender: '女', note: '清澈，偏年轻' },
  { id: 'Ethan', label: 'Ethan', gender: '男', note: '沉稳男声，适合技术主管面' },
  { id: 'Dylan', label: 'Dylan', gender: '男', note: '低沉男声，压迫感强' },
  { id: 'Jada', label: 'Jada', gender: '女', note: '干脆利落' },
  { id: 'Sunny', label: 'Sunny', gender: '女', note: '偏活泼，适合 HR 面' },
]

export const DEFAULT_VOICE = 'Cherry'

/** 把文本切成适合逐句合成的片段（避免长文本一次性等待太久） */
export function splitSentences(text) {
  const clean = String(text || '').trim()
  if (!clean) return []
  // 按中文标点切，保留标点，短句合并
  const raw = clean
    .replace(/\s+/g, ' ')
    .split(/(?<=[。！？；!?;])/)
    .map((s) => s.trim())
    .filter(Boolean)

  const out = []
  let buf = ''
  for (const s of raw) {
    buf += s
    // 太短的先攒着；够长了就切出去
    if (buf.length >= 12) {
      out.push(buf)
      buf = ''
    }
  }
  if (buf) out.push(buf)
  return out.length ? out : [clean]
}

/**
 * 这次失败值不值得"换个方式再试一次"。
 * 只有 4xx 里那些"模型名不对 / 参数不被支持"才有意义；
 * 网络错误、5xx、超时直接抛，别拿用户的时间做重试。
 */
function isRecoverable(err) {
  const status = Number(err?.status || 0)
  if (status < 400 || status >= 500) return false
  const text = `${err?.code || ''} ${err?.message || ''}`.toLowerCase()
  return (
    text.includes('model not exist') ||
    text.includes('model_not_found') ||
    text.includes('not support') ||
    text.includes('unsupported') ||
    text.includes('invalidparameter')
  )
}

/** 发一次合成请求，成功返回音频 URL */
async function requestTts({ text, voice, tone, model, signal }) {
  const key = PROVIDERS.dashscope.apiKey
  const input = { text, voice, language_type: 'Chinese' }
  if (tone) input.instructions = tone

  const res = await fetch(TTS_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input }),
    signal,
  })

  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error(`TTS 请求失败 HTTP ${res.status}：${JSON.stringify(json).slice(0, 240)}`)
    err.status = res.status
    err.code = json?.code || ''
    throw err
  }
  const url = json?.output?.audio?.url
  if (!url) throw new Error(`TTS 未返回音频地址：${JSON.stringify(json).slice(0, 240)}`)
  return url
}

/**
 * 按"带语气 → 换模型 → 不带语气"的顺序尝试，返回可下载的音频 URL。
 * 任何一次成功后都会把结论记下来，后续句子不再重复试错。
 */
async function requestWithFallback({ text, voice, tone, signal }) {
  const attempts = []
  if (tone && toneSupported) {
    attempts.push({ model: toneModel || BASE_MODEL, tone })
    if (toneModel && toneModel !== BASE_MODEL) attempts.push({ model: BASE_MODEL, tone })
    attempts.push({ model: BASE_MODEL, tone: '' })
  } else {
    attempts.push({ model: BASE_MODEL, tone: '' })
  }

  let lastErr = null
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i]
    try {
      return await requestTts({ text, voice, tone: a.tone, model: a.model, signal })
    } catch (e) {
      lastErr = e
      if (i === attempts.length - 1 || !isRecoverable(e)) throw e

      if (a.model === BASE_MODEL) {
        // 基础模型连 instructions 都不认 → 以后都别带语气了
        if (a.tone) {
          toneSupported = false
          console.warn('[tts] 模型不接受语气指令，后续改用普通模式合成：', e.message)
        }
      } else {
        // 单独配置的语气模型不可用 → 回到基础模型再试一次（语气仍然保留）
        toneModel = ''
        console.warn(`[tts] 语气模型不可用，改用 ${BASE_MODEL} 重试：`, e.message)
      }
    }
  }
  throw lastErr || new Error('语音合成失败')
}

/**
 * 合成一段语音，返回 WAV Buffer。
 * @param {object} o
 * @param {string} o.text        要说的话
 * @param {string} [o.voice]     音色 id
 * @param {string} [o.tone]      语气指令（自然语言），空则用普通模式
 * @param {number} [o.timeout]   毫秒
 */
export async function synthesize({ text, voice = DEFAULT_VOICE, tone = '', timeout = 60000 }) {
  const key = PROVIDERS.dashscope.apiKey
  if (!key) throw new Error('未配置 DASHSCOPE_API_KEY，无法合成语音')

  let content = String(text || '').trim()
  if (!content) throw new Error('要合成的文本为空')
  if (content.length > 500) {
    // 单次太长既慢又容易失败，截断保护
    content = content.slice(0, 500)
  }

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeout)
  try {
    const url = await requestWithFallback({
      text: content,
      voice,
      tone: String(tone || '').trim(),
      signal: ctl.signal,
    })

    const audioRes = await fetch(url, { signal: ctl.signal })
    if (!audioRes.ok) throw new Error(`下载合成音频失败 HTTP ${audioRes.status}`)
    const buf = Buffer.from(await audioRes.arrayBuffer())
    if (!buf.length) throw new Error('合成出来的音频是空的')
    return buf
  } finally {
    clearTimeout(timer)
  }
}

/** 只走合成不下载，用于预热/探测 */
export async function synthesizeToUrl({ text, voice = DEFAULT_VOICE, tone = '' }) {
  const key = PROVIDERS.dashscope.apiKey
  if (!key) throw new Error('未配置 DASHSCOPE_API_KEY，无法合成语音')
  return requestWithFallback({
    text: String(text || '').trim(),
    voice,
    tone: String(tone || '').trim(),
    signal: undefined,
  })
}

/** 当前实际使用的模型与语气能力，供健康检查/后台展示 */
export function ttsModelInfo() {
  return {
    model: BASE_MODEL,
    toneModel: toneModel || BASE_MODEL,
    toneSupported,
  }
}
