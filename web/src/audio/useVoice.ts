/**
 * 语音编排 hook
 *
 * 把三件事串起来：
 *   面试官说话 → 流式断句 → 逐句合成 → 排队播放（可被打断）
 *   你说话     → 静音检测断句 → 上传识别 → 回调文本
 *
 * 设计上刻意保持"面试官先说、候选人说"的顺序，避免抢麦。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { AudioQueue } from './player'
import { SentenceSplitter } from './sentence'
import { VoiceRecorder } from './recorder'

export interface UseVoiceOptions {
  /** 语音总开关。关掉时会清空待播音频并关闭麦克风 */
  enabled: boolean
  voice: string
  pressure: number
  archetype: string
  /** 录音采集的音量阈值，越大越不灵敏 */
  threshold?: number
  /** 说完后静音多久算结束 */
  silenceMs?: number
  /** 识别出文本后回调 */
  onTranscript: (text: string) => void
  /** 出错提示 */
  onError?: (msg: string) => void
  /** 面试官一段话说完了 */
  onSpokenEnd?: () => void
}

export function useVoice(opts: UseVoiceOptions) {
  const enabled = opts.enabled
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [level, setLevel] = useState(0)
  const [pendingAudio, setPendingAudio] = useState(0)

  const queueRef = useRef<AudioQueue | null>(null)
  const splitterRef = useRef(new SentenceSplitter())
  const chainRef = useRef<Promise<void>>(Promise.resolve())
  const abortRef = useRef(false)
  const recorderRef = useRef<VoiceRecorder | null>(null)
  const queuedRef = useRef(0)
  /** 文本流是否还开着（LLM 还在吐字） */
  const streamOpenRef = useRef(false)
  /** 有人在等"面试官说完"这个信号 */
  const wantListenRef = useRef(false)
  /** 连续几次没听清（噪声环境防空转） */
  const emptyStreakRef = useRef(0)

  const supported = useMemo(() => VoiceRecorder.supported && typeof Audio !== 'undefined', [])

  const optsRef = useRef(opts)
  optsRef.current = opts

  /**
   * 判断"面试官是不是真的说完了"，是则喊一声"该你说了"。
   *
   * 为什么不能只听音频队列排空：
   * LLM 是流式吐字的，它可能说完第一句后卡两秒再吐第二句。
   * 这两秒里音频队列正好排空，如果就此开麦，
   * 面试官的第二句会盖着用户的麦克风播出来 —— 抢麦。
   * 所以必须"文本流已结束 + 音频队列已排空"同时成立。
   */
  const drainCheck = useCallback(() => {
    if (!wantListenRef.current) return
    if (streamOpenRef.current) return
    if (queueRef.current?.isSpeaking) return
    if (queuedRef.current > 0) return
    wantListenRef.current = false
    optsRef.current.onSpokenEnd?.()
  }, [])

  /* ---------- 播放队列：只建一次 ---------- */
  useEffect(() => {
    const q = new AudioQueue({
      onSpeakingChange: setSpeaking,
      onIdle: () => drainCheck(),
    })
    queueRef.current = q
    return () => q.dispose()
  }, [drainCheck])

  /** 清掉所有待播和正在生成的语音 */
  const interrupt = useCallback(() => {
    abortRef.current = true
    wantListenRef.current = false
    splitterRef.current.reset()
    chainRef.current = Promise.resolve()
    queuedRef.current = 0
    setPendingAudio(0)
    queueRef.current?.stop()
  }, [])

  /**
   * 合成一句话并入队。
   * 用 Promise 链串行，保证"合成顺序 = 播放顺序"。
   * finally 里保证计数一定被减掉 —— 否则中断后计数虚高，
   * 会让后面的"说完判定"永远不通过。
   */
  const speakOne = useCallback((text: string) => {
    queuedRef.current += 1
    setPendingAudio(queuedRef.current)

    chainRef.current = chainRef.current.then(async () => {
      if (abortRef.current) return
      try {
        const blob = await api.tts(text, {
          voice: optsRef.current.voice,
          pressure: optsRef.current.pressure,
          archetype: optsRef.current.archetype,
        })
        if (abortRef.current) return
        queueRef.current?.enqueue(blob)
      } catch (e) {
        optsRef.current.onError?.(String((e as Error).message || e))
      } finally {
        queuedRef.current = Math.max(0, queuedRef.current - 1)
        setPendingAudio(queuedRef.current)
      }
    })
  }, [])

  /** 面试官开始新的一轮说话 */
  const beginSpeak = useCallback(() => {
    abortRef.current = false
    wantListenRef.current = false
    streamOpenRef.current = true
    splitterRef.current.reset()
    queueRef.current?.revive()
  }, [])

  /** 喂入流式增量，遇到句子边界就送合成 */
  const feedSpeak = useCallback(
    (delta: string) => {
      if (!delta) return
      for (const s of splitterRef.current.push(delta)) speakOne(s)
    },
    [speakOne],
  )

  /** 一轮说完，把尾巴也合成掉 */
  const endSpeak = useCallback(() => {
    streamOpenRef.current = false
    const rest = splitterRef.current.flush()
    if (rest) speakOne(rest)
    drainCheck()
  }, [speakOne, drainCheck])

  /**
   * 声明"这一轮结束后就轮到用户说"。
   * 由调用方在**面试官这一轮处理完之后**调用（不是流一结束就调），
   * 这样自动开麦时 busy 状态已经落下来了。
   */
  const maybeAutoListen = useCallback(() => {
    wantListenRef.current = true
    drainCheck()
  }, [drainCheck])

  /** 直接说一整段（用于开场、报告朗读等非流式场景） */
  const speakText = useCallback(
    (text: string) => {
      beginSpeak()
      for (const s of splitterRef.current.push(text)) speakOne(s)
      endSpeak()
    },
    [beginSpeak, speakOne, endSpeak],
  )

  /* ---------- 录音 ---------- */

  const stopListening = useCallback(async () => {
    const rec = recorderRef.current
    recorderRef.current = null
    setListening(false)
    if (!rec) return null
    const r = await rec.stop()
    return r
  }, [])

  /** 结束录音并送去识别 */
  const finalize = useCallback(
    async (wav: Blob, seconds: number) => {
      if (seconds < 0.6) {
        // 太短，多半是误触，静默丢弃
        setTranscribing(false)
        return
      }
      setTranscribing(true)
      let reopenMic = false
      try {
        const r = await api.asr(wav)
        if (r.empty || !r.text) {
          // 没听清：面试官这边没有新话要说，还是轮到你。
          // 自动重开麦，但最多连开两次 —— 否则在嘈杂环境里会空转。
          emptyStreakRef.current += 1
          optsRef.current.onError?.(
            emptyStreakRef.current >= 3 ? '麦克风一直没收到有效语音，请改打字' : '没听清，再说一次',
          )
          reopenMic = emptyStreakRef.current <= 2
        } else {
          emptyStreakRef.current = 0
          optsRef.current.onTranscript(r.text)
        }
      } catch (e) {
        optsRef.current.onError?.(String((e as Error).message || e))
      } finally {
        setTranscribing(false)
      }

      // 放在 finally 之后：此时"正在识别"的标记已经落下，
      // 重开麦不会和识别状态打架。
      if (reopenMic) {
        wantListenRef.current = true
        drainCheck()
      }
    },
    [drainCheck],
  )

  const startListening = useCallback(async () => {
    if (!supported) {
      optsRef.current.onError?.('当前浏览器不支持麦克风，请用 Chrome / Edge，且通过 localhost 访问')
      return
    }
    // 面试官还在说 → 直接打断他（barge-in）
    if (queueRef.current?.isSpeaking || queuedRef.current > 0) interrupt()

    const rec = new VoiceRecorder({
      threshold: optsRef.current.threshold ?? 0.012,
      silenceMs: optsRef.current.silenceMs ?? 1300,
      onLevel: setLevel,
      onAutoStop: (wav, seconds) => {
        recorderRef.current = null
        setListening(false)
        setLevel(0)
        void finalize(wav, seconds)
      },
    })
    recorderRef.current = rec
    try {
      await rec.start()
      setListening(true)
    } catch (e) {
      recorderRef.current = null
      setListening(false)
      optsRef.current.onError?.(`麦克风打开失败：${String((e as Error).message || e)}`)
    }
  }, [supported, interrupt, finalize])

  /** 手动结束录音（不想等静音检测时用） */
  const submitListening = useCallback(async () => {
    const r = await stopListening()
    if (r) await finalize(r.wav, r.seconds)
  }, [stopListening, finalize])

  const toggleListening = useCallback(() => {
    if (listening) void submitListening()
    else void startListening()
  }, [listening, submitListening, startListening])

  /* ---------- 开关 ---------- */

  useEffect(() => {
    if (!enabled) {
      interrupt()
      void stopListening()
    }
  }, [enabled, interrupt, stopListening])

  /** 采样当前录音音量，给 barge-in 判断用 */
  const currentLevel = useCallback(() => recorderRef.current?.level ?? 0, [])

  return {
    supported,
    enabled,
    listening,
    transcribing,
    speaking,
    level,
    pendingAudio,
    startListening,
    submitListening,
    toggleListening,
    interrupt,
    beginSpeak,
    feedSpeak,
    endSpeak,
    maybeAutoListen,
    speakText,
    currentLevel,
  }
}
