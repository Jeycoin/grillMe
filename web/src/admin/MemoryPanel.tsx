import { useEffect, useState } from 'react'
import { adminApi, fmtTime, sevClass, severity, type MemoryData } from './api'
import { Panel, Empty, Confirm } from './ui'
import type { Profile, WeakPoint } from '../types'

type SortKey = 'hits' | 'score' | 'recent'

export default function MemoryPanel() {
  const [mem, setMem] = useState<MemoryData | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('hits')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ topic: string; score: number; note: string }>({
    topic: '',
    score: 5,
    note: '',
  })
  const [adding, setAdding] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [newStrength, setNewStrength] = useState('')

  const load = () => {
    adminApi
      .memory()
      .then((r) => {
        setMem(r.memory)
        setProfile(r.profile)
      })
      .catch((e) => setErr(String(e.message || e)))
  }

  useEffect(() => {
    load()
  }, [])

  if (err && !mem) return <Empty>加载失败：{err}</Empty>
  if (!mem) return <Empty>加载中…</Empty>

  const sorted = [...(mem.weakPoints || [])].sort((a, b) => {
    if (sort === 'hits') return (b.hits || 1) - (a.hits || 1) || (a.score ?? 10) - (b.score ?? 10)
    if (sort === 'score') return (a.score ?? 10) - (b.score ?? 10)
    return new Date(b.seenAt || 0).getTime() - new Date(a.seenAt || 0).getTime()
  })

  const flash = (e: unknown) => setErr(String((e as Error).message || e))

  const saveEdit = async () => {
    if (!editing) return
    try {
      await adminApi.patchWeak(editing, {
        topic: draft.topic,
        score: draft.score,
        note: draft.note,
      })
      setEditing(null)
      load()
    } catch (e) {
      flash(e)
    }
  }

  const saveNew = async () => {
    if (!draft.topic.trim()) return
    try {
      await adminApi.addWeak({
        topic: draft.topic.trim(),
        score: draft.score,
        note: draft.note,
      })
      setDraft({ topic: '', score: 5, note: '' })
      setAdding(false)
      load()
    } catch (e) {
      flash(e)
    }
  }

  const del = async (topic: string) => {
    try {
      await adminApi.deleteWeak(topic)
      load()
    } catch (e) {
      flash(e)
    }
  }

  const addStrength = async () => {
    const v = newStrength.trim()
    if (!v) return
    try {
      await adminApi.setStrengths([...(mem.strengths || []), v])
      setNewStrength('')
      load()
    } catch (e) {
      flash(e)
    }
  }

  const delStrength = async (s: string) => {
    try {
      await adminApi.setStrengths((mem.strengths || []).filter((x) => x !== s))
      load()
    } catch (e) {
      flash(e)
    }
  }

  return (
    <>
      {err && mem && (
        <div className="toast err" style={{ position: 'static', marginBottom: 12 }}>
          {err}
        </div>
      )}

      <Panel
        title={`薄弱项图谱（${sorted.length} 项）`}
        extra={
          <>
            <div className="pills">
              {(
                [
                  ['hits', '按踩坑次数'],
                  ['score', '按得分低'],
                  ['recent', '按最近'],
                ] as [SortKey, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  className={`pill${sort === k ? ' on' : ''}`}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => setSort(k)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              className="btn btn-sm"
              onClick={() => {
                setAdding((a) => !a)
                setDraft({ topic: '', score: 5, note: '' })
              }}
            >
              {adding ? '取消' : '手动添加'}
            </button>
            {sorted.length > 0 && (
              <button className="btn btn-sm btn-danger" onClick={() => setConfirmClear(true)}>
                清空记忆
              </button>
            )}
          </>
        }
      >
        <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
          这些是面试官在下次开场时会<b>优先进攻</b>的方向。重复踩坑的会自动往前提，同一项错得越多加权越高。
          <br />
          <span style={{ fontSize: 12 }}>
            进度条长度表示<b>严重程度</b> —— 分越低条越长越红，说明是硬伤，需要优先补。
          </span>
        </p>

        {adding && (
          <div className="form-row" style={{ marginBottom: 14, alignItems: 'flex-start' }}>
            <input
              className="input"
              placeholder="知识点 / 能力项，如：MySQL 索引下推"
              value={draft.topic}
              onChange={(e) => setDraft({ ...draft, topic: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && saveNew()}
            />
            <input
              className="input"
              type="number"
              min={0}
              max={10}
              style={{ maxWidth: 90 }}
              value={draft.score}
              onChange={(e) => setDraft({ ...draft, score: Number(e.target.value) })}
            />
            <input
              className="input"
              placeholder="备注（可选）"
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
            <button className="btn btn-sm btn-primary" onClick={saveNew}>
              添加
            </button>
          </div>
        )}

        {sorted.length === 0 ? (
          <Empty>还没有薄弱项。面试官抓到你不懂的东西时会自动记在这里。</Empty>
        ) : (
          <div>
            {sorted.map((w) => (
              <WeakRow
                key={w.topic}
                w={w}
                editing={editing === w.topic}
                draft={draft}
                setDraft={setDraft}
                onEdit={() => {
                  setEditing(w.topic)
                  setDraft({ topic: w.topic, score: w.score ?? 5, note: w.note || '' })
                }}
                onCancel={() => setEditing(null)}
                onSave={saveEdit}
                onDelete={() => del(w.topic)}
              />
            ))}
          </div>
        )}
      </Panel>

      <div className="two-col">
        <Panel title={`已确认的优势（${mem.strengths?.length || 0}）`}>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
            面试官会快速带过这些，把时间花在薄弱项上。
          </p>
          <div className="form-row" style={{ marginBottom: 12 }}>
            <input
              className="input"
              placeholder="如：并发编程基础扎实"
              value={newStrength}
              onChange={(e) => setNewStrength(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addStrength()}
            />
            <button className="btn btn-sm" onClick={addStrength} disabled={!newStrength.trim()}>
              添加
            </button>
          </div>
          {(mem.strengths || []).length === 0 ? (
            <Empty>暂无</Empty>
          ) : (
            <div className="pills">
              {mem.strengths.map((s) => (
                <span key={s} className="pill" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  {s}
                  <button
                    onClick={() => delStrength(s)}
                    style={{ color: 'var(--text-3)', lineHeight: 1 }}
                    title="移除"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="面试官对你的印象">
          {mem.lastSummary ? (
            <div className="spoken-box">{mem.lastSummary}</div>
          ) : (
            <Empty>还没有评语</Empty>
          )}
          <dl className="kv" style={{ marginTop: 14 }}>
            <dt>记忆更新</dt>
            <dd>{fmtTime(mem.updatedAt)}</dd>
            <dt>关联场次</dt>
            <dd>{(mem.sessionIds || []).length} 场</dd>
            <dt>目标岗位</dt>
            <dd>{profile?.targetRole || '未设置'}</dd>
            <dt>目标公司</dt>
            <dd>{profile?.company || '未设置'}</dd>
          </dl>
        </Panel>
      </div>

      {confirmClear && (
        <Confirm
          title="清空长期记忆？"
          danger
          confirmText="清空"
          message={
            <>
              会删除全部 <b>{sorted.length}</b> 个薄弱项、{mem.strengths?.length || 0} 项优势，
              以及面试官对你的印象评语。
              <br />
              面试记录本身不会删，但下一场面试他会像第一次见你一样。
            </>
          }
          onConfirm={async () => {
            try {
              await adminApi.clearMemory()
              load()
            } catch (e) {
              flash(e)
            }
          }}
          onClose={() => setConfirmClear(false)}
        />
      )}
    </>
  )
}

function WeakRow({
  w,
  editing,
  draft,
  setDraft,
  onEdit,
  onCancel,
  onSave,
  onDelete,
}: {
  w: WeakPoint
  editing: boolean
  draft: { topic: string; score: number; note: string }
  setDraft: (d: { topic: string; score: number; note: string }) => void
  onEdit: () => void
  onCancel: () => void
  onSave: () => void
  onDelete: () => void
}) {
  const [confirm, setConfirm] = useState(false)

  if (editing) {
    return (
      <div className="wp-row" style={{ alignItems: 'flex-start' }}>
        <div className="inline-edit">
          <input
            style={{ flex: 2 }}
            value={draft.topic}
            onChange={(e) => setDraft({ ...draft, topic: e.target.value })}
          />
          <input
            type="number"
            min={0}
            max={10}
            style={{ width: 62 }}
            value={draft.score}
            onChange={(e) => setDraft({ ...draft, score: Number(e.target.value) })}
          />
          <input
            style={{ flex: 3 }}
            placeholder="备注"
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
        </div>
        <button className="btn btn-sm btn-primary" onClick={onSave}>
          保存
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>
          取消
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="wp-row">
        <span className="wp-topic" title={w.note}>
          {w.topic}
          {w.note && (
            <span className="muted" style={{ fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
              {w.note}
            </span>
          )}
        </span>
        {(w.hits || 1) > 1 && <span className="wp-hits">踩坑 ×{w.hits}</span>}
        <span className="wp-track" title={`得分 ${w.score}/10 —— 条越长表示问题越严重`}>
          <i
            className={`wp-fill ${sevClass(w.score)}`}
            style={{ width: `${Math.max(6, severity(w.score) * 100)}%` }}
          />
        </span>
        <span className="mono" style={{ fontSize: 11.5, width: 40, textAlign: 'right' }}>
          {w.score}/10
        </span>
        <button className="btn btn-sm btn-ghost" onClick={onEdit}>
          编辑
        </button>
        <button
          className="btn btn-sm btn-ghost"
          style={{ color: 'var(--danger)' }}
          onClick={() => setConfirm(true)}
        >
          删除
        </button>
      </div>
      {confirm && (
        <Confirm
          title="删除这个薄弱项？"
          danger
          confirmText="删除"
          message={
            <>
              「<b>{w.topic}</b>」会从长期记忆里移除，下次面试官不会再专门问它。
            </>
          }
          onConfirm={onDelete}
          onClose={() => setConfirm(false)}
        />
      )}
    </>
  )
}
