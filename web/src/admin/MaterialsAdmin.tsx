import { useEffect, useState } from 'react'
import { adminApi, fmtTime } from './api'
import { Panel, Empty, Modal, Confirm } from './ui'
import type { MaterialSet } from '../types'

const LS_KEY = 'kewenguan.materials.v1'

export default function MaterialsAdmin() {
  const [items, setItems] = useState<MaterialSet[] | null>(null)
  const [stats, setStats] = useState({ sets: 0, total: 0, enabled: 0 })
  const [err, setErr] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [localCount, setLocalCount] = useState(0)

  const load = () =>
    adminApi
      .materials()
      .then((r) => {
        setItems(r.materials)
        setStats(r.stats)
      })
      .catch((e) => setErr(String(e.message || e)))

  useEffect(() => {
    load()
    // 检测浏览器里有没有旧数据
    try {
      const raw = localStorage.getItem(LS_KEY)
      const arr = raw ? JSON.parse(raw) : []
      if (Array.isArray(arr) && arr.length) setLocalCount(arr.length)
    } catch {
      /* ignore */
    }
  }, [])

  const flash = (e: unknown) => setErr(String((e as Error).message || e))

  const migrate = async () => {
    try {
      const arr = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
      if (!Array.isArray(arr) || !arr.length) return
      const r = await adminApi.importMaterials(arr)
      localStorage.removeItem(LS_KEY)
      setLocalCount(0)
      await load()
      setErr(`已从浏览器迁移 ${r.added} 份素材到服务端`)
    } catch (e) {
      flash(e)
    }
  }

  const toggle = async (m: MaterialSet) => {
    try {
      await adminApi.patchMaterial(m.id, { enabled: !m.enabled })
      load()
    } catch (e) {
      flash(e)
    }
  }

  const rename = async (m: MaterialSet, title: string) => {
    if (!title.trim() || title === m.title) return
    try {
      await adminApi.patchMaterial(m.id, { title: title.trim() })
      load()
    } catch (e) {
      flash(e)
    }
  }

  const del = async (id: string) => {
    try {
      await adminApi.deleteMaterial(id)
      load()
    } catch (e) {
      flash(e)
    }
  }

  if (err && !items) return <Empty>加载失败：{err}</Empty>
  if (!items) return <Empty>加载中…</Empty>

  return (
    <>
      {err && items && (
        <div className="toast" style={{ position: 'static', marginBottom: 12 }}>
          {err}
        </div>
      )}

      {localCount > 0 && (
        <div className="panel" style={{ borderColor: 'var(--warn-line)', background: 'var(--warn-soft)' }}>
          <div className="panel-body" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ flex: 1, fontSize: 13 }}>
              检测到浏览器里有 <b>{localCount}</b> 份旧的面经素材（存在 localStorage 里，
              换设备就会丢）。要把它们迁到服务端统一管理吗？
            </span>
            <button className="btn btn-sm btn-primary" onClick={migrate}>
              迁移到服务端
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setLocalCount(0)}>
              忽略
            </button>
          </div>
        </div>
      )}

      <Panel
        title={`面经素材库（${stats.sets} 份 / ${stats.total} 题）`}
        extra={
          <>
            <span className="tag tag-ok">启用 {stats.enabled} 题</span>
            <button className="btn btn-sm btn-primary" onClick={() => setImporting(true)}>
              导入素材
            </button>
          </>
        }
        flush
      >
        {items.length === 0 ? (
          <div style={{ padding: 15 }}>
            <Empty>
              还没有素材。点「导入素材」贴一个牛客/掘金链接或一段面经文本，
              大模型会自动把里面的题目抽成结构化题库。
            </Empty>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 44 }}>启用</th>
                <th>标题</th>
                <th>来源</th>
                <th>公司/岗位</th>
                <th>题目</th>
                <th>创建</th>
                <th style={{ width: 150 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <FragmentRow
                  key={m.id}
                  m={m}
                  expanded={expanded === m.id}
                  onToggleExpand={() => setExpanded(expanded === m.id ? null : m.id)}
                  onToggle={toggle}
                  onRename={rename}
                  onDelete={() => setConfirmDel(m.id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          onSaved={() => {
            setImporting(false)
            load()
          }}
        />
      )}

      {confirmDel && (
        <Confirm
          title="删除这份素材？"
          danger
          confirmText="删除"
          message={
            <>
              会连同里面的{' '}
              <b>{items.find((x) => x.id === confirmDel)?.questions.length || 0}</b> 道题一起删除。
            </>
          }
          onConfirm={() => del(confirmDel)}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </>
  )
}

function FragmentRow({
  m,
  expanded,
  onToggleExpand,
  onToggle,
  onRename,
  onDelete,
}: {
  m: MaterialSet
  expanded: boolean
  onToggleExpand: () => void
  onToggle: (m: MaterialSet) => void
  onRename: (m: MaterialSet, t: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(m.title)

  return (
    <>
      <tr>
        <td>
          <input
            type="checkbox"
            checked={m.enabled}
            onChange={() => onToggle(m)}
            style={{ accentColor: 'var(--accent)' }}
            title={m.enabled ? '已启用，面试官会从这里出题' : '已停用'}
          />
        </td>
        <td>
          {editing ? (
            <div className="inline-edit">
              <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  onRename(m, title)
                  setEditing(false)
                }}
              >
                存
              </button>
            </div>
          ) : (
            <span
              style={{ fontWeight: 500, cursor: 'text' }}
              onClick={() => setEditing(true)}
              title="点击改名"
            >
              {m.title}
            </span>
          )}
          {m.summary && (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 2, maxWidth: 320 }}>
              {m.summary.slice(0, 60)}
              {m.summary.length > 60 ? '…' : ''}
            </div>
          )}
        </td>
        <td>
          <span className="tag">{m.source}</span>
        </td>
        <td style={{ fontSize: 12.5 }}>
          {[m.meta?.company, m.meta?.role].filter(Boolean).join(' / ') || (
            <span className="muted">—</span>
          )}
        </td>
        <td className="num">{m.questions.length}</td>
        <td className="num muted" style={{ fontSize: 11.5 }}>
          {fmtTime(m.createdAt)}
        </td>
        <td>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-sm btn-ghost" onClick={onToggleExpand}>
              {expanded ? '收起' : '题目'}
            </button>
            {m.url && (
              <a
                className="btn btn-sm btn-ghost"
                href={m.url}
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: 'none' }}
              >
                原链接
              </a>
            )}
            <button
              className="btn btn-sm btn-ghost"
              style={{ color: 'var(--danger)' }}
              onClick={onDelete}
            >
              删除
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} style={{ background: 'var(--bg)', padding: '12px 16px' }}>
            {m.questions.map((q, i) => (
              <div className="material-item" key={i}>
                <span className="mono muted" style={{ fontSize: 11 }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="material-q">
                  {q.question}
                  <span style={{ marginLeft: 6 }}>
                    {q.tags?.slice(0, 4).map((t) => (
                      <span className="tag" key={t} style={{ marginRight: 4, fontSize: 10.5 }}>
                        {t}
                      </span>
                    ))}
                    <span
                      className={`tag ${q.difficulty === 'hard' ? 'tag-accent' : q.difficulty === 'easy' ? 'tag-ok' : 'tag-warn'}`}
                      style={{ fontSize: 10.5 }}
                    >
                      {q.difficulty}
                    </span>
                  </span>
                </span>
              </div>
            ))}
          </td>
        </tr>
      )}
    </>
  )
}

function ImportModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<'url' | 'text'>('url')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    title: string
    url?: string
    summary: string
    meta: { company?: string; role?: string }
    questions: { question: string; tags: string[]; difficulty: string }[]
  } | null>(null)

  const doExtract = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await adminApi.extract(
        tab === 'url' ? { url: url.trim(), hint } : { text: text.trim(), hint },
      )
      if (!r.preview.questions.length) throw new Error('这段内容里没抽到面试题')
      setPreview(r.preview)
    } catch (e) {
      setErr(String((e as Error).message || e))
    } finally {
      setBusy(false)
    }
  }

  const doSave = async (enabled: boolean) => {
    if (!preview) return
    setBusy(true)
    setErr(null)
    try {
      await adminApi.createMaterial({
        title: preview.title,
        url: preview.url,
        source: tab === 'url' ? '网页导入' : '手动粘贴',
        summary: preview.summary,
        meta: preview.meta,
        questions: preview.questions as MaterialSet['questions'],
        enabled,
      })
      onSaved()
    } catch (e) {
      setErr(String((e as Error).message || e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={preview ? `抽到 ${preview.questions.length} 道题 —— 确认入库` : '导入面经素材'}
      onClose={onClose}
      footer={
        preview ? (
          <>
            <button className="btn btn-sm" onClick={() => setPreview(null)} disabled={busy}>
              返回重来
            </button>
            <button className="btn btn-sm" onClick={() => doSave(false)} disabled={busy}>
              存为停用
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => doSave(true)} disabled={busy}>
              存并启用
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-sm" onClick={onClose}>
              取消
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={doExtract}
              disabled={busy || (tab === 'url' ? !url.trim() : text.trim().length < 30)}
            >
              {busy ? <span className="spinner" /> : '抽题'}
            </button>
          </>
        )
      }
    >
      {err && (
        <div className="toast err" style={{ position: 'static', marginBottom: 12 }}>
          {err}
        </div>
      )}

      {!preview ? (
        <>
          <div className="pills" style={{ marginBottom: 14 }}>
            <button className={`pill${tab === 'url' ? ' on' : ''}`} onClick={() => setTab('url')}>
              链接导入
            </button>
            <button className={`pill${tab === 'text' ? ' on' : ''}`} onClick={() => setTab('text')}>
              粘贴文本
            </button>
          </div>

          {tab === 'url' ? (
            <div className="field" style={{ marginBottom: 12 }}>
              <label>面经链接</label>
              <input
                className="input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.nowcoder.com/discuss/..."
              />
            </div>
          ) : (
            <div className="field" style={{ marginBottom: 12 }}>
              <label>面经正文</label>
              <textarea
                className="textarea"
                style={{ minHeight: 200 }}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="把面经原文、面试回忆、群里流传的题目列表直接贴进来。"
              />
            </div>
          )}

          <div className="field">
            <label>补充信息（可选）</label>
            <input
              className="input"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="如：字节跳动 后端三面"
            />
          </div>

          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            抓取正文后用大模型抽取题目，需要登录才能看的页面会失败。
          </p>
        </>
      ) : (
        <>
          <dl className="kv" style={{ marginBottom: 14 }}>
            <dt>标题</dt>
            <dd>{preview.title}</dd>
            <dt>公司 / 岗位</dt>
            <dd>
              {[preview.meta?.company, preview.meta?.role].filter(Boolean).join(' / ') || '未识别'}
            </dd>
            <dt>概述</dt>
            <dd style={{ fontFamily: 'var(--sans)', fontSize: 12.5 }}>{preview.summary || '—'}</dd>
          </dl>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {preview.questions.map((q, i) => (
              <div className="material-item" key={i}>
                <span className="mono muted" style={{ fontSize: 11 }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="material-q">
                  {q.question}
                  <span style={{ marginLeft: 6 }}>
                    {q.tags?.slice(0, 3).map((t) => (
                      <span className="tag" key={t} style={{ marginRight: 4, fontSize: 10.5 }}>
                        {t}
                      </span>
                    ))}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}
