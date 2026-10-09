import { useEffect, useState } from 'react'
import type { Report } from '../types'

export default function ReportView({ report, onRestart }: { report: Report; onRestart: () => void }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 60)
    return () => clearTimeout(t)
  }, [])

  const overall = Math.round(report.overall || 0)
  // 分数颜色：低分是"差"，必须用 danger。
  // 强调色是薄荷青（正面色），拿它标低分会把"差"画成一片绿。
  const tone =
    overall >= 75 ? 'var(--accent-strong)' : overall >= 55 ? 'var(--warn)' : 'var(--danger)'

  return (
    <div className="scroll">
      <div className="page page-narrow">
        <div className="hero" style={{ paddingBottom: 20 }}>
          <h1 style={{ fontSize: 30 }}>评估结果</h1>
          <p>逐题复盘 + 长期记忆更新。薄弱点已经记下来了，下一场从这里开始问。</p>
        </div>

        <div className="score-hero">
          <div className="score-num" style={{ color: tone }}>
            {overall}
            <small>/100</small>
          </div>
          <div className="score-verdict">
            <div className="muted" style={{ fontSize: 11, fontFamily: 'var(--mono)', marginBottom: 8 }}>
              总评
            </div>
            <p>{report.verdict}</p>
          </div>
        </div>

        <section className="card">
          <div className="card-title" style={{ marginBottom: 12 }}>
            维度评分
          </div>
          {report.dimensions?.map((d) => (
            <div className="dim-row" key={d.name}>
              <span className="dim-name">{d.name}</span>
              <span className="dim-bar">
                <i
                  className={d.score <= 4 ? 'low' : d.score <= 6 ? 'mid' : ''}
                  style={{ width: shown ? `${(d.score / 10) * 100}%` : 0 }}
                />
              </span>
              <span className="dim-score">{d.score}/10</span>
              <span className="dim-comment">{d.comment}</span>
            </div>
          ))}
        </section>

        {report.weakPoints?.length > 0 && (
          <section className="card">
            <div className="card-title" style={{ marginBottom: 4 }}>
              这一场暴露的薄弱点
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              已经写进长期记忆。下一场面试，他会从这里开始问你。
            </p>
            {report.weakPoints.map((w, i) => (
              <div className="weak-item" key={i}>
                <span className="tag tag-danger">{w.score}/10</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="weak-topic">{w.topic}</span>
                  <span className="weak-note" style={{ display: 'block' }}>
                    {w.note}
                  </span>
                </span>
              </div>
            ))}
          </section>
        )}

        {report.highlights?.length > 0 && (
          <section className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>
              答得还不错的地方
            </div>
            <ul className="list-plain">
              {report.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </section>
        )}

        {report.nextActions?.length > 0 && (
          <section className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>
              下一步怎么补
            </div>
            <ul className="list-plain">
              {report.nextActions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </section>
        )}

        {report.spokenSummary && (
          <section className="card">
            <div className="card-title" style={{ marginBottom: 10 }}>
              面试官当面对你说
            </div>
            <div className="spoken-box">{report.spokenSummary}</div>
          </section>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <button className="btn btn-accent" style={{ padding: '11px 26px' }} onClick={onRestart}>
            再来一场
          </button>
        </div>
      </div>
    </div>
  )
}
