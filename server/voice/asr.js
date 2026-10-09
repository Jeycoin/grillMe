/**
 * 语音识别（ASR）
 *
 * 走 DashScope 原生 multimodal-generation 接口，**必须开 enable_itn**。
 *
 * 为什么不用 OpenAI 兼容的 /chat/completions：
 *   兼容模式不支持 asr_options，数字会被还原成汉字 ——
 *   同一句话："QPS从八零零提升到三千，P九十九延迟从一百二十毫秒降到三十五毫秒"
 *   开了 ITN："QPS从800提升到3000，P99延迟从120ms降到35ms"
 *   技术面试里数字和缩写就是考点，这个差别是决定性的。
 *
 * 返回里还带 audio_info 标注（emotion / language），
 * emotion 可以拿来做"候选人慌了没有"的辅助信号。
 */
import { PROVIDERS } from '../config.js'

const ASR_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'

/** 浏览器 MediaRecorder 常见的 mime → DashScope 认的 format */
function guessFormat(mime = '') {
  const m = String(mime).toLowerCase()
  if (m.includes('wav') || m.includes('wave')) return 'wav'
  if (m.includes('mp3') || m.includes('mpeg')) return 'mp3'
  if (m.includes('webm')) return 'webm'
  if (m.includes('ogg')) return 'ogg'
  if (m.includes('m4a') || m.includes('mp4')) return 'mp4'
  if (m.includes('aac')) return 'aac'
  return 'wav'
}

/**
 * 把一段音频转成文字。
 * @param {Buffer} buffer  音频字节
 * @param {object} [opts]
 * @param {string} [opts.mime]     音频 mime，用于判断格式
 * @param {string} [opts.model]    ASR 模型
 * @param {boolean}[opts.itn]      是否开启数字/单位还原，默认开
 * @param {number} [opts.timeout]  毫秒
 * @returns {Promise<{text:string, emotion?:string, language?:string, seconds?:number}>}
 */
export async function transcribe(buffer, opts = {}) {
  const key = PROVIDERS.dashscope.apiKey
  if (!key) throw new Error('未配置 DASHSCOPE_API_KEY，无法识别语音')
  if (!buffer?.length) throw new Error('音频为空')

  const { mime = 'audio/wav', model = 'qwen3-asr-flash', itn = true, timeout = 60000 } = opts

  const format = guessFormat(mime)
  const dataUrl = `data:audio/${format};base64,${buffer.toString('base64')}`

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeout)
  try {
    const res = await fetch(ASR_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: { messages: [{ role: 'user', content: [{ audio: dataUrl }] }] },
        parameters: { asr_options: { enable_lid: true, enable_itn: itn } },
      }),
      signal: ctl.signal,
    })

    const json = await res.json().catch(() => null)
    if (!res.ok) {
      throw new Error(`ASR 请求失败 HTTP ${res.status}：${JSON.stringify(json).slice(0, 240)}`)
    }

    const choice = json?.output?.choices?.[0]
    const msg = choice?.message || {}
    // content 是数组：[{ text: '...' }]
    const text = Array.isArray(msg.content)
      ? msg.content.map((c) => c?.text || '').join('')
      : typeof msg.content === 'string'
        ? msg.content
        : ''

    const info = (msg.annotations || []).find((a) => a?.type === 'audio_info') || {}

    return {
      text: String(text || '').trim(),
      emotion: info.emotion,
      language: info.language,
      seconds: json?.usage?.seconds,
      tokens: json?.usage?.total_tokens,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 这段文字是不是"没听清/没说话"。
 * 模型对纯噪音偶尔会吐出语气词，直接当成有效回答会污染对话记录。
 */
export function looksEmpty(text) {
  const t = String(text || '').trim()
  if (!t) return true
  if (/^[。，、\s.!?,、；;：:]*$/.test(t)) return true
  if (/^(嗯+|啊+|呃+|哦+|额+|唉+|嗐+)[。，、\s]*$/.test(t)) return true
  return false
}
