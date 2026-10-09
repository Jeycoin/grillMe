import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SayEvent } from '../api'
import type { StageInfo } from '../types'
import type { SessionSettings } from '../App'
import { useVoice } from '../audio/useVoice'
import { unlockAudio } from '../audio/recorder'

interface Ex {
  id: number
  q: string
  a: string | null
  stage: string
  viaVoice?: boolean
}

interface Props {
  sessionId: string
  settings: SessionSettings
  stages: StageInfo[]
  onFinish: () => void
  push: (t: string, k?: 'info' | 'err') => void
  sayStream: (
    id: string,
    userText: string,
    onEvent: (ev: SayEvent) => void,
    signal?: AbortSignal,
  ) => Promise<void>
}

export default function Interview({ sessionId, settings, stages, onFinish, push, sayStream }: Props) {
  const [exchanges, setExchanges] = useState<Ex[]>([])
  const [streaming, setStreaming] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('warmup')
  const [draft, setDraft] = useState('')
  const [opening, setOpening] = useState(true)
  const [voiceOn, setVoiceOn] = useState(settings.voiceOn)

  const idRef = useRef(1)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const startedRef = useRef(false)
  const busyRef = useRef(false)
  const endedRef = useRef(false)

  /* ---------------- 语音 ---------------- */

  const voiceRef = useRef<ReturnType<typeof useVoice> | null>(null)

  const voice = useVoice({
    enabled: voiceOn,
    voice: settings.voiceId,
    pressure: settings.pressure,
    archetype: settings.archetype,
    onTranscript: (text) => {
      // 识别结果直接作为作答
      setDraft(text)
      if (settings.autoSubmit) {
        submitRef.current?.(text, true)
      }
    },
    onError: (m) => push(m, 'err'),
    onSpokenEnd: () => {
      // 面试官说完 → 自动开麦，形成"一来一往"的全语音对话
      if (!voiceOn || !settings.autoListen || endedRef.current || busyRef.current) return
      void voiceRef.current?.startListening()
    },
  })
  voiceRef.current = voice

  /* ---------------- 追问 ---------------- */

  const ask = useCallback(
    async (userText: string) => {
      setBusy(true)
      busyRef.current = true
      setStreaming('')
      const ctl = new AbortController()
      abortRef.current = ctl
      let acc = ''
      let gotTurn = false

      // 开麦期间先别让面试官说话被打断
      if (voiceOn) voiceRef.current?.beginSpeak()

      try {
        await sayStream(
          sessionId,
          userText,
          (ev) => {
            if (ev.stage) setStage(ev.stage.id)
            if (ev.type === 'delta') {
              acc += ev.text || ''
              setStreaming(acc)
              if (voiceOn) voiceRef.current?.feedSpeak(ev.text || '')
            } else if (ev.type === 'error') {
              push(ev.error || '面试官出错了', 'err')
            } else if (ev.type === 'turn') {
              gotTurn = true
            }
          },
          ctl.signal,
        )
      } catch (e) {
        if ((e as Error).name !== 'AbortError') push(String((e as Error).message || e), 'err')
      } finally {
        abortRef.current = null
        setStreaming('')
        setBusy(false)
        busyRef.current = false
        setOpening(false)

        const text = acc.trim()

        if (voiceOn) {
          // 文本流到此为止。剩下的音频让它自己播完。
          voiceRef.current?.endSpeak()
          // 只有面试官确实说了话，才把话筒交回给用户。
          // 真正的开麦时机由 useVoice 判断（文本流结束 + 音频播完）。
          if (text) voiceRef.current?.maybeAutoListen()
        }

        if (text) {
          setExchanges((prev) => [...prev, { id: idRef.current++, q: text, a: null, stage }])
        } else if (gotTurn) {
          push('面试官没说话，试试再问一次', 'err')
        }
      }
    },
    [sessionId, sayStream, push, stage, voiceOn],
  )

  /* ---------------- 作答 ---------------- */

  const submit = useCallback(
    (explicitText?: string, viaVoice = false) => {
      const text = (explicitText ?? draft).trim()
      if (!text || busyRef.current) return

      // 作答时立刻打断面试官，避免抢麦
      voiceRef.current?.interrupt()

      setExchanges((prev) => {
        const next = [...prev]
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].a === null) {
            next[i] = { ...next[i], a: text, viaVoice }
            break
          }
        }
        return next
      })
      setDraft('')
      if (taRef.current) taRef.current.style.height = 'auto'
      ask(text)
    },
    [draft, ask],
  )

  const submitRef = useRef(submit)
  submitRef.current = submit

  /* ---------------- 开场 ---------------- */

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    ask('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- 自动滚底 ---------------- */

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [exchanges.length, streaming, busy, voice.listening, voice.transcribing])

  /* ---------------- 结束 ---------------- */

  const [finishing, setFinishing] = useState(false)
  const finish = useCallback(async () => {
    endedRef.current = true
    voiceRef.current?.interrupt()
    await voiceRef.current?.submitListening().catch(() => {})
    setFinishing(true)
    await onFinish()
    setFinishing(false)
  }, [onFinish])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
    }
  }

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  const answered = useMemo(() => exchanges.filter((e) => e.a).length, [exchanges])
  const pressureName = PRESSURE_LABELS[settings.pressure] || ''

  const micState: 'off' | 'idle' | 'listening' | 'transcribing' = !voice.supported
    ? 'off'
    : voice.transcribing
      ? 'transcribing'
      : voice.listening
        ? 'listening'
        : 'idle'

  return (
    <>
      <StageBar stages={stages} current={stage} />

      {/* 宽屏：左对话 / 右作答区；窄屏自动变成上下结构 */}
      <div className="interview-grid has-side">
        <div className="scroll">
          <div className="transcript">
          {opening && (
            <div className="bubble bubble-q" style={{ opacity: 0.55 }}>
              <div className="avatar avatar-q">面</div>
              <div className="bubble-body">
                <div className="bubble-meta">
                  <span>面试官</span>
                  <span>·</span>
                  <span>{pressureName}</span>
                </div>
                <div className="bubble-text">
                  <span className="spinner" /> 正在进入面试间…
                </div>
              </div>
            </div>
          )}

          {exchanges.map((ex) => (
            <div key={ex.id} style={{ display: 'contents' }}>
              <Bubble role="q" text={ex.q} stage={ex.stage} stages={stages} pressure={pressureName} />
              {ex.a && <Bubble role="a" text={ex.a} viaVoice={ex.viaVoice} />}
            </div>
          ))}

          {busy && streaming && (
            <Bubble
              role="q"
              text={streaming}
              stage={stage}
              stages={stages}
              pressure={pressureName}
              streaming
            />
          )}

            <div ref={bottomRef} style={{ height: 1 }} />
          </div>
        </div>

        <div className="answer-rail">
          {/* 语音状态条 */}
          {voiceOn && (
            <VoiceBar
              speaking={voice.speaking}
              listening={voice.listening}
              transcribing={voice.transcribing}
              level={voice.level}
              pending={voice.pendingAudio}
              onInterrupt={() => voice.interrupt()}
              onMic={() => voice.toggleListening()}
              micState={micState}
            />
          )}

          <div className="composer">
            <div className="composer-inner">
              <button
                className={`mic-btn${micState === 'listening' ? ' on' : ''}${
                  micState === 'transcribing' ? ' busy' : ''
                }`}
                onClick={() => voice.toggleListening()}
                disabled={busy || !voice.supported || voice.transcribing}
                title={
                  micState === 'off'
                    ? '当前环境不支持麦克风'
                    : micState === 'listening'
                      ? '点击结束收音并提交'
                      : micState === 'transcribing'
                        ? '正在识别…'
                        : '点击开始说话（停顿约 1.3 秒自动结束）'
                }
              >
                {micState === 'transcribing' ? (
                  <span className="spinner" />
                ) : (
                  <svg
                    width="19"
                    height="19"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="9" y="2" width="6" height="12" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
                  </svg>
                )}
              </button>

              <textarea
                ref={taRef}
                value={draft}
                placeholder={
                  voice.listening
                    ? '正在听你说… 停顿一下就会自动提交'
                    : voiceOn
                      ? '可以直接说话，也可以打字。面试官说完会自动开麦。'
                      : '作答。想清楚再说，含糊其辞会被往死里追。（Ctrl/⌘ + Enter 发送）'
                }
                onChange={(e) => {
                  setDraft(e.target.value)
                  autoGrow(e.target)
                }}
                onKeyDown={onKeyDown}
                disabled={busy}
              />

              <div className="composer-actions">
                <button
                  className="btn btn-accent"
                  onClick={() => submit()}
                  disabled={busy || !draft.trim()}
                >
                  {busy ? <span className="spinner" /> : '作答'}
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={finish}
                  disabled={busy || finishing || answered === 0}
                >
                  {finishing ? <span className="spinner" /> : '结束并评分'}
                </button>
              </div>
            </div>

            <div className="kbd-hint">
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  const next = !voiceOn
                  setVoiceOn(next)
                  if (next) void unlockAudio()
                  else voice.interrupt()
                }}
                disabled={!voice.supported}
                title={voiceOn ? '关闭语音对话' : '开启语音对话'}
              >
                <SpeakerIcon on={voiceOn} />
                {voiceOn ? '语音开' : '语音关'}
              </button>
              <span>
                已答 {answered} 题 · 压力 {settings.pressure} ·{' '}
                {voice.speaking
                  ? '面试官正在说'
                  : busy
                    ? '面试官正在想'
                    : voice.listening
                      ? '轮到你说'
                      : '轮到你'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/** 线性小喇叭图标，关掉时多一道斜杠 */
function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <path d="M11 5 6 9H3v6h3l5 4z" />
      {on ? (
        <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12" />
      ) : (
        <path d="M16 9.5l5 5M21 9.5l-5 5" />
      )}
    </svg>
  )
}

