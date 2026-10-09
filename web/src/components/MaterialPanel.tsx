import { useState } from 'react'
import { api } from '../api'
import type { AppConfig, MaterialSet } from '../types'

interface Props {
  materials: MaterialSet[]
  config: AppConfig
  onChange: () => void
  onClose: () => void
  push: (t: string, k?: 'info' | 'err') => void
}

/**
 * 主站的面经抽屉 —— 主打"快速加一份素材然后开面"。
 * 完整管理（改名、批量、备份、抽题预览）在 /admin 的面经库里。
 */
export default function MaterialPanel({ materials, config, onChange, onClose, push }: Props) {
  const [tab, setTab] = useState<'url' | 'text' | 'mcp'>('url')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const importThen = async (payload: { url?: string; text?: string }) => {
    setBusy(true)
    try {
      const r = await api.extract({ ...payload, hint: hint || undefined })
      if (!r.preview.questions.length) {
        push('这段内容里没抽到面试题，换个链接或改用粘贴文本', 'err')
        return
      }
      await api.createMaterial({
        title: r.preview.title,
        url: r.preview.url,
        source: payload.url ? '网页导入' : '手动粘贴',
        summary: r.preview.summary,
        meta: r.preview.meta,
        questions: r.preview.questions as MaterialSet['questions'],
        enabled: true,
      })
      push(`已抽取并启用 ${r.preview.questions.length} 道题`)
      setUrl('')
      setText('')
      onChange()
    } catch (e) {
      push(String((e as Error).message || e), 'err')
    } finally {
      setBusy(false)
    }
  }

  const totalQ = materials.reduce((n, m) => n + m.questions.length, 0)
  const enabledQ = materials.filter((m) => m.enabled).reduce((n, m) => n + m.questions.length, 0)

  return (
    <>
      <div className="drawer-mask" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <span className="card-title">面经库</span>
          <span className="tag">
            {materials.length} 份 / {totalQ} 题
          </span>
          {enabledQ > 0 && <span className="tag tag-ok">启用 {enabledQ}</span>}
          <div className="topbar-spacer" />
          <a
            className="btn btn-sm btn-ghost"
            href="/admin#materials"
            style={{ textDecoration: 'none' }}
          >
            详细管理
          </a>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="drawer-body">
          <div className="pills" style={{ marginBottom: 14 }}>
            <button className={`pill${tab === 'url' ? ' on' : ''}`} onClick={() => setTab('url')}>
              链接导入
            </button>
            <button className={`pill${tab === 'text' ? ' on' : ''}`} onClick={() => setTab('text')}>
              粘贴文本
            </button>
            <button className={`pill${tab === 'mcp' ? ' on' : ''}`} onClick={() => setTab('mcp')}>
              MCP
            </button>
          </div>

          {tab === 'url' && (
            <div className="field" style={{ marginBottom: 14 }}>
              <label>牛客 / 掘金 / 博客 链接</label>
              <input
                className="input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && url.trim() && importThen({ url: url.trim() })}
                placeholder="https://www.nowcoder.com/discuss/..."
              />
              <input
                className="input"
                style={{ marginTop: 6 }}
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="补充信息（可选）：如「字节 后端 三面」"
              />
              <div style={{ marginTop: 8 }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => importThen({ url: url.trim() })}
                  disabled={busy || !url.trim()}
                >
                  {busy ? <span className="spinner" /> : '抓取并抽题'}
                </button>
              </div>
              <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                抓取正文后用大模型抽成结构化题库。需要登录才能看的页面会失败。
              </p>
            </div>
          )}

          {tab === 'text' && (
            <div className="field" style={{ marginBottom: 14 }}>
              <label>直接粘贴面经内容</label>
              <textarea
                className="textarea"
                style={{ minHeight: 180 }}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="把面经正文、面试回忆、群里流传的题目列表，直接粘进来。"
              />
              <input
                className="input"
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="素材标题（可选）：如「某厂 AI 岗一面」"
              />
              <div style={{ marginTop: 8 }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => importThen({ text: text.trim() })}
                  disabled={busy || text.trim().length < 30}
                >
                  {busy ? <span className="spinner" /> : '抽题'}
                </button>
              </div>
            </div>
          )}

          {tab === 'mcp' && <McpTab config={config} push={push} onImported={onChange} />}

          <hr className="hr" style={{ margin: '18px 0 14px' }} />

          {materials.length === 0 ? (
            <div className="empty">还没有素材。加一份面经，面试官就会按真实考题来问你。</div>
          ) : (
            materials.map((m) => (
              <div className="card" key={m.id} style={{ padding: 13, marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={m.enabled}
                    onChange={async (e) => {
                      try {
                        await api.patchMaterial(m.id, { enabled: e.target.checked })
                        onChange()
                      } catch (err) {
                        push(String((err as Error).message || err), 'err')
                      }
                    }}
                    style={{ marginTop: 4, accentColor: 'var(--accent)' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{m.title}</div>
                    <div
                      className="muted"
                      style={{ fontSize: 11.5, fontFamily: 'var(--mono)', marginTop: 2 }}
                    >
                      {m.source} · {m.questions.length} 题
                      {m.meta?.company ? ` · ${m.meta.company}` : ''}
                    </div>
                    {m.summary && (
                      <div className="muted" style={{ fontSize: 12, marginTop: 5, lineHeight: 1.5 }}>
                        {m.summary}
                      </div>
                    )}
                    <div style={{ marginTop: 7, display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => setExpanded(expanded === m.id ? null : m.id)}
                      >
                        {expanded === m.id ? '收起题目' : '查看题目'}
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        style={{ color: 'var(--danger)' }}
                        onClick={async () => {
                          try {
                            await api.deleteMaterial(m.id)
                            push('已删除')
                            onChange()
                          } catch (err) {
                            push(String((err as Error).message || err), 'err')
                          }
                        }}
                      >
                        删除
                      </button>
                    </div>
                    {expanded === m.id && (
                      <div style={{ marginTop: 9 }}>
                        {m.questions.map((q, i) => (
                          <div className="material-item" key={i}>
                            <span className="mono muted" style={{ fontSize: 11 }}>
                              {String(i + 1).padStart(2, '0')}
                            </span>
                            <span className="material-q">
                              {q.question}
                              {q.tags?.length > 0 && (
                                <span style={{ marginLeft: 6 }}>
                                  {q.tags.slice(0, 3).map((t) => (
                                    <span
                                      className="tag"
                                      key={t}
                                      style={{ marginRight: 4, fontSize: 10.5 }}
                                    >
                                      {t}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  )
}

/* ---------- MCP ---------- */

function McpTab({
  config,
  push,
  onImported,
}: {
  config: AppConfig
  push: (t: string, k?: 'info' | 'err') => void
  onImported: () => void
}) {
  const [server, setServer] = useState(config.mcpServers[0]?.name || '')
  const [tools, setTools] = useState<{ name: string; description?: string }[]>([])
  const [tool, setTool] = useState('')
  const [argsText, setArgsText] = useState('{}')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)

  if (config.mcpServers.length === 0) {
    return (
      <div className="empty">
        还没配置 MCP 服务。
        <div style={{ marginTop: 8, fontSize: 12.5 }}>
          在项目根目录建一个 <code className="mono">mcp.json</code>，把小红书 MCP 按你现有的配置贴进去：
        </div>
        <pre
          className="mono"
          style={{
            textAlign: 'left',
            fontSize: 11.5,
            background: 'var(--surface-2)',
            padding: 10,
            borderRadius: 6,
            marginTop: 10,
            overflowX: 'auto',
          }}
        >{`{
  "mcpServers": {
    "xiaohongshu": {
      "command": "npx",
      "args": ["-y", "你的-小红书-mcp 包名"]
    }
  }
}`}</pre>
        <div style={{ marginTop: 8, fontSize: 12.5 }}>保存后刷新页面即可在这里调用。</div>
      </div>
    )
  }

  const loadTools = async () => {
    setBusy(true)
    try {
      const r = await api.mcpTools(server)
      setTools(r.tools)
      if (r.tools[0]) setTool(r.tools[0].name)
      push(`拿到 ${r.tools.length} 个工具`)
    } catch (e) {
      push(String((e as Error).message || e), 'err')
    } finally {
      setBusy(false)
    }
  }

  const call = async () => {
    setBusy(true)
    setResult('')
    try {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(argsText)
      } catch {
        throw new Error('参数不是合法 JSON')
      }
      const r = await api.mcpCall(server, tool, args)
      setResult(r.result.text.slice(0, 6000))
      if (r.result.isError) push('工具返回了错误', 'err')
    } catch (e) {
      push(String((e as Error).message || e), 'err')
    } finally {
      setBusy(false)
    }
  }

  const extract = async () => {
    if (!result.trim()) return
    setBusy(true)
    try {
      const r = await api.extract({ text: result, hint: `来自 MCP：${server}/${tool}` })
      if (!r.preview.questions.length) {
        push('这段内容里没抽到题', 'err')
        return
      }
      await api.createMaterial({
        title: `MCP · ${server}`,
        source: 'MCP',
        summary: r.preview.summary,
        meta: r.preview.meta,
        questions: r.preview.questions as MaterialSet['questions'],
        enabled: true,
      })
      push(`从 MCP 内容抽取并启用 ${r.preview.questions.length} 道题`)
      onImported()
    } catch (e) {
      push(String((e as Error).message || e), 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="field" style={{ marginBottom: 10 }}>
        <label>MCP 服务</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="select" value={server} onChange={(e) => setServer(e.target.value)}>
            {config.mcpServers.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}（{s.transport}）
              </option>
            ))}
          </select>
          <button className="btn btn-sm" onClick={loadTools} disabled={busy}>
            列出工具
          </button>
        </div>
      </div>

      {tools.length > 0 && (
        <>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>工具</label>
            <select className="select" value={tool} onChange={(e) => setTool(e.target.value)}>
              {tools.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
            {tools.find((t) => t.name === tool)?.description && (
              <span className="muted" style={{ fontSize: 12 }}>
                {tools.find((t) => t.name === tool)?.description}
              </span>
            )}
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>参数（JSON）</label>
            <textarea
              className="textarea mono"
              style={{ minHeight: 70, fontSize: 12.5 }}
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
            />
          </div>
          <button className="btn btn-primary btn-sm" onClick={call} disabled={busy || !tool}>
            {busy ? <span className="spinner" /> : '调用'}
          </button>
        </>
      )}

      {result && (
        <div style={{ marginTop: 14 }}>
          <div className="field">
            <label>返回内容</label>
            <textarea
              className="textarea mono"
              style={{ minHeight: 160, fontSize: 12 }}
              value={result}
              onChange={(e) => setResult(e.target.value)}
            />
          </div>
          <button
            className="btn btn-accent btn-sm"
            style={{ marginTop: 8 }}
            onClick={extract}
            disabled={busy}
          >
            从这段内容抽题
          </button>
        </div>
      )}
    </div>
  )
}
