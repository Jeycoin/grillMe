import { useEffect, useRef, useCallback } from 'react'

/**
 * 临时语音输入：浏览器原生 SpeechRecognition。
 * M2 阶段会替换成 DashScope 流式 ASR（`qwen3-asr-flash-realtime`），
 * 届时本 hook 保留为兼容降级路径（Firefox/Safari 无该 API）。
 */
export function useSpeechInput({
  onFinal,
  lang = 'zh-CN',
  enabled,
}: {
  onFinal: (text: string) => void
  lang?: string
  enabled: boolean
}) {
  const recRef = useRef<any>(null)
  const finalRef = useRef('')

  const supported =
    typeof window !== 'undefined' &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

  const stop = useCallback(() => {
    try {
      recRef.current?.stop()
    } catch {
      /* noop */
    }
    recRef.current = null
  }, [])

  const start = useCallback(
    (onPartial?: (t: string) => void) => {
      const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (!Ctor) return false
      const rec = new Ctor()
      rec.lang = lang
      rec.continuous = true
      rec.interimResults = true
      finalRef.current = ''
      rec.onresult = (e: any) => {
        let interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal) finalRef.current += r[0].transcript
          else interim += r[0].transcript
        }
        onPartial?.(finalRef.current + interim)
      }
      rec.onerror = () => stop()
      rec.onend = () => {
        if (finalRef.current.trim()) onFinal(finalRef.current.trim())
        recRef.current = null
      }
      rec.start()
      recRef.current = rec
      return true
    },
    [lang, onFinal, stop],
  )

  useEffect(() => {
    if (!enabled) stop()
  }, [enabled, stop])

  return { supported, start, stop }
}
