/**
 * 轻量 MCP 客户端（支持 stdio 与 streamable-http 两种传输）
 *
 * 用途：接入小红书 MCP 等外部 MCP 服务，把笔记内容拉回来当面试素材。
 * 配置写在项目根目录 mcp.json，格式与 Claude/Cursor 通用：
 * {
 *   "mcpServers": {
 *     "xiaohongshu": { "command": "npx", "args": ["-y", "xxx-mcp"], "env": {...} }
 *   }
 * }
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { ROOT } from '../config.js'

const MCP_CONFIG_FILE = path.join(ROOT, 'mcp.json')

export function loadMcpConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(MCP_CONFIG_FILE, 'utf8'))
    return cfg.mcpServers || {}
  } catch {
    return {}
  }
}

/* ---------------- stdio 传输 ---------------- */

class StdioTransport {
  constructor(name, conf) {
    this.name = name
    this.conf = conf
    this.proc = null
    this.buf = ''
    this.pending = new Map()
    this.nextId = 1
  }

  start() {
    if (this.proc) return
    const { command, args = [], env = {} } = this.conf
    this.proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
      windowsHide: true,
    })
    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (chunk) => this.onData(chunk))
    this.proc.stderr.setEncoding('utf8')
    this.proc.stderr.on('data', () => {})
    this.proc.on('exit', () => {
      this.proc = null
      for (const [, p] of this.pending) p.reject(new Error(`MCP「${this.name}」进程退出`))
      this.pending.clear()
    })
  }

  onData(chunk) {
    this.buf += chunk
    let idx
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim()
      this.buf = this.buf.slice(idx + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    }
  }

  send(method, params) {
    this.start()
    const id = this.nextId++
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP「${this.name}」调用 ${method} 超时`))
      }, 60000)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      this.proc.stdin.write(payload + '\n')
    })
  }

  notify(method, params) {
    this.start()
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params: params || {} }) + '\n')
  }

  close() {
    try {
      this.proc?.kill()
    } catch {}
    this.proc = null
  }
}

/* ---------------- streamable-http 传输 ---------------- */

class HttpTransport {
  constructor(name, conf) {
    this.name = name
    this.conf = conf
    this.sessionId = null
    this.nextId = 1
  }

  async send(method, params) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.conf.headers || {}),
    }
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId
    const res = await fetch(this.conf.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params: params || {} }),
    })
    const sid = res.headers.get('mcp-session-id')
    if (sid) this.sessionId = sid
    const text = await res.text()
    // 可能是 SSE 包装
    const jsonLine = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .filter(Boolean)
      .pop()
    const body = jsonLine || text
    let msg
    try {
      msg = JSON.parse(body)
    } catch {
      throw new Error(`MCP「${this.name}」返回无法解析：${text.slice(0, 200)}`)
    }
    if (msg.error) throw new Error(msg.error.message || JSON.stringify(msg.error))
    return msg.result
  }

  notify() {
    /* 无状态 HTTP 传输下初始化通知可省略 */
  }

  close() {
    this.sessionId = null
  }
}

/* ---------------- 客户端封装 ---------------- */

const clients = new Map()

function getClient(name) {
  if (clients.has(name)) return clients.get(name)
  const conf = loadMcpConfig()[name]
  if (!conf) throw new Error(`mcp.json 里找不到名为「${name}」的服务`)
  const t = conf.url ? new HttpTransport(name, conf) : new StdioTransport(name, conf)
  clients.set(name, t)
  return t
}

let initialized = new Set()

async function ensureInit(name) {
  if (initialized.has(name)) return
  const c = getClient(name)
  await c.send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    clientInfo: { name: 'interview-aiagent', version: '0.1.0' },
  })
  try {
    c.notify('notifications/initialized')
  } catch {}
  initialized.add(name)
}

export async function listTools(name) {
  await ensureInit(name)
  const r = await getClient(name).send('tools/list', {})
  return r?.tools || []
}

export async function callTool(name, toolName, args = {}) {
  await ensureInit(name)
  const r = await getClient(name).send('tools/call', { name: toolName, arguments: args })
  // 把 MCP 的 content 数组压成纯文本
  const parts = (r?.content || [])
    .map((c) => (c.type === 'text' ? c.text : c.type === 'resource' ? c.resource?.text || '' : ''))
    .filter(Boolean)
  return { text: parts.join('\n'), raw: r, isError: Boolean(r?.isError) }
}

export function listServers() {
  return Object.entries(loadMcpConfig()).map(([name, conf]) => ({
    name,
    transport: conf.url ? 'http' : 'stdio',
    command: conf.command || conf.url || '',
  }))
}

export function closeAll() {
  for (const [, c] of clients) c.close()
  clients.clear()
  initialized = new Set()
}
