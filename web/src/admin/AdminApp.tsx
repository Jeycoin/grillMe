import { useEffect, useState } from 'react'
import './admin.css'
import { adminApi } from './api'
import Overview from './Overview'
import Sessions from './Sessions'
import MemoryPanel from './MemoryPanel'
import MaterialsAdmin from './MaterialsAdmin'
import SystemPanel from './SystemPanel'
import ThemeToggle from '../components/ThemeToggle'

type Tab = 'overview' | 'sessions' | 'memory' | 'materials' | 'system'

const TABS: { id: Tab; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'overview', label: '概览', icon: <IconGrid />, desc: '关键指标、得分趋势与近期记录' },
  { id: 'sessions', label: '面试记录', icon: <IconList />, desc: '每一场的完整问答流水与评分报告' },
  { id: 'memory', label: '薄弱项', icon: <IconTarget />, desc: '面试官对你的长期记忆，决定下次进攻方向' },
  { id: 'materials', label: '面经库', icon: <IconFile />, desc: '外部面经素材的导入与管理' },
  { id: 'system', label: '系统', icon: <IconSliders />, desc: '模型供应商、MCP、备份与数据清理' },
]

/* 统一的线性图标：14px 视图、1.7 描边、圆头圆角，粗细一致 */
const I = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function IconGrid() {
  return (
    <svg {...I}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
    </svg>
  )
}
function IconList() {
  return (
    <svg {...I}>
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  )
}
function IconTarget() {
  return (
    <svg {...I}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  )
}
function IconFile() {
  return (
    <svg {...I}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  )
}
function IconSliders() {
  return (
    <svg {...I}>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="1.8" />
      <circle cx="10" cy="12" r="1.8" />
      <circle cx="18" cy="18" r="1.8" />
    </svg>
  )
}

export default function AdminApp() {
  const [tab, setTab] = useState<Tab>(() => {
    const h = window.location.hash.replace('#', '')
    return (TABS.find((t) => t.id === h)?.id || 'overview') as Tab
  })
  const [counts, setCounts] = useState<{ sessions: number; weak: number; materials: number }>({
    sessions: 0,
    weak: 0,
    materials: 0,
  })
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)

  useEffect(() => {
    window.location.hash = tab
  }, [tab])

  useEffect(() => {
    adminApi
      .overview()
      .then((r) =>
        setCounts({
          sessions: r.overview.sessions,
          weak: r.overview.weakPoints,
          materials: r.materials.total,
        }),
      )
      .catch(() => {})
  }, [tab])

  const cur = TABS.find((t) => t.id === tab)!

  const badgeOf = (id: Tab) => {
    if (id === 'sessions' && counts.sessions) return String(counts.sessions)
    if (id === 'memory' && counts.weak) return String(counts.weak)
    if (id === 'materials' && counts.materials) return String(counts.materials)
    return null
  }

  const goSession = (id: string) => {
    setOpenSessionId(id)
    setTab('sessions')
  }

  return (
    <div className="adm">
      <aside className="adm-side">
        <div className="adm-side-head">
          <div className="adm-side-title">拷问官</div>
          <div className="adm-side-sub">ADMIN CONSOLE</div>
        </div>

        <nav className="adm-nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`adm-nav-item${tab === t.id ? ' on' : ''}`}
              onClick={() => {
                setTab(t.id)
                if (t.id !== 'sessions') setOpenSessionId(null)
              }}
            >
              <span className="ic" aria-hidden="true">
                {t.icon}
              </span>
              {t.label}
              {badgeOf(t.id) && <span className="adm-nav-badge">{badgeOf(t.id)}</span>}
            </button>
          ))}
        </nav>

        <div className="adm-side-foot">
          <a
            className="btn btn-sm"
            href="/"
            style={{ width: '100%', textDecoration: 'none' }}
          >
            ← 回到面试间
          </a>
        </div>
      </aside>

      <main className="adm-main">
        <header className="adm-head">
          <div>
            <h2>{cur.label}</h2>
            <p>{cur.desc}</p>
          </div>
          <div style={{ flex: 1 }} />
          <span className="status">
            <i />
            本地运行
          </span>
          <ThemeToggle />
        </header>

        <div className="adm-body">
          {tab === 'overview' && <Overview onGoto={(t) => setTab(t as Tab)} onOpenSession={goSession} />}
          {tab === 'sessions' && (
            <Sessions openId={openSessionId} onCloseDetail={() => setOpenSessionId(null)} />
          )}
          {tab === 'memory' && <MemoryPanel />}
          {tab === 'materials' && <MaterialsAdmin />}
          {tab === 'system' && <SystemPanel />}
        </div>
      </main>
    </div>
  )
}
