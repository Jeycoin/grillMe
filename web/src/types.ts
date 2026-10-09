export interface ProviderInfo {
  id: string
  label: string
  short: string
  ready: boolean
  supportsVoice: boolean
  consoleUrl: string
}

export interface StageInfo {
  id: string
  name: string
  goal: string
  minutes: number
}

export interface PressureLevel {
  id: number
  name: string
  desc: string
  tone: string
}

export interface Archetype {
  id: string
  name: string
  focus: string
}

export interface VoiceOption {
  id: string
  label: string
  gender: string
  note: string
}

export interface TonePreset {
  pressure: number
  name: string
  instruction: string
}

export interface VoiceConfig {
  enabled: boolean
  provider: string
  voices: VoiceOption[]
  defaultVoice: string
  tones: TonePreset[]
}

export interface AppConfig {
  ok: boolean
  providers: ProviderInfo[]
  roleDefaults: Record<string, ModelRef>
  stages: StageInfo[]
  pressureLevels: PressureLevel[]
  archetypes: Archetype[]
  memory: { sessionCount: number; weakPointCount: number; updatedAt: string | null }
  materials?: { sets: number; total: number; enabled: number }
  mcpServers: { name: string; transport: string; command: string }[]
  voice?: VoiceConfig
}

export interface ModelRef {
  provider: string
  model: string
}

export interface ProviderModels {
  ok: boolean
  error?: string
  models: string[]
  total?: number
  cached?: boolean
}

export interface Profile {
  name: string
  targetRole: string
  company: string
  level: string
  years: string
  jd: string
  resume: string
  updatedAt?: string | null
}

export interface Question {
  question: string
  tags: string[]
  difficulty: 'easy' | 'medium' | 'hard' | string
}

export interface MaterialSet {
  id: string
  title: string
  url?: string
  source: string
  summary: string
  meta?: { company?: string; role?: string; sourceType?: string }
  questions: Question[]
  enabled: boolean
  createdAt: string
}

export interface Turn {
  q: string
  a: string | null
  stage: string
  at: string
}

export interface WeakPoint {
  topic: string
  score: number
  note: string
  hits?: number
  seenAt?: string
}

export interface Report {
  overall: number
  verdict: string
  dimensions: { name: string; score: number; comment: string }[]
  highlights: string[]
  weakPoints: WeakPoint[]
  nextActions: string[]
  spokenSummary: string
}

export interface SessionSummary {
  id: string
  startedAt: string
  endedAt: string | null
  stage: string
  pressure: number
  archetype: string
  turns: number
  report: Report | null
}

export interface MemoryData {
  weakPoints: WeakPoint[]
  strengths: string[]
  lastSummary: string
  sessionIds: string[]
  updatedAt: string | null
}
