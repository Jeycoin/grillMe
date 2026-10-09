/**
 * 网页抓取 + 正文提取
 *
 * 目标站点：牛客网、掘金、CSDN、知乎、个人博客…
 * 不做站点特化，统一走"取 HTML → 抽正文 → 交给 LLM 结构化"的路子，抗改版。
 */
import { chat } from '../providers/index.js'
import { ROLE_DEFAULTS } from '../config.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** 粗暴但有效的正文抽取 */
function htmlToText(html) {
  let s = html
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '')
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  // 保留段落分隔
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<[^>]+>/g, '')
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&hellip;/g, '…')
  s = s.replace(/[ \t\u00a0]+/g, ' ')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

export async function fetchPageText(url, { timeout = 20000 } = {}) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeout)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
      signal: ctl.signal,
    })
    if (!res.ok) throw new Error(`抓取失败 HTTP ${res.status}`)
    const ctype = res.headers.get('content-type') || ''
    const raw = await res.text()
    if (!ctype.includes('html')) return { text: raw.slice(0, 100000), title: '' }
    const title = (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim()
    const text = htmlToText(raw)
    return { text: text.slice(0, 100000), title }
  } finally {
    clearTimeout(timer)
  }
}

const EXTRACT_SYSTEM = `你是面试题库结构化助手。从给定的网页正文中，抽取所有"面试题目/面试知识点"。

只输出 JSON，结构：
{
  "meta": { "company": "来源公司，没有就空字符串", "role": "岗位，没有就空字符串", "sourceType": "面经/八股/其他" },
  "questions": [
    { "question": "题目文本，改写为面试官会直接问出口的一句话", "tags": ["标签1","标签2"], "difficulty": "easy|medium|hard" }
  ],
  "summary": "这段材料的整体内容一句话概括"
}

规则：
- 只抽取真正的问题或考点，不要抽"我今天面试了XX公司"这种闲聊。
- 面试体验描述里的技术考察点要提炼成问题，比如"问了MySQL索引"要改写成"讲讲 MySQL 索引的底层结构，为什么用 B+ 树"。
- 最多抽 40 题，按重要性排序。
- question 必须是完整的、可以被直接问出口的问句，不要是关键词堆砌。
- 如果正文里几乎没有面试题，questions 返回空数组。`

/**
 * 从正文里抽出结构化题目
 */
export async function extractQuestions(text, { hint = '', model } = {}) {
  const use = model || ROLE_DEFAULTS.quick
  const raw = await chat({
    provider: use.provider,
    model: use.model,
    messages: [
      { role: 'system', content: EXTRACT_SYSTEM },
      {
        role: 'user',
        content: `${hint ? `【补充信息】${hint}\n\n` : ''}【网页正文】\n${text.slice(0, 60000)}`,
      },
    ],
    temperature: 0.2,
    maxTokens: 4000,
    jsonMode: true,
  })
  const parsed = safeJSON(raw)
  if (!parsed) throw new Error('题目抽取失败：模型返回无法解析')
  return {
    meta: parsed.meta || {},
    summary: parsed.summary || '',
    questions: (parsed.questions || [])
      .filter((q) => q && typeof q.question === 'string' && q.question.trim())
      .map((q) => ({
        question: q.question.trim(),
        tags: Array.isArray(q.tags) ? q.tags.slice(0, 6) : [],
        difficulty: q.difficulty || 'medium',
      })),
  }
}

/** 一步到位：给 URL，拿题目 */
export async function importFromUrl(url, { hint, model } = {}) {
  const { text, title } = await fetchPageText(url)
  if (!text || text.length < 80) throw new Error('页面正文过短，可能是反爬拦截或需要登录')
  const result = await extractQuestions(text, { hint: hint || `来源标题：${title}\n来源链接：${url}`, model })
  return { ...result, url, title }
}

function safeJSON(text) {
  if (!text) return null
  let s = String(text).trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) s = fence[1].trim()
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a >= 0 && b > a) s = s.slice(a, b + 1)
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
