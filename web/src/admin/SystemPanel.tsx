import { useEffect, useRef, useState } from 'react'
import { adminApi, fmtBytes, fmtTime, type SystemInfo } from './api'
import { Panel, Empty, Confirm } from './ui'
import type { Profile } from '../types'

type PingResult = { ok: boolean; latency: number; error?: string; count?: number }

export default function SystemPanel() {
  const [sys, setSys] = useState<SystemInfo | null>(null)
  const [models, setModels] = useState<Record<string, { ok: boolean; models: string[]; error?: string }> | null>(null)
  const [pings, setPings] = useState<Record<string, PingResult>>({})
  const [pinging, setPinging] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [confirmClear, setConfirmClear] = useState<null | 'sessions' | 'memory' | 'all'>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () =>
    adminApi
      .system()
      .then(setSys)
      .catch((e) => setErr(String(e.message || e)))

  useEffect(() => {
    load()
    adminApi.profile().then((r) => setProfile(r.profile)).catch(() => {})
  }, [])

  const flashErr = (e: unknown) => setErr(String((e as Error).message || e))

  const pingAll = async () => {
    setPinging(true)
    setErr(null)
    try {
      const r = await adminApi.pingAll()
      setPings(r.results)
    } catch (e) {
      flashErr(e)
    } finally {
      setPinging(false)
    }
  }

  const loadModels = async (force = false) => {
    setLoadingModels(true)
    try {
      const r = await adminApi.system(true, force)
      setModels(r.models)
    } catch (e) {
      flashErr(e)
    } finally {
      setLoadingModels(false)
    }
  }

  const doExport = async () => {
    try {
      const r = await adminApi.exportAll()
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      const d = new Date()
      const p = (x: number) => String(x).padStart(2, '0')
      a.download = `kewenguan-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      setMsg('备份已导出')
    } catch (e) {
      flashErr(e)
    }
  }

  const doImport = async (file: File, merge: boolean) => {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const r = await adminApi.importAll(data.data || data, merge)
      setMsg(
        `导入完成：档案 ${r.result.profile ? '✓' : '—'}，记忆 ${r.result.memory ? '✓' : '—'}，会话 ${r.result.sessions} 场`,
      )
      load()
    } catch (e) {
      flashErr(e)
    }
  }

  const saveProfileField = async (patch: Partial<Profile>) => {
    try {
      const r = await adminApi.saveProfile(patch)
      setProfile(r.profile)
      setMsg('已保存')
    } catch (e) {
      flashErr(e)
    }
  }

  if (err && !sys) return <Empty>加载失败：{err}</Empty>
  if (!sys) return <Empty>加载中…</Empty>

  return (
    <>
      {(err || msg) && (
        <div
          className={`toast${err ? ' err' : ''}`}
          style={{ position: 'static', marginBottom: 12 }}
          onClick={() => {
            setErr(null)
            setMsg(null)
          }}
        >
          {err || msg}
        </div>
      )}

      <Panel title="运行环境">
        <dl className="kv">
          <dt>Node</dt>
          <dd>{sys.node}</dd>
          <dt>平台</dt>
          <dd>{sys.platform}</dd>
          <dt>进程 PID</dt>
          <dd>{sys.pid}</dd>
          <dt>已运行</dt>
          <dd>
            {Math.floor(sys.uptime / 60)} 分 {sys.uptime % 60} 秒
          </dd>
          <dt>数据目录</dt>
          <dd>{sys.storage.dir}</dd>
          <dt>占用</dt>
          <dd>
            {fmtBytes(sys.storage.bytes)} / {sys.storage.files} 个文件
          </dd>
        </dl>
      </Panel>

      <Panel
        title="模型供应商"
        extra={
          <>
            <button className="btn btn-sm" onClick={pingAll} disabled={pinging}>
              {pinging ? <span className="spinner" /> : '全部体检'}
            </button>
            <button className="btn btn-sm" onClick={() => loadModels(true)} disabled={loadingModels}>
              {loadingModels ? <span className="spinner" /> : '刷新模型列表'}
            </button>
          </>
        }
      >
        <table className="table">
          <thead>
            <tr>
              <th>供应商</th>
              <th>Key</th>
              <th>连通性</th>
              <th>可用模型</th>
              <th>默认角色</th>
              <th>控制台</th>
            </tr>
          </thead>
          <tbody>
            {sys.providers.map((p) => {
              const ping = pings[p.id]
              const role = Object.entries(sys.roleDefaults).find(([, v]) => v.provider === p.id)
              return (
                <tr key={p.id}>
                  <td>
                    <b style={{ fontSize: 13 }}>{p.label}</b>
                    <div className="muted mono" style={{ fontSize: 10.5 }}>
                      {p.id}
                    </div>
                  </td>
                  <td>
                    {p.ready ? (
                      <span className="tag tag-ok">已配置</span>
                    ) : (
                      <span className="tag tag-accent">缺失</span>
                    )}
                  </td>
                  <td>
                    {!ping ? (
                      <span className="muted" style={{ fontSize: 12 }}>
                        未测
                      </span>
                    ) : ping.ok ? (
                      <span className="tag tag-ok">{ping.latency}ms</span>
                    ) : (
                      <span className="tag tag-accent" title={ping.error}>
                        失败
                      </span>
                    )}
                  </td>
                  <td className="num">
                    {models?.[p.id]?.ok ? (
                      models[p.id].models.length
                    ) : (
                      <span className="muted">{models?.[p.id]?.error ? '不可用' : '—'}</span>
                    )}
                  </td>
                  <td>
                    {role ? (
                      <span className="tag">
                        {role[0]} · {role[1].model}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <a
                      href={p.consoleUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 12, color: 'var(--text-2)' }}
                    >
                      打开
                    </a>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {models && (
          <div style={{ marginTop: 14 }}>
            <div className="panel-title" style={{ marginBottom: 8 }}>
              可用模型
            </div>
            {Object.entries(models).map(([pid, m]) => (
              <div key={pid} style={{ marginBottom: 10 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 5 }}>
                  {sys.providers.find((p) => p.id === pid)?.label || pid}
                  {m.ok ? `（${m.models.length} 个）` : `（${m.error || '不可用'}）`}
                </div>
                {m.ok && (
                  <div className="pills">
                    {m.models.slice(0, 60).map((mid) => (
                      <span key={mid} className="pill pill-model">
                        {mid}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="MCP 服务"
        extra={
          <button
            className="btn btn-sm"
            onClick={async () => {
              try {
                const r = await adminApi.mcpReload()
                setMsg(`已重载，发现 ${r.servers.length} 个 MCP 服务`)
                load()
              } catch (e) {
                flashErr(e)
              }
            }}
          >
            重载配置
          </button>
        }
      >
        {sys.mcpServers.length === 0 ? (
          <Empty>
            还没配置 MCP 服务。在项目根目录建 <code className="mono">mcp.json</code>，
            把小红书 MCP 配置贴进去，然后点「重载配置」。
            <pre className="code-block" style={{ marginTop: 12, textAlign: 'left' }}>{`{
  "mcpServers": {
    "xiaohongshu": {
      "command": "npx",
      "args": ["-y", "你的-小红书-mcp 包名"]
    }
  }
}`}</pre>
          </Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>传输</th>
                <th>启动命令 / 地址</th>
              </tr>
            </thead>
            <tbody>
              {sys.mcpServers.map((s) => (
                <tr key={s.name}>
                  <td>
                    <b>{s.name}</b>
                  </td>
                  <td>
                    <span className="tag">{s.transport}</span>
                  </td>
                  <td className="mono" style={{ fontSize: 11.5 }}>
                    {s.command}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="候选人档案">
        <div className="grid-2" style={{ marginBottom: 10 }}>
          <div className="field">
            <label>目标岗位</label>
            <input
              className="input"
              defaultValue={profile?.targetRole || ''}
              onBlur={(e) => saveProfileField({ targetRole: e.target.value })}
            />
          </div>
          <div className="field">
            <label>目标公司</label>
            <input
              className="input"
              defaultValue={profile?.company || ''}
              onBlur={(e) => saveProfileField({ company: e.target.value })}
            />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>简历 / 项目经历</label>
          <textarea
            className="textarea"
            style={{ minHeight: 120 }}
            defaultValue={profile?.resume || ''}
            onBlur={(e) => saveProfileField({ resume: e.target.value })}
            placeholder="简历上写的每一句「负责」「主导」都会被逐个问穿。"
          />
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          最近更新：{fmtTime(profile?.updatedAt || null)}　（失焦即自动保存）
        </div>
      </Panel>

      <Panel title="备份与还原">
        <div className="form-row" style={{ marginBottom: 12 }}>
          <button className="btn btn-sm btn-primary" onClick={doExport}>
            导出全部数据
          </button>
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
            从备份还原（合并）
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) doImport(f, true)
              e.target.value = ''
            }}
          />
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
          导出内容包含：候选人档案、长期记忆（薄弱项 + 优势 + 评语）、全部面试记录与评分。
          不含 API Key。合并模式按 id 去重，不会覆盖已有数据。
        </p>
      </Panel>

      <div className="danger-zone">
        <div className="panel-title" style={{ marginBottom: 6, color: 'var(--accent-strong)' }}>
          危险区
        </div>
        <div className="danger-row">
          <div className="t">
            <b>清空面试记录</b>
            <span>删除全部场次的问答与评分，保留长期记忆</span>
          </div>
          <button className="btn btn-sm btn-danger" onClick={() => setConfirmClear('sessions')}>
            清空
          </button>
        </div>
        <div className="danger-row">
          <div className="t">
            <b>清空长期记忆</b>
            <span>删除薄弱项图谱与优势，面试官会重新认识你</span>
          </div>
          <button className="btn btn-sm btn-danger" onClick={() => setConfirmClear('memory')}>
            清空
          </button>
        </div>
        <div className="danger-row">
          <div className="t">
            <b>恢复出厂设置</b>
            <span>记录、记忆、档案全部清空</span>
          </div>
          <button className="btn btn-sm btn-danger" onClick={() => setConfirmClear('all')}>
            全部清空
          </button>
        </div>
      </div>

      {confirmClear && (
        <Confirm
          title={
            confirmClear === 'all'
              ? '恢复出厂设置？'
              : confirmClear === 'sessions'
                ? '清空全部面试记录？'
                : '清空长期记忆？'
          }
          danger
          confirmText="确认清空"
          message={
            <>
              {confirmClear === 'all'
                ? '面试记录、长期记忆、候选人档案会被全部删除。'
                : confirmClear === 'sessions'
                  ? '全部场次的问答与评分会被删除，长期记忆保留。'
                  : '薄弱项、优势和印象评语会被删除，面试记录保留。'}
              <br />
              <b>此操作不可恢复。</b>建议先用上面的「导出全部数据」备一份。
            </>
          }
          onConfirm={async () => {
            try {
              await adminApi.clear(confirmClear)
              setMsg('已清空')
              load()
            } catch (e) {
              flashErr(e)
            }
          }}
          onClose={() => setConfirmClear(null)}
        />
      )}
    </>
  )
}
