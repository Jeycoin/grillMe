import type {
  AppConfig,
  MaterialSet,
  MemoryData,
  ModelRef,
  Profile,
  ProviderModels,
  Report,
  SessionSummary,
  TonePreset,
  VoiceOption,
} from './types'

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
  if (!res.ok || body.ok === false) throw new Error(body.error || `请求失败 HTTP ${res.status}`)
  return body as T
}

export const api = {
  config: () => jsonFetch<AppConfig>('/api/config'),

  models: (force = false) =>
    jsonFetch<{ providers: Record<string, ProviderModels> }>(
      `/api/models${force ? '?force=1' : ''}`,
    ),

  ping: (provider: string) =>
    jsonFetch<{ result: { ok: boolean; latency: number; error?: string; count?: number } }>(
      '/api/models/ping',
      { method: 'POST', body: JSON.stringify({ provider }) },
    ),

  getProfile: () => jsonFetch<{ profile: Profile }>('/api/profile'),
  saveProfile: (p: Partial<Profile>) =>
    jsonFetch<{ profile: Profile }>('/api/profile', { method: 'POST', body: JSON.stringify(p) }),

  getMemory: () => jsonFetch<{ memory: MemoryData }>('/api/memory'),
  sessions: () => jsonFetch<{ sessions: SessionSummary[] }>('/api/sessions'),
  session: (id: string) => jsonFetch<{ session: unknown }>(`/api/sessions/${id}`),

  createSession: (opts: {
    pressure: number
    archetype: string
    brain?: ModelRef
    quick?: ModelRef
    material?: { question: string; tags?: string[]; company?: string; source?: string }[]
    useMemory?: boolean
  }) =>
    jsonFetch<{ sessionId: string; state: { id: string; name: string } }>('/api/session', {
      method: 'POST',
      body: JSON.stringify(opts),
    }),

  finish: (id: string) =>
    jsonFetch<{ report: Report }>(`/api/session/${id}/finish`, { method: 'POST' }),

  importUrl: (url: string, hint?: string) =>
    jsonFetch<Omit<MaterialSet, 'id' | 'enabled' | 'createdAt' | 'source'>>(
      '/api/material/url',
      { method: 'POST', body: JSON.stringify({ url, hint }) },
    ),

  importText: (text: string, hint?: string) =>
    jsonFetch<Omit<MaterialSet, 'id' | 'enabled' | 'createdAt' | 'source'>>(
      '/api/material/text',
      { method: 'POST', body: JSON.stringify({ text, hint }) },
    ),

  mcpServers: () =>
    jsonFetch<{ servers: { name: string; transport: string; command: string }[] }>(
      '/api/mcp/servers',
    ),

  mcpTools: (name: string) =>
    jsonFetch<{ tools: { name: string; description?: string; inputSchema?: unknown }[] }>(
      `/api/mcp/${encodeURIComponent(name)}/tools`,
    ),

  mcpCall: (name: string, tool: string, args: Record<string, unknown>) =>
    jsonFetch<{ result: { text: string; isError: boolean } }>(
      `/api/mcp/${encodeURIComponent(name)}/call`,
      { method: 'POST', body: JSON.stringify({ tool, args }) },
    ),

  /* ---------- 面经素材（服务端） ---------- */

  materials: () =>
    jsonFetch<{ materials: MaterialSet[]; stats: { sets: number; total: number; enabled: number } }>(
      '/api/materials',
    ),

  createMaterial: (m: Partial<MaterialSet>) =>
    jsonFetch<{ material: MaterialSet }>('/api/materials', {
      method: 'POST',
      body: JSON.stringify(m),
    }),

  patchMaterial: (id: string, p: Partial<MaterialSet>) =>
    jsonFetch<{ material: MaterialSet }>(`/api/materials/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(p),
    }),

  deleteMaterial: (id: string) =>
    jsonFetch<{ ok: true }>(`/api/materials/${id}`, { method: 'DELETE' }),

  importMaterials: (items: MaterialSet[]) =>
    jsonFetch<{ added: number; total: number }>('/api/materials/import', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

  extract: (b: { url?: string; text?: string; hint?: string; title?: string }) =>
    jsonFetch<{
      preview: {
        title: string
        url?: string
        summary: string
        meta: { company?: string; role?: string; sourceType?: string }
        questions: { question: string; tags: string[]; difficulty: string }[]
      }
    }>('/api/materials/extract', { method: 'POST', body: JSON.stringify(b) }),

  /* ---------- 语音 ---------- */

  voiceInfo: () =>
    jsonFetch<{ voices: VoiceOption[]; defaultVoice: string; tones: TonePreset[] }>(
      '/api/voice/info',
    ),

  voiceHealth: () =>
    jsonFetch<{
      tts: { ok: boolean; bytes?: number; ms?: number; error?: string }
      asr: { ok: boolean; text?: string; ms?: number; error?: string }
    }>('/api/voice/health'),

  /** 合成语音，拿回 WAV Blob。语气由服务端按压力档 + 面试官类型组装 */
  tts: async (
    text: string,
    opts: { voice?: string; tone?: string; pressure?: number; archetype?: string; signal?: AbortSignal } = {},
  ): Promise<Blob> => {
    const res = await fetch('/api/voice/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voice: opts.voice,
        tone: opts.tone,
        pressure: opts.pressure,
        archetype: opts.archetype,
      }),
      signal: opts.signal,
    })
    if (!res.ok) {
      const msg = await res.text().catch(() => '')
      throw new Error(`语音合成失败 HTTP ${res.status} ${msg.slice(0, 120)}`)
    }
    return res.blob()
  },

  /** 上传 WAV，拿回文字 */
  asr: async (
    wav: Blob,
    signal?: AbortSignal,
  ): Promise<{ text: string; emotion?: string; language?: string; empty: boolean }> => {
    const res = await fetch('/api/voice/asr', {
      method: 'POST',
      headers: { 'Content-Type': wav.type || 'audio/wav' },
      body: wav,
      signal,
    })
    const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
    if (!res.ok || body.ok === false) throw new Error(body.error || `识别失败 HTTP ${res.status}`)
    return body
  },
}

export interface SayEvent {
  type: 'delta' | 'reasoning' | 'usage' | 'turn' | 'stage' | 'error'
  text?: string
  stage?: { id: string; name: string; turns: number }
  error?: string
}

/**
 * 面试官说话（SSE 流式）。通过回调逐块推送。
 */
export async function sayStream(
  sessionId: string,
  userText: string,
  onEvent: (ev: SayEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/session/${sessionId}/say`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userText }),
    signal,
  })
  if (!res.ok || !res.body) {
    const msg = await res.text().catch(() => '')
    throw new Error(`面试官掉线了：HTTP ${res.status} ${msg.slice(0, 120)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const line = chunk.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        onEvent(JSON.parse(payload) as SayEvent)
      } catch {
        /* 忽略坏块 */
      }
    }
  }
}

/* ---------- 旧版 localStorage 数据（仅用于迁移） ---------- */

const LEGACY_MAT_KEY = 'kewenguan.materials.v1'

export function readLegacyMaterials(): MaterialSet[] {
  try {
    const arr = JSON.parse(localStorage.getItem(LEGACY_MAT_KEY) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function clearLegacyMaterials() {
  try {
    localStorage.removeItem(LEGACY_MAT_KEY)
  } catch {
    /* ignore */
  }
}
