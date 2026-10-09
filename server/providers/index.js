/**
 * 供应商客户端：模型列表拉取 + 流式对话
 */
import OpenAI from 'openai'
import { PROVIDERS, NON_CHAT_HINTS, providerById } from '../config.js'

const clientCache = new Map()

export function getClient(providerId) {
  const p = providerById(providerId)
  if (!p) throw new Error(`未知供应商: ${providerId}`)
  if (!p.apiKey) throw new Error(`供应商「${p.label}」还没配 API Key，请在 .env 里补上`)
  if (!clientCache.has(providerId)) {
    clientCache.set(
      providerId,
      new OpenAI({ apiKey: p.apiKey, baseURL: p.baseURL, timeout: 120_000, maxRetries: 1 }),
    )
  }
  return clientCache.get(providerId)
}

function looksLikeChatModel(id) {
  const low = id.toLowerCase()
  // 带负号日期尾巴的版本快照，太杂，只保留主力名
  if (NON_CHAT_HINTS.some((h) => low.includes(h))) return false
  if (/-\d{4}-\d{2}-\d{2}$/.test(low)) return false
  if (/-\d{4}$/.test(low)) return false
  return true
}

/** 单个供应商的可用对话模型 id 列表 */
async function listModels(providerId) {
  const client = getClient(providerId)
  const res = await client.models.list()
  return (res.data || []).map((m) => m.id)
}

const modelListCache = new Map() // providerId -> { at, ids }
const CACHE_TTL = 10 * 60 * 1000

/** 聚合所有已配置供应商的模型，带 10 分钟缓存 */
export async function listAllModels({ force = false } = {}) {
  const out = {}
  await Promise.all(
    Object.values(PROVIDERS).map(async (p) => {
      if (!p.apiKey) {
        out[p.id] = { ok: false, error: '未配置 API Key', models: [] }
        return
      }
      const cached = modelListCache.get(p.id)
      if (!force && cached && Date.now() - cached.at < CACHE_TTL) {
        out[p.id] = { ok: true, models: cached.ids, cached: true }
        return
      }
      try {
        const all = await listModels(p.id)
        const ids = all.filter(looksLikeChatModel).sort()
        modelListCache.set(p.id, { at: Date.now(), ids })
        out[p.id] = { ok: true, models: ids, total: all.length }
      } catch (err) {
        out[p.id] = { ok: false, error: String(err?.message || err), models: [] }
      }
    }),
  )
  return out
}

/**
 * 流式对话。返回 async generator，逐个吐出 { type, ... } 事件。
 * 事件类型：delta(文本增量) / reasoning(思维链增量) / usage / done
 */
export async function* streamChat({ provider, model, messages, temperature, maxTokens, jsonMode }) {
  const client = getClient(provider)
  const params = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  }
  if (typeof temperature === 'number') params.temperature = temperature
  if (maxTokens) params.max_tokens = maxTokens
  if (jsonMode) params.response_format = { type: 'json_object' }

  const stream = await client.chat.completions.create(params)
  for await (const chunk of stream) {
    if (chunk.usage) yield { type: 'usage', usage: chunk.usage }
    const choice = chunk.choices?.[0]
    if (!choice) continue
    const d = choice.delta || {}
    const reasoning = d.reasoning_content || d.reasoning
    if (reasoning) yield { type: 'reasoning', text: reasoning }
    if (d.content) yield { type: 'delta', text: d.content }
  }
  yield { type: 'done' }
}

/** 一次性问答（用于评分、摘要等非流式场景） */
export async function chat({ provider, model, messages, temperature, maxTokens, jsonMode }) {
  const client = getClient(provider)
  const params = { model, messages }
  if (typeof temperature === 'number') params.temperature = temperature
  if (maxTokens) params.max_tokens = maxTokens
  if (jsonMode) params.response_format = { type: 'json_object' }
  const res = await client.chat.completions.create(params)
  return res.choices?.[0]?.message?.content ?? ''
}

/** 连通性体检 */
export async function pingProvider(providerId) {
  const p = providerById(providerId)
  if (!p) return { ok: false, error: '未知供应商' }
  if (!p.apiKey) return { ok: false, error: '未配置 API Key' }
  const t0 = Date.now()
  try {
    const ids = await listModels(providerId)
    return { ok: true, latency: Date.now() - t0, count: ids.length }
  } catch (err) {
    return { ok: false, error: String(err?.message || err), latency: Date.now() - t0 }
  }
}
