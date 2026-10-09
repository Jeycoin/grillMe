import type { MaterialSet, Profile, Report, WeakPoint } from '../types'

export interface AdminProviderInfo {
  id: string
  label: string
  short?: string
  ready: boolean
  supportsVoice: boolean
  baseURL?: string
  consoleUrl: string
}

export interface TrendPoint {
  id: string
  at: string
  score: number
  verdict: string
}

export interface AdminOverview {
  sessions: number
  scored: number
  avgScore: number | null
  bestScore: number | null
  totalTurns: number
  weakPoints: number
  strengths: number
  trend: TrendPoint[]
  topWeak: WeakPoint[]
  recent: AdminSessionSummary[]
  lastSummary: string
  updatedAt: string | null
}

export interface AdminSessionSummary {
  id: string
  startedAt: string
  endedAt: string | null
  stage: string
  pressure: number
  archetype: string
  turns: number
  report: Report | null
}

export interface AdminSessionDetail extends AdminSessionSummary {
  transcript: { q: string; a: string | null; stage: string; at: string }[]
  profile?: Profile
  brain?: { provider: string; model: string }
  materialCount?: number
}

export interface MemoryData {
  weakPoints: WeakPoint[]
  strengths: string[]
  lastSummary: string
  sessionIds: string[]
  updatedAt: string | null
}

export interface SystemInfo {
  node: string
  platform: string
  uptime: number
  pid: number
  storage: { dir: string; bytes: number; files: number }
  providers: AdminProviderInfo[]
  roleDefaults: Record<string, { provider: string; model: string }>
  mcpServers: { name: string; transport: string; command: string }[]
}

async function jf<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
  if (!res.ok || body.ok === false) throw new Error(body.error || `请求失败 HTTP ${res.status}`)
  return body as T
}

