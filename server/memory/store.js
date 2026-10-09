/**
 * 本地持久化：用户档案 / 会话记录 / 长期记忆
 *
 * 全部落在 data/ 目录下的 JSON 里，不上云、不外传。
 */
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../config.js'

const SESSIONS_DIR = path.join(DATA_DIR, 'sessions')
const PROFILE_FILE = path.join(DATA_DIR, 'profile.json')
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json')

function ensureDirs() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true })
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** 原子写，避免写一半把文件写坏 */
function writeJSON(file, data) {
  ensureDirs()
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

/* ---------------- 用户档案 ---------------- */

export function getProfile() {
  return readJSON(PROFILE_FILE, {
    name: '',
    targetRole: '',
    company: '',
    level: '',
    years: '',
    jd: '',
    resume: '',
    updatedAt: null,
  })
}

export function saveProfile(patch) {
  const next = { ...getProfile(), ...patch, updatedAt: new Date().toISOString() }
  writeJSON(PROFILE_FILE, next)
  return next
}

/* ---------------- 会话 ---------------- */

export function newSessionId() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`
}

export function saveSession(session) {
  ensureDirs()
  writeJSON(path.join(SESSIONS_DIR, `${session.id}.json`), session)
}

export function getSession(id) {
  const safe = String(id).replace(/[^a-zA-Z0-9-]/g, '')
  return readJSON(path.join(SESSIONS_DIR, `${safe}.json`), null)
}

export function listSessions(limit = 50) {
  ensureDirs()
  const files = fs
    .readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit)
  return files
    .map((f) => readJSON(path.join(SESSIONS_DIR, f), null))
    .filter(Boolean)
    .map((s) => ({
      id: s.id,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      stage: s.stage,
      pressure: s.pressure,
      archetype: s.archetype,
      turns: s.transcript?.length || 0,
      report: s.report || null,
    }))
}

/* ---------------- 长期记忆 ---------------- */

export function getMemory() {
  return readJSON(MEMORY_FILE, {
    weakPoints: [], // [{ topic, score, note, seenAt }]
    strengths: [],
    lastSummary: '',
    sessionIds: [],
    updatedAt: null,
  })
}

/**
 * 把一次面试的评分结果沉淀进长期记忆。
 * 薄弱项按 topic 合并：同 topic 取最低分并累加次数。
 */
export function absorbReport(report, sessionId) {
  const mem = getMemory()
  if (!report) return mem

  const byTopic = new Map(mem.weakPoints.map((w) => [w.topic, w]))
  for (const w of report.weakPoints || []) {
    if (!w?.topic) continue
    const prev = byTopic.get(w.topic)
    if (prev) {
      prev.score = Math.min(prev.score ?? 10, w.score ?? 10)
      prev.hits = (prev.hits || 1) + 1
      prev.note = w.note || prev.note
      prev.seenAt = new Date().toISOString()
    } else {
      byTopic.set(w.topic, {
        topic: w.topic,
        score: w.score ?? 5,
        note: w.note || '',
        hits: 1,
        seenAt: new Date().toISOString(),
      })
    }
  }

  // 同一题反复错 → 往上顶
  const weakPoints = [...byTopic.values()].sort(
    (a, b) => (b.hits || 1) - (a.hits || 1) || (a.score ?? 10) - (b.score ?? 10),
  )

  const strengths = [...new Set([...(mem.strengths || []), ...(report.highlights || [])])].slice(-20)

  const next = {
    weakPoints: weakPoints.slice(0, 40),
    strengths,
    lastSummary: report.spokenSummary || report.verdict || mem.lastSummary,
    sessionIds: [...(mem.sessionIds || []), sessionId].slice(-100),
    updatedAt: new Date().toISOString(),
  }
  writeJSON(MEMORY_FILE, next)
  return next
}

export function getMemoryStats() {
  const mem = getMemory()
  return {
    sessionCount: mem.sessionIds?.length || 0,
    weakPointCount: mem.weakPoints?.length || 0,
    updatedAt: mem.updatedAt,
  }
}

/* ---------------- 管理台专用操作 ---------------- */

export function deleteSession(id) {
  const safe = String(id).replace(/[^a-zA-Z0-9-]/g, '')
  const file = path.join(SESSIONS_DIR, `${safe}.json`)
  if (!fs.existsSync(file)) return false
  fs.unlinkSync(file)
  // 同步从记忆里摘掉引用
  const mem = getMemory()
  mem.sessionIds = (mem.sessionIds || []).filter((x) => x !== safe)
  writeJSON(MEMORY_FILE, mem)
  return true
}

export function clearSessions() {
  ensureDirs()
  let n = 0
  for (const f of fs.readdirSync(SESSIONS_DIR)) {
    if (f.endsWith('.json')) {
      fs.unlinkSync(path.join(SESSIONS_DIR, f))
      n++
    }
  }
  const mem = getMemory()
  mem.sessionIds = []
  writeJSON(MEMORY_FILE, mem)
  return n
}

/** 读取某场会话的完整原文 */
export function getRawSession(id) {
  return getSession(id)
}

export function updateWeakPoint(topic, patch = {}) {
  const mem = getMemory()
  const idx = mem.weakPoints.findIndex((w) => w.topic === topic)
  if (idx < 0) return null
  const allowed = ['topic', 'score', 'note', 'hits']
  for (const k of allowed) if (k in patch) mem.weakPoints[idx][k] = patch[k]
  mem.updatedAt = new Date().toISOString()
  writeJSON(MEMORY_FILE, mem)
  return mem.weakPoints[idx]
}

export function deleteWeakPoint(topic) {
  const mem = getMemory()
  const next = mem.weakPoints.filter((w) => w.topic !== topic)
  if (next.length === mem.weakPoints.length) return false
  mem.weakPoints = next
  mem.updatedAt = new Date().toISOString()
  writeJSON(MEMORY_FILE, mem)
  return true
}

export function addWeakPoint({ topic, score = 5, note = '' }) {
  if (!topic) return null
  const mem = getMemory()
  const exist = mem.weakPoints.find((w) => w.topic === topic)
  if (exist) {
    exist.score = score
    exist.note = note || exist.note
  } else {
    mem.weakPoints.push({ topic, score, note, hits: 1, seenAt: new Date().toISOString() })
  }
  mem.updatedAt = new Date().toISOString()
  writeJSON(MEMORY_FILE, mem)
  return mem.weakPoints
}

export function updateStrengths(list) {
  const mem = getMemory()
  mem.strengths = (Array.isArray(list) ? list : []).filter(Boolean).slice(0, 50)
  mem.updatedAt = new Date().toISOString()
  writeJSON(MEMORY_FILE, mem)
  return mem.strengths
}

export function clearMemory() {
  const next = {
    weakPoints: [],
    strengths: [],
    lastSummary: '',
    sessionIds: [],
    updatedAt: new Date().toISOString(),
  }
  writeJSON(MEMORY_FILE, next)
  return next
}

/* ---------------- 备份 / 还原 ---------------- */

export function exportAll() {
  ensureDirs()
  const sessions = fs
    .readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJSON(path.join(SESSIONS_DIR, f), null))
    .filter(Boolean)
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: getProfile(),
    memory: getMemory(),
    sessions,
  }
}

export function importAll(payload = {}, { merge = true } = {}) {
  const result = { profile: false, memory: false, sessions: 0 }
  if (!merge) {
    clearSessions()
    clearMemory()
  }
  if (payload.profile && typeof payload.profile === 'object') {
    writeJSON(PROFILE_FILE, payload.profile)
    result.profile = true
  }
  if (payload.memory && typeof payload.memory === 'object') {
    const cur = merge ? getMemory() : null
    const next = cur
      ? {
          weakPoints: dedupeWeak([...(cur.weakPoints || []), ...(payload.memory.weakPoints || [])]),
          strengths: [...new Set([...(cur.strengths || []), ...(payload.memory.strengths || [])])],
          lastSummary: payload.memory.lastSummary || cur.lastSummary,
          sessionIds: [...new Set([...(cur.sessionIds || []), ...(payload.memory.sessionIds || [])])],
          updatedAt: new Date().toISOString(),
        }
      : payload.memory
    writeJSON(MEMORY_FILE, next)
    result.memory = true
  }
  if (Array.isArray(payload.sessions)) {
    ensureDirs()
    for (const s of payload.sessions) {
      if (!s?.id) continue
      saveSession(s)
      result.sessions++
    }
  }
  return result
}

function dedupeWeak(list) {
  const map = new Map()
  for (const w of list) {
    if (!w?.topic) continue
    const prev = map.get(w.topic)
    if (!prev) map.set(w.topic, w)
    else {
      prev.hits = (prev.hits || 1) + (w.hits || 1)
      prev.score = Math.min(prev.score ?? 10, w.score ?? 10)
      prev.note = w.note || prev.note
    }
  }
  return [...map.values()]
}

/** 管理台概览：会话评分趋势等 */
export function adminOverview() {
  const sessions = listSessions(200)
  const scored = sessions
    .filter((s) => s.report?.overall != null)
    .map((s) => ({ id: s.id, at: s.startedAt, score: s.report.overall, verdict: s.report.verdict }))
    .reverse() // 时间正序，方便画趋势

  const mem = getMemory()
  return {
    sessions: sessions.length,
    scored: scored.length,
    avgScore: scored.length
      ? Math.round((scored.reduce((n, s) => n + s.score, 0) / scored.length) * 10) / 10
      : null,
    bestScore: scored.length ? Math.max(...scored.map((s) => s.score)) : null,
    totalTurns: sessions.reduce((n, s) => n + (s.turns || 0), 0),
    weakPoints: mem.weakPoints?.length || 0,
    strengths: mem.strengths?.length || 0,
    trend: scored.slice(-20),
    topWeak: [...(mem.weakPoints || [])]
      .sort((a, b) => (b.hits || 1) - (a.hits || 1) || (a.score ?? 10) - (b.score ?? 10))
      .slice(0, 8),
    recent: sessions.slice(0, 8),
    lastSummary: mem.lastSummary || '',
    updatedAt: mem.updatedAt,
  }
}
