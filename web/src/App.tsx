import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, clearLegacyMaterials, readLegacyMaterials, sayStream } from './api'
import type { AppConfig, MaterialSet, ModelRef, Profile, Report } from './types'
import Setup from './components/Setup'
import Interview from './components/Interview'
import ReportView from './components/Report'
import Toasts, { useToasts } from './components/Toasts'
import MaterialPanel from './components/MaterialPanel'
import ThemeToggle from './components/ThemeToggle'
import { unlockAudio } from './audio/recorder'

export type Phase = 'setup' | 'interview' | 'report'

/* ---------- 语音偏好的本地记忆（跟浏览器绑定，不需要上服务端） ---------- */

const VOICE_PREF_KEY = 'kewenguan.voice-prefs.v1'

interface VoicePrefs {
  voiceOn?: boolean
  voiceId?: string
  autoListen?: boolean
  autoSubmit?: boolean
}

function readVoicePrefs(): VoicePrefs {
  try {
    return JSON.parse(localStorage.getItem(VOICE_PREF_KEY) || '{}')
  } catch {
    return {}
  }
}

function writeVoicePrefs(p: VoicePrefs) {
  try {
    localStorage.setItem(VOICE_PREF_KEY, JSON.stringify(p))
  } catch {
    /* 忽略 */
  }
}

