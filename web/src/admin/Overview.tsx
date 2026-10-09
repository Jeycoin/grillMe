import { useEffect, useState } from 'react'
import { adminApi, fmtTime, sevClass, severity, type AdminOverview, type AdminProviderInfo } from './api'
import { Panel, StatCard, ScorePill, Empty } from './ui'
import type { SessionSummary } from '../types'

export default function Overview({
  onGoto,
  onOpenSession,
}: {
  onGoto: (tab: string) => void
  onOpenSession: (id: string) => void
}) {
  const [data, setData] = useState<{
    overview: AdminOverview
    materials: { sets: number; total: number; enabled: number }
    providers: AdminProviderInfo[]
  } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    adminApi
      .overview()
      .then(setData)
      .catch((e) => setErr(String(e.message || e)))
  }, [])

  if (err) return <Empty>加载失败：{err}</Empty>
  if (!data) return <Empty>加载中…</Empty>

  const { overview: o, materials: m, providers } = data
  const readyCount = providers.filter((p) => p.ready).length
  const trend = o.trend || []

  return (
    <>
      <div className="stat-grid">
        <StatCard label="面试场次" value={o.sessions} unit="场" foot={`共 ${o.totalTurns} 轮问答`} />
        <StatCard
          label="平均得分"
          value={o.avgScore ?? '—'}
          unit={o.avgScore != null ? '/100' : undefined}
          foot={o.bestScore != null ? `最高 ${o.bestScore} 分` : '还没有评分记录'}
        />
        <StatCard
          label="薄弱项"
          value={o.weakPoints}
          unit="项"
          foot={o.strengths ? `另有 ${o.strengths} 项优势` : '还没积累'}
        />
        <StatCard
          label="面经题库"
          value={m.total}
          unit="题"
          foot={`${m.sets} 份素材 · 启用 ${m.enabled} 题`}
        />
        <StatCard
          label="模型供应商"
          value={readyCount}
          unit={`/${providers.length}`}
          foot={readyCount ? 'Key 已就绪' : '需要配置 Key'}
        />
      </div>

      <div className="two-col">
        <Panel
          title="得分趋势"
          extra={<span className="muted" style={{ fontSize: 12 }}>最近 {trend.length} 场</span>}
        >
          {trend.length === 0 ? (
            <Empty>还没有已评分的面试。去面一场，这里就会有曲线了。</Empty>
          ) : (
            <TrendChart trend={trend} />
          )}
        </Panel>

        <Panel
          title="薄弱项 TOP"
          extra={
            <button className="btn btn-sm btn-ghost" onClick={() => onGoto('memory')}>
              管理
            </button>
          }
        >
          {o.topWeak.length === 0 ? (
            <Empty>还没有记录到薄弱项。</Empty>
          ) : (
            <div>
              {o.topWeak.map((w) => (
                <div className="wp-row" key={w.topic} title={w.note}>
                  <span className="wp-topic" title={w.note}>
                    {w.topic}
                  </span>
                  {(w.hits || 1) > 1 && <span className="wp-hits">×{w.hits}</span>}
                  <span className="wp-track">
                    <i
                      className={`wp-fill ${sevClass(w.score)}`}
                      style={{ width: `${Math.max(6, severity(w.score) * 100)}%` }}
                    />
                  </span>
                  <span className="mono" style={{ fontSize: 11.5, width: 34, textAlign: 'right' }}>
                    {w.score}/10
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title="最近面试"
        flush
        extra={
          <button className="btn btn-sm btn-ghost" onClick={() => onGoto('sessions')}>
            全部记录
          </button>
        }
      >
        {o.recent.length === 0 ? (
          <div style={{ padding: 15 }}>
            <Empty>还没有面试记录。</Empty>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>压力</th>
                <th>轮数</th>
                <th>得分</th>
                <th>结论</th>
              </tr>
            </thead>
            <tbody>
              {o.recent.map((s: SessionSummary) => (
                <tr key={s.id} className="clickable" onClick={() => onOpenSession(s.id)}>
                  <td className="num">{fmtTime(s.startedAt)}</td>
                  <td>
                    <span className="tag">L{s.pressure}</span>
                  </td>
                  <td className="num">{s.turns}</td>
                  <td>
                    <ScorePill score={s.report?.overall} />
                  </td>
                  <td
                    style={{
                      maxWidth: 340,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.report?.verdict || <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {o.lastSummary && (
        <Panel title="上一次面试官的评语">
          <div className="spoken-box">{o.lastSummary}</div>
        </Panel>
      )}
    </>
  )
}

function TrendChart({ trend }: { trend: { at: string; score: number; verdict: string }[] }) {
  const max = 100
  return (
    <div className="trend">
      {trend.map((t, i) => {
        const h = Math.max(2, (t.score / max) * 78)
        const cls = t.score >= 75 ? 'good' : t.score >= 55 ? 'mid' : 'bad'
        const d = new Date(t.at)
        const label = `${d.getMonth() + 1}/${d.getDate()}`
        return (
          <div className="trend-col" key={i} title={`${fmtTime(t.at)}　${t.score} 分\n${t.verdict}`}>
            <span className="trend-val">{Math.round(t.score)}</span>
            <span className={`trend-bar ${cls}`} style={{ height: h }} />
            <span className="trend-label">{label}</span>
          </div>
        )
      })}
    </div>
  )
}
