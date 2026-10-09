import type { ThemeMode } from '../theme'
import { useTheme } from '../theme'

/**
 * 主题切换：浅色 / 深色 / 跟随系统。
 * 做成三段小控件而不是循环按钮 —— 循环切换看不出"当前是哪一档"。
 */
export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useTheme()

  const items: { id: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { id: 'light', label: '浅色', icon: <SunIcon /> },
    { id: 'dark', label: '深色', icon: <MoonIcon /> },
    { id: 'auto', label: '跟随系统', icon: <AutoIcon /> },
  ]

  return (
    <div className="theme-toggle" role="group" aria-label="外观模式">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={`theme-btn${mode === it.id ? ' on' : ''}`}
          onClick={() => setMode(it.id)}
          title={it.label}
          aria-label={it.label}
          aria-pressed={mode === it.id}
        >
          {it.icon}
          {!compact && <span className="theme-btn-label">{it.label}</span>}
        </button>
      ))}
    </div>
  )
}

const S = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function SunIcon() {
  return (
    <svg {...S}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg {...S}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  )
}

/** 跟随系统：一半实心一半空心 */
function AutoIcon() {
  return (
    <svg {...S}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
    </svg>
  )
}
