/**
 * HTTP API —— 前端唯一的后端入口
 */
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import fs from 'node:fs'
import { SERVER, ROOT, publicConfig, providerReady, PROVIDERS } from './config.js'
import { listAllModels, pingProvider } from './providers/index.js'
import { createSession, getLiveSession, dropSession } from './interviewer/orchestrator.js'
import { STAGES, PRESSURE_LEVELS, ARCHETYPES, TONE_PRESETS } from './interviewer/persona.js'
import { VOICES, DEFAULT_VOICE } from './voice/tts.js'
import {
  getProfile,
  saveProfile,
  getMemory,
  getMemoryStats,
  listSessions,
  getSession,
} from './memory/store.js'
import { listServers, listTools, callTool } from './sources/mcp.js'
import { mountMaterials } from './routes/materials.js'
import { mountAdmin } from './routes/admin.js'
import { mountVoice } from './routes/voice.js'
import { statsMaterials } from './memory/materials.js'

export function buildApp() {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '8mb' }))

  const wrap = (fn) => (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      if (res.headersSent) return
      res.status(500).json({ ok: false, error: String(err?.message || err) })
    })
  }

  /* ---------- 基础 ---------- */

  app.get('/api/config', wrap((_req, res) => {
    res.json({
      ok: true,
      ...publicConfig(),
      stages: STAGES,
      pressureLevels: Object.values(PRESSURE_LEVELS),
      archetypes: Object.values(ARCHETYPES),
      memory: getMemoryStats(),
      materials: statsMaterials(),
      mcpServers: listServers(),
      voice: {
        enabled: Boolean(PROVIDERS.dashscope.apiKey),
        provider: 'dashscope',
        voices: VOICES,
        defaultVoice: DEFAULT_VOICE,
        tones: TONE_PRESETS,
      },
    })
  }))

  app.get('/api/models', wrap(async (req, res) => {
    res.json({ ok: true, providers: await listAllModels({ force: req.query.force === '1' }) })
  }))

  app.post('/api/models/ping', wrap(async (req, res) => {
    res.json({ ok: true, result: await pingProvider(req.body?.provider) })
  }))

  /* ---------- 档案与记忆 ---------- */

  app.get('/api/profile', wrap((_req, res) => res.json({ ok: true, profile: getProfile() })))
  app.post('/api/profile', wrap((req, res) => res.json({ ok: true, profile: saveProfile(req.body || { }) })))
  app.get('/api/memory', wrap((_req, res) => res.json({ ok: true, memory: getMemory() })))

  app.get('/api/sessions', wrap((_req, res) => res.json({ ok: true, sessions: listSessions() })))
  app.get('/api/sessions/:id', wrap((req, res) => {
    const s = getSession(req.params.id)
    if (!s) return res.status(404).json({ ok: false, error: '会话不存在' })
    res.json({ ok: true, session: s })
  }))

  /* ---------- 面试会话 ---------- */

  app.post('/api/session', wrap((req, res) => {
    const b = req.body || {}
    const brain = b.brain || undefined
    if (brain && !providerReady(brain.provider)) {
      return res.status(400).json({ ok: false, error: `供应商「${brain.provider}」未配置 API Key` })
    }
    const session = createSession({
      pressure: b.pressure,
      archetype: b.archetype,
      brain,
      quick: b.quick,
      material: b.material || [],
      useMemory: b.useMemory !== false,
    })
    res.json({ ok: true, sessionId: session.id, state: session.stageInfo() })
  }))

  /** 面试官说话（流式 SSE）。body.userText 为空 = 开场 */
  app.post('/api/session/:id/say', wrap(async (req, res) => {
    const session = getLiveSession(req.params.id)
    if (!session) return res.status(404).json({ ok: false, error: '会话不存在或服务已重启，请重新开始' })

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()

    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)

    try {
      for await (const ev of session.say(req.body?.userText || '')) send(ev)
    } catch (err) {
      send({ type: 'error', error: String(err?.message || err) })
    }
    res.write('data: [DONE]\n\n')
    res.end()
  }))

  /** 阶段变更事件（前端轮询） */
  app.get('/api/session/:id/state', wrap((req, res) => {
    const s = getLiveSession(req.params.id)
    if (!s) return res.status(404).json({ ok: false, error: '会话不存在' })
    res.json({ ok: true, stage: s.stageInfo(), turns: s.transcript.length })
  }))

  app.post('/api/session/:id/finish', wrap(async (req, res) => {
    const session = getLiveSession(req.params.id) || null
    if (!session) {
      // 服务重启过的话，退化成只读历史
      const past = getSession(req.params.id)
      if (past?.report) return res.json({ ok: true, report: past.report, cached: true })
      return res.status(404).json({ ok: false, error: '会话不存在' })
    }
    const report = await session.finish()
    dropSession(session.id)
    res.json({ ok: true, report })
  }))

  /* ---------- 面经素材（主站 + 后台共用） ---------- */
  mountMaterials(app, wrap)

  /* ---------- MCP ---------- */

  app.get('/api/mcp/servers', wrap((_req, res) => res.json({ ok: true, servers: listServers() })))

  app.get('/api/mcp/:name/tools', wrap(async (req, res) => {
    res.json({ ok: true, tools: await listTools(req.params.name) })
  }))

  app.post('/api/mcp/:name/call', wrap(async (req, res) => {
    const { tool, args } = req.body || {}
    if (!tool) return res.status(400).json({ ok: false, error: '缺少 tool 名' })
    res.json({ ok: true, result: await callTool(req.params.name, tool, args || {}) })
  }))

  /* ---------- 后台管理 ---------- */
  mountAdmin(app, wrap)

  /* ---------- 语音 ---------- */
  mountVoice(app, wrap)

  /* ---------- 静态资源（生产模式） ---------- */

  if (process.argv.includes('--serve-web')) {
    const dist = path.join(ROOT, 'dist')
    if (fs.existsSync(dist)) {
      app.use(express.static(dist))
      app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
    }
  }

  return app
}

export function startServer() {
  const app = buildApp()
  return new Promise((resolve) => {
    const server = app.listen(SERVER.port, SERVER.host, () => {
      const url = `http://${SERVER.host}:${SERVER.port}`
      console.log(`\n  拷问官 API 已启动  ${url}`)
      console.log(`  前端开发地址      http://127.0.0.1:5199\n`)
      resolve(server)
    })
  })
}
