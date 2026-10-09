import { useCallback, useRef, useState } from 'react'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'err'
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const idRef = useRef(1)

  const remove = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const push = useCallback(
    (text: string, kind: 'info' | 'err' = 'info') => {
      const id = idRef.current++
      setToasts((t) => [...t, { id, text, kind }])
      setTimeout(() => remove(id), kind === 'err' ? 6000 : 3200)
    },
    [remove],
  )

  return { toasts, push, remove }
}

export default function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: Toast[]
  onDismiss: (id: number) => void
}) {
  if (!toasts.length) return null
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast${t.kind === 'err' ? ' err' : ''}`}
          onClick={() => onDismiss(t.id)}
          style={{ pointerEvents: 'auto', cursor: 'pointer' }}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}
