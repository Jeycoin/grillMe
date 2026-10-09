import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import AdminApp from './admin/AdminApp'
import { applyTheme, readTheme } from './theme'
import './styles.css'

// index.html 里的内联脚本已经写过一次了，这里再同步一遍：
// 页面被 bfcache 恢复、或用户改了系统偏好时，保证 DOM 上的值是最新的。
applyTheme(readTheme())

const isAdmin = window.location.pathname.startsWith('/admin')

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isAdmin ? <AdminApp /> : <App />}</React.StrictMode>,
)
