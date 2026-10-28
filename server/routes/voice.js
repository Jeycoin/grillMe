/**
 * 语音接口 —— 浏览器只跟这里说话，DashScope 的 Key 全程不出服务端
 */
import express from 'express'
import { synthesize, VOICES, DEFAULT_VOICE, ttsModelInfo } from '../voice/tts.js'
import { transcribe, looksEmpty } from '../voice/asr.js'
import { TONE_PRESETS, buildTone } from '../interviewer/persona.js'

export function mountVoice(app, wrap) {
  /** 语音能力清单 */
  app.get('/api/voice/info', wrap((_req, res) => {
    res.json({
      ok: true,
      voices: VOICES,
      defaultVoice: DEFAULT_VOICE,
      tones: TONE_PRESETS,
    })
  }))

  /**
   * 合成语音。返回 audio/wav 二进制。
   *
   * 语气优先由服务端组装：传 pressure + archetype 即可，
   * 显式传 tone 则覆盖（用于临时指定语气）。
   */
  app.post(
    '/api/voice/tts',
    wrap(async (req, res) => {
      const { text, voice, tone, pressure, archetype } = req.body || {}
      if (!text || !String(text).trim()) {
        return res.status(400).json({ ok: false, error: '缺少 text' })
      }
      const finalTone =
        tone || (pressure != null ? buildTone({ pressure: Number(pressure), archetype }) : '')

      const wav = await synthesize({ text, voice, tone: finalTone })
      res.setHeader('Content-Type', 'audio/wav')
      res.setHeader('Content-Length', String(wav.length))
      res.setHeader('Cache-Control', 'no-store')
      res.end(wav)
    }),
  )

  /**
   * 语音识别。请求体是裸音频字节。
   * 音频格式靠 Content-Type 判断，默认 wav。
   */
  app.post(
    '/api/voice/asr',
    express.raw({ type: () => true, limit: '24mb' }),
    wrap(async (req, res) => {
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '')
      if (!buf.length) return res.status(400).json({ ok: false, error: '音频为空' })
      const mime = req.headers['content-type'] || 'audio/wav'
      const r = await transcribe(buf, { mime })
      res.json({ ok: true, ...r, empty: looksEmpty(r.text) })
    }),
  )

  /** 健康探测：各打一次最短的合成/识别，确认链路可用 */
  app.get('/api/voice/health', wrap(async (_req, res) => {
    const out = { tts: { ok: false }, asr: { ok: false } }
    const t0 = Date.now()
    try {
      // 故意带语气去探：面试官真正走的就是这条路。
      // 只测"无语气合成"会漏掉模型名失效这类故障 —— 之前就这么漏过一次，
      // 健康检查全绿，面试官却一句都说不出。
      const tone = buildTone({ pressure: 2, archetype: 'tech' })
      const wav = await synthesize({ text: '在。', voice: DEFAULT_VOICE, tone })
      out.tts = { ok: true, bytes: wav.length, ms: Date.now() - t0, tone: true, ...ttsModelInfo() }
    } catch (e) {
      out.tts = { ok: false, error: String(e.message || e), ...ttsModelInfo() }
    }
    // ASR 用刚合成的音频反过来测一次，形成闭环
    if (out.tts.ok) {
      try {
        const t1 = Date.now()
        const wav = await synthesize({ text: '我在测试语音识别。', voice: DEFAULT_VOICE })
        const r = await transcribe(wav, { mime: 'audio/wav' })
        out.asr = { ok: Boolean(r.text), text: r.text, ms: Date.now() - t1 }
      } catch (e) {
        out.asr = { ok: false, error: String(e.message || e) }
      }
    }
    res.json({ ok: true, ...out })
  }))
}