export interface SessionSettings {
  pressure: number
  archetype: string
  brain: ModelRef
  quick: ModelRef
  useMemory: boolean
  /** 语音对话总开关 */
  voiceOn: boolean
  /** 面试官音色 */
  voiceId: string
  /** 面试官说完自动开麦（全语音对话的核心） */
  autoListen: boolean
  /** 识别出文字后自动提交作答 */
  autoSubmit: boolean
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [materials, setMaterials] = useState<MaterialSet[]>([])
  const [phase, setPhase] = useState<Phase>('setup')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [settings, setSettings] = useState<SessionSettings | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)
  const { toasts, push, remove } = useToasts()

  const reloadMaterials = useCallback(async () => {
    try {
      const r = await api.materials()
      setMaterials(r.materials)
    } catch {
      /* 静默失败，不打断面试 */
    }
  }, [])

  /* 首次加载 */
  useEffect(() => {
    ;(async () => {
      try {
        // 浏览器里如果有旧版素材，先自动迁到服务端
        const legacy = readLegacyMaterials()
        if (legacy.length) {
          try {
            await api.importMaterials(legacy)
            clearLegacyMaterials()
            push(`已把浏览器里 ${legacy.length} 份面经迁移到服务端`)
          } catch {
            /* 迁移失败不阻塞启动 */
          }
        }

        const [cfg, prof] = await Promise.all([api.config(), api.getProfile()])
        setConfig(cfg)
        setProfile(prof.profile)
        setSettings((s) => {
          if (s) return s
          const saved = readVoicePrefs()
          return {
            pressure: 2,
            archetype: 'tech',
            brain: cfg.roleDefaults.brain,
            quick: cfg.roleDefaults.quick,
            useMemory: true,
            // 这个产品的核心就是"全程语音对话"，所以只要语音可用就默认开着。
            // 用户嫌吵可以一键关掉（配置页和面试页都有开关）。
            voiceOn: saved.voiceOn ?? Boolean(cfg.voice?.enabled),
            voiceId: saved.voiceId || cfg.voice?.defaultVoice || 'Cherry',
            autoListen: saved.autoListen ?? true,
            autoSubmit: saved.autoSubmit ?? true,
          }
        })
        await reloadMaterials()
      } catch (e) {
        setBootError(String((e as Error).message || e))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* 语音偏好落本地，下次打开还记住 */
  useEffect(() => {
    if (!settings) return
    writeVoicePrefs({
      voiceOn: settings.voiceOn,
      voiceId: settings.voiceId,
      autoListen: settings.autoListen,
      autoSubmit: settings.autoSubmit,
    })
  }, [settings?.voiceOn, settings?.voiceId, settings?.autoListen, settings?.autoSubmit])

  const enabledMaterial = useMemo(() => {
    const flat: { question: string; tags: string[]; company?: string; source?: string }[] = []
    for (const m of materials) {
      if (!m.enabled) continue
      for (const q of m.questions) {
        flat.push({
          question: q.question,
          tags: q.tags,
          company: m.meta?.company || m.title,
          source: m.source,
        })
      }
    }
    return flat
  }, [materials])

  const start = useCallback(async () => {
    if (!settings) return

    // 借这次点击唤醒音频子系统。
    // 后面"面试官说完自动开麦"不是由手势触发的，
    // 如果等到那时候才建 AudioContext，浏览器会把它挂起，麦克风就收不到声音。
    if (settings.voiceOn) void unlockAudio()

    try {
      const r = await api.createSession({
        pressure: settings.pressure,
        archetype: settings.archetype,
        brain: settings.brain,
        quick: settings.quick,
        material: enabledMaterial,
        useMemory: settings.useMemory,
      })
      setSessionId(r.sessionId)
      setReport(null)
      setPhase('interview')
    } catch (e) {
      push(String((e as Error).message || e), 'err')
    }
  }, [settings, enabledMaterial, push])

  const finish = useCallback(async () => {
    if (!sessionId) return
    try {
      const r = await api.finish(sessionId)
      setReport(r.report)
      setPhase('report')
      api.config().then(setConfig).catch(() => {})
    } catch (e) {
      push(`生成报告失败：${String((e as Error).message || e)}`, 'err')
    }
  }, [sessionId, push])

  const restart = useCallback(() => {
    setSessionId(null)
    setReport(null)
    setPhase('setup')
  }, [])

  if (bootError) {
    return (
      <div className="app">
        <div className="page page-narrow" style={{ paddingTop: 80 }}>
          <div className="card">
            <div className="card-head">
              <span className="card-title" style={{ color: 'var(--danger)' }}>
                连不上后端
              </span>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              {bootError}
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              请确认已执行 <code className="mono">npm run dev</code>，且后端跑在 8787 端口。
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!config || !settings || !profile) {
    return (
      <div className="app">
        <div className="page page-narrow" style={{ paddingTop: 120, textAlign: 'center' }}>
          <span className="spinner" /> <span className="muted">正在唤醒面试官…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <TopBar
        config={config}
        phase={phase}
        onOpenDrawer={() => setDrawer(true)}
        onRestart={restart}
        materialCount={enabledMaterial.length}
      />

      {phase === 'setup' && (
        <Setup
          config={config}
          profile={profile}
          settings={settings}
          materials={materials}
          enabledCount={enabledMaterial.length}
          onChangeProfile={async (p) => setProfile((await api.saveProfile(p)).profile)}
          onChangeSettings={setSettings}
          onOpenMaterial={() => setDrawer(true)}
          onStart={start}
        />
      )}

      {phase === 'interview' && sessionId && (
        <Interview
          sessionId={sessionId}
          settings={settings}
          stages={config.stages}
          onFinish={finish}
          push={push}
          sayStream={sayStream}
        />
      )}

      {phase === 'report' && report && <ReportView report={report} onRestart={restart} />}

      {drawer && (
        <MaterialPanel
          materials={materials}
          config={config}
          onChange={reloadMaterials}
          onClose={() => setDrawer(false)}
          push={push}
        />
      )}

      <Toasts toasts={toasts} onDismiss={remove} />
    </div>
  )
}

function TopBar({
  config,
  phase,
  onOpenDrawer,
  onRestart,
  materialCount,
}: {
  config: AppConfig
  phase: Phase
  onOpenDrawer: () => void
  onRestart: () => void
  materialCount: number
}) {
  const readyCount = config.providers.filter((p) => p.ready).length
  const weakCount = config.memory?.weakPointCount || 0

  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-mark">拷问官</span>
        <span className="brand-sub">AI INTERVIEWER</span>
      </div>

      {weakCount > 0 && (
        <span className="tag" title="长期记忆里记录的薄弱项数量">
          记忆 {weakCount} 项弱项
        </span>
      )}
      {materialCount > 0 && (
        <span className="tag tag-brand" title="本次加载的外部面经题目数">
          面经 {materialCount} 题
        </span>
      )}

      <div className="topbar-spacer" />

      <span className="status">
        <i />
        {readyCount} 家模型在线
      </span>

      <ThemeToggle />

      <button className="btn btn-sm btn-ghost" onClick={onOpenDrawer}>
        面经库
      </button>
      {phase !== 'setup' && (
        <button className="btn btn-sm btn-ghost" onClick={onRestart}>
          重新开始
        </button>
      )}
      <a className="btn btn-sm btn-ghost" href="/admin" style={{ textDecoration: 'none' }}>
        后台管理
      </a>
    </div>
  )
}
