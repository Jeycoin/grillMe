import { useEffect, useMemo, useState } from 'react'
import {
  adminApi,
  fmtTime,
  fmtDur,
  type AdminSessionSummary,
  type AdminSessionDetail,
} from './api'
import { Panel, ScorePill, Empty, Modal, Confirm } from './ui'

const PRESSURE: Record<number, string> = {
  1: '模拟温和',
  2: '大厂标准',
  3: '高压面试',
  4: '连环夺命',
}

const ARCH: Record<string, string> = {
  tech: '技术专家面',
  lead: '技术主管面',
  cross: '交叉面',
  hr: 'HR 面',
  boss: '老板终面',
  stress: '压力面',
}

const PAGE = 15

export default function Sessions({
  openId,
  onCloseDetail,
}: {
  openId: string | null
  onCloseDetail: () => void
}) {
  const [list, setList] = useState<AdminSessionSummary[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [detail, setDetail] = useState<AdminSessionDetail | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const load = () => {
    adminApi
      .sessions()
      .then((r) => setList(r.sessions))
      .catch((e) => setErr(String(e.message || e)))
  }
  useEffect(load, [])

  // 从概览页点进来的
  useEffect(() => {
    if (!openId) return
    adminApi.session(openId).then((r) => setDetail(r.session)).catch(() => {})
  }, [openId])

  const pageItems = useMemo(() => {
    if (!list) return []
    return list.slice(page * PAGE, page * PAGE + PAGE)
  }, [list, page])

  const open = async (id: string) => {
    try {
      const r = await adminApi.session(id)
      setDetail(r.session)
    } catch (e) {
      setErr(String((e as Error).message || e))
    }
  }

  const closeDetail = () => {
    setDetail(null)
    onCloseDetail()
  }

  const doDelete = async (id: string) => {
    try {
      await adminApi.deleteSession(id)
      setList((l) => (l ? l.filter((x) => x.id !== id) : l))
      if (detail?.id === id) closeDetail()
    } catch (e) {
      setErr(String((e as Error).message || e))
    }
  }

  if (err && !list) return <Empty>加载失败：{err}</Empty>
  if (!list) return <Empty>加载中…</Empty>

  const maxPage = Math.max(0, Math.ceil(list.length / PAGE) - 1)

  return (
    <>
      <Panel
        title={`面试记录（${list.length} 场）`}
        flush
        extra={
          list.length > 0 && (
            <button className="btn btn-sm btn-danger" onClick={() => setConfirmClear(true)}>
              清空全部
            </button>
          )
        }
      >
        {list.length === 0 ? (
          <div style={{ padding: 15 }}>
            <Empty>还没有面试记录。回主站面一场吧。</Empty>
          </div>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>开始时间</th>
                  <th>时长</th>
                  <th>压力</th>
                  <th>面试官</th>
                  <th>轮数</th>
                  <th>得分</th>
                  <th>结论</th>
                  <th style={{ width: 100 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((s) => (
                  <tr key={s.id}>
                    <td className="num">{fmtTime(s.startedAt)}</td>
                    <td className="num muted">{fmtDur(s.startedAt, s.endedAt)}</td>
                    <td>
                      <span className="tag" title={PRESSURE[s.pressure]}>
                        L{s.pressure}
                      </span>
                    </td>
                    <td style={{ fontSize: 12.5 }}>{ARCH[s.archetype] || s.archetype}</td>
                    <td className="num">{s.turns}</td>
                    <td>
                      <ScorePill score={s.report?.overall} />
                    </td>
                    <td
                      style={{
                        maxWidth: 260,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 12.5,
                      }}
                      title={s.report?.verdict}
                    >
                      {s.report?.verdict || <span className="muted">—</span>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm btn-ghost" onClick={() => open(s.id)}>
                          查看
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => setConfirmDel(s.id)}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.length > PAGE && (
              <div className="pager">
                <button
                  className="btn btn-sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  上一页
                </button>
                <span>
                  第 {page + 1} / {maxPage + 1} 页
                </span>
                <button
                  className="btn btn-sm"
                  disabled={page >= maxPage}
                  onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
                >
                  下一页
                </button>
              </div>
            )}
          </>
        )}
      </Panel>

      {err && list && (
        <div className="toast err" style={{ position: 'static', marginTop: 10 }}>
          {err}
        </div>
      )}

      {detail && <DetailModal detail={detail} onClose={closeDetail} />}

      {confirmDel && (
        <Confirm
          title="删除这场面试记录？"
          danger
          confirmText="删除"
          message={
            <>
              会话 <code className="mono">{confirmDel}</code> 的完整问答与评分会被永久删除。
              <br />
              长期记忆里的薄弱项不会自动移除，需要去「薄弱项」页面单独清理。
            </>
          }
          onConfirm={() => doDelete(confirmDel)}
          onClose={() => setConfirmDel(null)}
        />
      )}

      {confirmClear && (
        <Confirm
          title="清空全部面试记录？"
          danger
          confirmText="全部清空"
          message={
            <>
              这会删除 <b>{list.length}</b> 场面试的全部记录与评分，<b>不可恢复</b>。
              <br />
              建议先去「系统」页导出一份备份。
            </>
          }
          onConfirm={async () => {
            try {
              await adminApi.clearSessions()
              setList([])
            } catch (e) {
              setErr(String((e as Error).message || e))
            }
          }}
          onClose={() => setConfirmClear(false)}
        />
      )}
    </>
  )
}

function DetailModal({ detail, onClose }: { detail: AdminSessionDetail; onClose: () => void }) {
  const r = detail.report
  return (
    <Modal title={`面试详情 · ${fmtTime(detail.startedAt)}`} onClose={onClose}>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 14 }}>
        <div className="stat-card" style={{ padding: '10px 12px' }}>
          <div className="stat-label">得分</div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {r?.overall ?? '—'}
          </div>
        </div>
        <div className="stat-card" style={{ padding: '10px 12px' }}>
          <div className="stat-label">轮数</div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {detail.turns}
          </div>
        </div>
        <div className="stat-card" style={{ padding: '10px 12px' }}>
          <div className="stat-label">压力</div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            L{detail.pressure}
          </div>
        </div>
        <div className="stat-card" style={{ padding: '10px 12px' }}>
          <div className="stat-label">时长</div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {fmtDur(detail.startedAt, detail.endedAt).replace(' 分钟', '')}
            <small>分</small>
          </div>
        </div>
      </div>

      {r ? (
        <>
          <p style={{ fontSize: 14, lineHeight: 1.7, marginTop: 0 }}>
            <b>结论：</b>
            {r.verdict}
          </p>

          {r.dimensions?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              {r.dimensions.map((d) => (
                <div className="dim-row" key={d.name}>
                  <span className="dim-name">{d.name}</span>
                  <span className="dim-bar">
                    <i
                      className={d.score <= 4 ? 'low' : d.score <= 6 ? 'mid' : ''}
                      style={{ width: `${(d.score / 10) * 100}%` }}
                    />
                  </span>
                  <span className="dim-score">{d.score}/10</span>
                  <span className="dim-comment">{d.comment}</span>
                </div>
              ))}
            </div>
          )}

          {r.weakPoints?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="panel-title" style={{ marginBottom: 8 }}>
                薄弱点
              </div>
              {r.weakPoints.map((w, i) => (
                <div className="weak-item" key={i}>
                  <span className="tag tag-accent">{w.score}/10</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="weak-topic">{w.topic}</span>
                    <span className="weak-note" style={{ display: 'block' }}>
                      {w.note}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {r.nextActions?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="panel-title" style={{ marginBottom: 8 }}>
                改进建议
              </div>
              <ul className="list-plain" style={{ fontSize: 13 }}>
                {r.nextActions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>
          这场面试没有生成评分报告。
        </p>
      )}

      <div className="panel-title" style={{ marginBottom: 10 }}>
        问答流水（{detail.transcript?.length || 0} 轮）
      </div>
      {detail.transcript?.length ? (
        detail.transcript.map((t, i) => (
          <div className="qa-block" key={i}>
            <div className="qa-q">
              <span className="mk">Q{i + 1}</span>
              <span>{t.q}</span>
            </div>
            {t.a ? (
              <div className="qa-a">
                <span className="mk">A</span>
                <span>{t.a}</span>
              </div>
            ) : (
              <div className="qa-a empty">
                <span className="mk">A</span>
                <span>（未作答）</span>
              </div>
            )}
          </div>
        ))
      ) : (
        <Empty>没有问答记录</Empty>
      )}
    </Modal>
  )
}