export const adminApi = {
  overview: () =>
    jf<{
      overview: AdminOverview
      materials: { sets: number; total: number; enabled: number }
      providers: AdminProviderInfo[]
      roleDefaults: Record<string, { provider: string; model: string }>
      storage: { dir: string; bytes: number; files: number }
    }>('/api/admin/overview'),

  sessions: () => jf<{ sessions: AdminSessionSummary[] }>('/api/admin/sessions'),
  session: (id: string) => jf<{ session: AdminSessionDetail }>(`/api/admin/sessions/${id}`),
  deleteSession: (id: string) =>
    jf<{ ok: true }>(`/api/admin/sessions/${id}`, { method: 'DELETE' }),
  clearSessions: () => jf<{ removed: number }>('/api/admin/sessions', { method: 'DELETE' }),

  memory: () => jf<{ memory: MemoryData; profile: Profile }>('/api/admin/memory'),
  addWeak: (b: { topic: string; score?: number; note?: string }) =>
    jf<{ weakPoints: WeakPoint[] }>('/api/admin/memory/weak', {
      method: 'POST',
      body: JSON.stringify(b),
    }),
  patchWeak: (topic: string, patch: Partial<WeakPoint>) =>
    jf<{ weakPoint: WeakPoint }>('/api/admin/memory/weak', {
      method: 'PATCH',
      body: JSON.stringify({ topic, ...patch }),
    }),
  deleteWeak: (topic: string) =>
    jf<{ ok: true }>('/api/admin/memory/weak', {
      method: 'DELETE',
      body: JSON.stringify({ topic }),
    }),
  setStrengths: (list: string[]) =>
    jf<{ strengths: string[] }>('/api/admin/memory/strengths', {
      method: 'PUT',
      body: JSON.stringify({ list }),
    }),
  clearMemory: () => jf<{ memory: MemoryData }>('/api/admin/memory', { method: 'DELETE' }),

  profile: () => jf<{ profile: Profile }>('/api/admin/profile'),
  saveProfile: (p: Partial<Profile>) =>
    jf<{ profile: Profile }>('/api/admin/profile', { method: 'PUT', body: JSON.stringify(p) }),

  materials: () =>
    jf<{ materials: MaterialSet[]; stats: { sets: number; total: number; enabled: number } }>(
      '/api/materials',
    ),
  createMaterial: (m: Partial<MaterialSet>) =>
    jf<{ material: MaterialSet }>('/api/materials', { method: 'POST', body: JSON.stringify(m) }),
  patchMaterial: (id: string, p: Partial<MaterialSet>) =>
    jf<{ material: MaterialSet }>(`/api/materials/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
  deleteMaterial: (id: string) => jf<{ ok: true }>(`/api/materials/${id}`, { method: 'DELETE' }),
  importMaterials: (items: MaterialSet[]) =>
    jf<{ added: number; total: number }>('/api/materials/import', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
  extract: (b: { url?: string; text?: string; hint?: string; title?: string }) =>
    jf<{
      preview: {
        title: string
        url?: string
        summary: string
        meta: { company?: string; role?: string; sourceType?: string }
        questions: { question: string; tags: string[]; difficulty: string }[]
      }
    }>('/api/materials/extract', { method: 'POST', body: JSON.stringify(b) }),

  system: (withModels = false, force = false) =>
    jf<SystemInfo & { models: Record<string, { ok: boolean; models: string[]; error?: string }> | null }>(
      `/api/admin/system${withModels ? `?models=1${force ? '&force=1' : ''}` : ''}`,
    ),
  ping: (provider: string) =>
    jf<{ result: { ok: boolean; latency: number; error?: string; count?: number } }>(
      '/api/admin/system/ping',
      { method: 'POST', body: JSON.stringify({ provider }) },
    ),
  pingAll: () =>
    jf<{ results: Record<string, { ok: boolean; latency: number; error?: string; count?: number }> }>(
      '/api/admin/system/ping-all',
      { method: 'POST' },
    ),
  mcpReload: () => jf<{ servers: { name: string; transport: string; command: string }[] }>(
    '/api/admin/mcp/reload',
    { method: 'POST' },
  ),
  mcpTools: (name: string) =>
    jf<{ tools: { name: string; description?: string }[] }>(
      `/api/admin/mcp/${encodeURIComponent(name)}/tools`,
    ),

  exportAll: () => jf<{ data: unknown }>('/api/admin/export'),
  importAll: (data: unknown, merge = true) =>
    jf<{ result: { profile: boolean; memory: boolean; sessions: number } }>('/api/admin/import', {
      method: 'POST',
      body: JSON.stringify({ data, merge }),
    }),
  clear: (target: 'sessions' | 'memory' | 'all') =>
    jf<{ cleared: Record<string, unknown> }>('/api/admin/clear', {
      method: 'POST',
      body: JSON.stringify({ target }),
    }),
}

/* ---------- 小工具 ---------- */

export function fmtBytes(n: number) {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function fmtTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function fmtDur(from: string, to: string | null) {
  if (!to) return '进行中'
  const ms = new Date(to).getTime() - new Date(from).getTime()
  const min = Math.round(ms / 60000)
  if (min < 1) return '<1 分钟'
  return `${min} 分钟`
}

export function scoreClass(score: number | null | undefined) {
  if (score == null) return 'none'
  if (score >= 75) return 'good'
  if (score >= 55) return 'mid'
  return 'bad'
}

/**
 * 薄弱项的"严重度"。
 * 注意方向：0-10 的得分里，分越低问题越严重，所以进度条要**反过来画**才符合直觉。
 * score=1 → 0.9（又长又红，一眼看出这是硬伤）
 * score=9 → 0.1（短条，基本可以不管了）
 */
export function severity(score: number | null | undefined) {
  const s = Math.min(10, Math.max(0, Number(score ?? 5)))
  return (10 - s) / 10
}

export function sevClass(score: number | null | undefined) {
  const s = Number(score ?? 5)
  if (s >= 7) return 'good'
  if (s >= 5) return 'mid'
  return ''
}