const PRESSURE_LABELS: Record<number, string> = {
  1: '模拟温和',
  2: '大厂标准',
  3: '高压面试',
  4: '连环夺命',
}

/* ---------------- 语音状态条 ---------------- */

function VoiceBar({
  speaking,
  listening,
  transcribing,
  level,
  pending,
  onInterrupt,
  onMic,
  micState,
}: {
  speaking: boolean
  listening: boolean
  transcribing: boolean
  level: number
  pending: number
  onInterrupt: () => void
  onMic: () => void
  micState: string
}) {
  const state = transcribing
    ? { text: '正在识别你的回答…', cls: 'think' }
    : listening
      ? { text: '在听 —— 说完停顿一下就会自动提交', cls: 'listen' }
      : speaking
        ? { text: '面试官正在说', cls: 'speak' }
        : { text: '待机', cls: 'idle' }

  // 音量条：0~0.06 映射到 0~100%
  const pct = Math.min(100, (level / 0.06) * 100)

  return (
    <div className={`voice-bar ${state.cls}`}>
      <span className={`voice-dot ${state.cls}`} />
      <span className="voice-state">{state.text}</span>

      {listening && (
        <span className="voice-meter" title="麦克风音量">
          <i style={{ width: `${pct}%` }} />
        </span>
      )}

      {pending > 0 && <span className="voice-pending">待播 {pending} 句</span>}

      <div style={{ flex: 1 }} />

      {speaking && (
        <button className="btn btn-sm btn-ghost" onClick={onInterrupt} title="打断面试官">
          打断
        </button>
      )}
      {!speaking && !listening && !transcribing && micState === 'idle' && (
        <button className="btn btn-sm btn-ghost" onClick={onMic}>
          说话
        </button>
      )}
    </div>
  )
}

