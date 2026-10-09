/**
 * 后台管理接口
 */
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, PROVIDERS, ROLE_DEFAULTS } from '../config.js'
import { pingProvider, listAllModels } from '../providers/index.js'
import {
  adminOverview,
  listSessions,
  getSession,
  deleteSession,
  clearSessions,
  getMemory,
  addWeakPoint,
  updateWeakPoint,
  deleteWeakPoint,
  updateStrengths,
  clearMemory,
  getProfile,
  saveProfile,
  exportAll,
  importAll,
} from '../memory/store.js'
import { statsMaterials } from '../memory/materials.js'
import { listServers, listTools, closeAll } from '../sources/mcp.js'

/** 目录占用统计 */
function dirSize(dir) {
  let bytes = 0
  let files = 0
  try {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name)
      const st = fs.statSync(p)
      if (st.isDirectory()) {
        const sub = dirSize(p)
        bytes += sub.bytes
        files += sub.files
      } else {
        bytes += st.size
        files++
      }
    }
  } catch {
    /* 目录不存在 */
  }
  return { bytes, files }
}

export function mountAdmin(app, wrap) {
  /* ---------- 概览 ---------- */

  app.get('/api/admin/overview', wrap((_req, res) => {
    res.json({
      ok: true,
      overview: adminOverview(),
      materials: statsMaterials(),
      providers: Object.values(PROVIDERS).map((p) => ({
        id: p.id,
        label: p.label,
        ready: Boolean(p.apiKey),
        supportsVoice: p.supportsVoice,
        consoleUrl: p.consoleUrl,
      })),
      roleDefaults: ROLE_DEFAULTS,
      storage: { dir: DATA_DIR, ...dirSize(DATA_DIR) },
    })
  }))

  /* ---------- 面试记录 ---------- */

  app.get('/api/admin/sessions', wrap((_req, res) => {
    res.json({ ok: true, sessions: listSessions(500) })
  }))

  app.get('/api/admin/sessions/:id', wrap((req, res) => {
    const s = getSession(req.params.id)
    if (!s) return res.status(404).json({ ok: false, error: '会话不存在' })
    res.json({ ok: true, session: s })
  }))

  app.delete('/api/admin/sessions/:id', wrap((req, res) => {
    const okDel = deleteSession(req.params.id)
    if (!okDel) return res.status(404).json({ ok: false, error: '会话不存在' })
    res.json({ ok: true })
  }))

  app.delete('/api/admin/sessions', wrap((_req, res) => {
    res.json({ ok: true, removed: clearSessions() })
  }))

  /* ---------- 长期记忆 ---------- */

  app.get('/api/admin/memory', wrap((_req, res) => {
    res.json({ ok: true, memory: getMemory(), profile: getProfile() })
  }))

  app.post('/api/admin/memory/weak', wrap((req, res) => {
    const { topic, score, note } = req.body || {}
    if (!topic) return res.status(400).json({ ok: false, error: '缺少 topic' })
    res.json({ ok: true, weakPoints: addWeakPoint({ topic, score, note }) })
  }))

  app.patch('/api/admin/memory/weak', wrap((req, res) => {
    const { topic, ...patch } = req.body || {}
    if (!topic) return res.status(400).json({ ok: false, error: '缺少 topic' })
    const r = updateWeakPoint(topic, patch)
    if (!r) return res.status(404).json({ ok: false, error: '薄弱项不存在' })
    res.json({ ok: true, weakPoint: r })
  }))

  app.delete('/api/admin/memory/weak', wrap((req, res) => {
    const topic = req.body?.topic || req.query?.topic
    if (!topic) return res.status(400).json({ ok: false, error: '缺少 topic' })
    const okDel = deleteWeakPoint(topic)
    if (!okDel) return res.status(404).json({ ok: false, error: '薄弱项不存在' })
    res.json({ ok: true })
  }))

  app.put('/api/admin/memory/strengths', wrap((req, res) => {
    res.json({ ok: true, strengths: updateStrengths(req.body?.list || []) })
  }))

  app.delete('/api/admin/memory', wrap((_req, res) => {
    res.json({ ok: true, memory: clearMemory() })
  }))

  /* ---------- 档案 ---------- */

  app.get('/api/admin/profile', wrap((_req, res) => {
    res.json({ ok: true, profile: getProfile() })
  }))

  app.put('/api/admin/profile', wrap((req, res) => {
    res.json({ ok: true, profile: saveProfile(req.body || {}) })
  }))

  /* ---------- 系统 ---------- */

  app.get('/api/admin/system', wrap(async (req, res) => {
    const models = req.query.models === '1' ? await listAllModels({ force: req.query.force === '1' }) : null
    res.json({
      ok: true,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      uptime: Math.round(process.uptime()),
      pid: process.pid,
      storage: { dir: DATA_DIR, ...dirSize(DATA_DIR) },
      providers: Object.values(PROVIDERS).map((p) => ({
        id: p.id,
        label: p.label,
        short: p.short,
        ready: Boolean(p.apiKey),
        baseURL: p.baseURL,
        supportsVoice: p.supportsVoice,
        consoleUrl: p.consoleUrl,
      })),
      roleDefaults: ROLE_DEFAULTS,
      mcpServers: listServers(),
      models,
    })
  }))

  app.post('/api/admin/system/ping', wrap(async (req, res) => {
    const id = req.body?.provider
    res.json({ ok: true, provider: id, result: await pingProvider(id) })
  }))

  app.post('/api/admin/system/ping-all', wrap(async (_req, res) => {
    const results = {}
    await Promise.all(
      Object.keys(PROVIDERS).map(async (id) => {
        results[id] = await pingProvider(id)
      }),
    )
    res.json({ ok: true, results })
  }))

  app.get('/api/admin/mcp/:name/tools', wrap(async (req, res) => {
    res.json({ ok: true, tools: await listTools(req.params.name) })
  }))

  app.post('/api/admin/mcp/reload', wrap((_req, res) => {
    closeAll()
    res.json({ ok: true, servers: listServers() })
  }))

  /* ---------- 备份 / 还原 ---------- */

  app.get('/api/admin/export', wrap((_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="kewenguan-backup.json"')
    res.json({ ok: true, data: exportAll() })
  }))

  app.post('/api/admin/import', wrap((req, res) => {
    const payload = req.body?.data || req.body
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ ok: false, error: '数据格式不对' })
    }
    res.json({ ok: true, result: importAll(payload, { merge: req.body?.merge !== false }) })
  }))

  app.post('/api/admin/clear', wrap((req, res) => {
    const target = req.body?.target
    const out = {}
    if (target === 'sessions' || target === 'all') out.sessions = clearSessions()
    if (target === 'memory' || target === 'all') {
      clearMemory()
      out.memory = true
    }
    if (target === 'all') {
      out.profile = true
      saveProfile({ name: '', targetRole: '', company: '', level: '', years: '', jd: '', resume: '' })
    }
    res.json({ ok: true, cleared: out })
  }))
}
