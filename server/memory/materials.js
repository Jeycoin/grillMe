/**
 * 面经素材库（服务端）
 *
 * 原先存在浏览器 localStorage，换设备就丢。这里统一落盘，
 * 前端 localStorage 的旧数据会在首次打开时自动迁移上来。
 */
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../config.js'

const FILE = path.join(DATA_DIR, 'materials.json')

function read() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    return Array.isArray(d) ? d : []
  } catch {
    return []
  }
}

function write(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const tmp = `${FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8')
  fs.renameSync(tmp, FILE)
  return list
}

export function listMaterials() {
  return read()
}

export function getMaterial(id) {
  return read().find((m) => m.id === id) || null
}

function makeId() {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function createMaterial(input = {}) {
  const list = read()
  const item = {
    id: makeId(),
    title: String(input.title || '未命名素材').slice(0, 120),
    url: input.url || '',
    source: input.source || '手动添加',
    summary: input.summary || '',
    meta: input.meta && typeof input.meta === 'object' ? input.meta : {},
    questions: Array.isArray(input.questions)
      ? input.questions
          .filter((q) => q && typeof q.question === 'string' && q.question.trim())
          .map((q) => ({
            question: q.question.trim(),
            tags: Array.isArray(q.tags) ? q.tags.slice(0, 6) : [],
            difficulty: q.difficulty || 'medium',
          }))
      : [],
    enabled: input.enabled !== false,
    createdAt: new Date().toISOString(),
  }
  write([item, ...list])
  return item
}

export function updateMaterial(id, patch = {}) {
  const list = read()
  const idx = list.findIndex((m) => m.id === id)
  if (idx < 0) return null
  const allowed = ['title', 'enabled', 'summary', 'meta', 'questions', 'url', 'source']
  const next = { ...list[idx] }
  for (const k of allowed) if (k in patch) next[k] = patch[k]
  list[idx] = next
  write(list)
  return next
}

export function deleteMaterial(id) {
  const list = read()
  const next = list.filter((m) => m.id !== id)
  if (next.length === list.length) return false
  write(next)
  return true
}

/** 批量导入（用于前端 localStorage 迁移 / 备份还原），按 id 去重 */
export function bulkImport(items = []) {
  const list = read()
  const seen = new Set(list.map((m) => m.id))
  let added = 0
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const id = raw.id && !seen.has(raw.id) ? raw.id : makeId()
    seen.add(id)
    list.push({
      id,
      title: String(raw.title || '未命名素材').slice(0, 120),
      url: raw.url || '',
      source: raw.source || '导入',
      summary: raw.summary || '',
      meta: raw.meta || {},
      questions: Array.isArray(raw.questions) ? raw.questions : [],
      enabled: raw.enabled !== false,
      createdAt: raw.createdAt || new Date().toISOString(),
    })
    added++
  }
  write(list)
  return { added, total: list.length }
}

export function statsMaterials() {
  const list = read()
  return {
    sets: list.length,
    total: list.reduce((n, m) => n + (m.questions?.length || 0), 0),
    enabled: list.filter((m) => m.enabled).reduce((n, m) => n + (m.questions?.length || 0), 0),
  }
}
