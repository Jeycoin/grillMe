/**
 * 语音合成（TTS）
 *
 * 用 qwen3-tts-instruct-flash —— 这个模型支持用**自然语言描述语气**，
 * 是"压迫感"这个需求的关键：同样的字，冷淡语气和温和语气完全是两个味道。
 *
 * DashScope 返回的是音频 URL（不是直接字节），所以这里要再取一次。
 */
import { PROVIDERS } from '../config.js'

const TTS_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'

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
 * 合成一段语音，返回 WAV Buffer。
 * @param {object} o
 * @param {string} o.text        要说的话
 * @param {string} [o.voice]     音色 id
 * @param {string} [o.tone]      语气指令（自然语言），空则用普通模型
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

  // 有语气指令 → 用 instruct 模型；没有 → 用更快的 flash
  const useInstruct = Boolean(tone && tone.trim())
  const model = useInstruct ? 'qwen3-tts-instruct-flash' : 'qwen3-tts-flash'

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeout)
  try {
    const res = await fetch(TTS_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: { text: content, voice, ...(useInstruct ? { instructions: tone.trim() } : {}) },
        parameters: { language_type: 'Chinese' },
      }),
      signal: ctl.signal,
    })

    const json = await res.json().catch(() => null)
    if (!res.ok) {
      throw new Error(`TTS 请求失败 HTTP ${res.status}：${JSON.stringify(json).slice(0, 240)}`)
    }
    const url = json?.output?.audio?.url
    if (!url) {
      throw new Error(`TTS 未返回音频地址：${JSON.stringify(json).slice(0, 240)}`)
    }

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
  const useInstruct = Boolean(tone && tone.trim())
  const res = await fetch(TTS_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: useInstruct ? 'qwen3-tts-instruct-flash' : 'qwen3-tts-flash',
      input: { text, voice, ...(useInstruct ? { instructions: tone.trim() } : {}) },
      parameters: { language_type: 'Chinese' },
    }),
  })
  const json = await res.json()
  return json?.output?.audio?.url || null
}