/* ---------------- 气泡 ---------------- */

function Bubble({
  role,
  text,
  stage,
  stages,
  pressure,
  streaming,
  viaVoice,
}: {
  role: 'q' | 'a'
  text: string
  stage?: string
  stages?: StageInfo[]
  pressure?: string
  streaming?: boolean
  viaVoice?: boolean
}) {
  const stageName = stages?.find((s) => s.id === stage)?.name
  if (role === 'a') {
    return (
      <div className="bubble bubble-a">
        <div className="avatar avatar-a">我</div>
        <div className="bubble-body">
          <div className="bubble-meta">
            <span>我</span>
            {viaVoice && <span className="tag tag-ok" style={{ fontSize: 10 }}>语音</span>}
          </div>
          <div className="bubble-text">{text}</div>
        </div>
      </div>
    )
  }
  return (
    <div className="bubble bubble-q">
      <div className="avatar avatar-q">面</div>
      <div className="bubble-body">
        <div className="bubble-meta">
          <span>面试官</span>
          {pressure && (
            <>
              <span>·</span>
              <span>{pressure}</span>
            </>
          )}
          {stageName && (
            <>
              <span>·</span>
              <span>{stageName}</span>
            </>
          )}
        </div>
        <div className="bubble-text">
          {text}
          {streaming && <span className="caret" />}
        </div>
      </div>
    </div>
  )
}

function StageBar({ stages, current }: { stages: StageInfo[]; current: string }) {
  const idx = stages.findIndex((s) => s.id === current)
  return (
    <div className="stage-bar">
      {stages.map((s, i) => (
        <span
          key={s.id}
          className={`stage-chip${i === idx ? ' now' : i < idx ? ' done' : ''}`}
          title={s.goal}
        >
          <span className="stage-chip-n">{i + 1}</span>
          {s.name}
          {i < idx && ' ✓'}
        </span>
      ))}
    </div>
  )
}
