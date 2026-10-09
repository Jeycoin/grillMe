/**
 * 主题管理：浅色 / 深色 / 跟随系统
 *
 * 生效方式是往 <html> 上写 `data-theme="light|dark"`，
 * 所有颜色都由 styles.css 的 token 决定，组件完全不感知主题。
 *
 * 防闪白：index.html 里有一段内联脚本会在首屏渲染前先把 data-theme 写上，
 * 这里只负责运行期的切换。
 */
import { useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark' | 'auto'
export type ResolvedTheme = 'light' | 'dark'

const KEY = 'kewenguan.theme.v1'
const listeners = new Set<() => void>()

export function readTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'auto') return v
  } catch {
    /* 隐私模式下 localStorage 可能抛错 */
  }
  return 'auto'
}

export function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'auto' ? systemTheme() : mode
}

export function applyTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode)
  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.colorScheme = resolved

  // 让地址栏 / 状态栏也跟着变（移动端浏览器）
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#15171a' : '#f7f8fa')
}

export function setTheme(mode: ThemeMode) {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    /* 忽略 */
  }
  applyTheme(mode)
  listeners.forEach((fn) => fn())
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 组件里读当前模式 */
export function useTheme(): [ThemeMode, (m: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(readTheme)

  useEffect(() => {
    const off = subscribeTheme(() => setMode(readTheme()))
    // 跟随系统时，系统切换要实时响应
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (readTheme() === 'auto') {
        applyTheme('auto')
        setMode('auto')
      }
    }
    mq?.addEventListener?.('change', onChange)
    return () => {
      off()
      mq?.removeEventListener?.('change', onChange)
    }
  }, [])

  return [mode, setTheme]
}
