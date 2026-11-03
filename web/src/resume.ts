/**
 * 简历（Markdown）解析
 *
 * 为什么先只支持 .md：
 * 简历用 Markdown 写，结构是显式的（几段经历、每条 bullet、技能清单都在标题和列表里），
 * 比 PDF 里糊成一坨的文本好判断得多，面试官也能照着"逐条问穿"。
 * 以后要加 PDF / docx，只要在 readResumeFile 里补一条解析路径，
 * 下面的 analyzeResume 完全不用动。
 */

export interface ResumeSection {
  level: number
  heading: string
  /** 该标题下的正文（不含标题行） */
  body: string
}

/** 一个"值得被追问"的点 */
export interface ResumeFlag {
  /** 为什么值得问：数字 / 职责边界 / 技术选型 / 时间线 */
  reason: string
  /** 简历里的原文片段 */
  text: string
}

export interface ResumeAnalysis {
  title: string
  sections: ResumeSection[]
  bullets: string[]
  flags: ResumeFlag[]
  stats: {
    chars: number
    sections: number
    bullets: number
    numbers: number
  }
}

export const RESUME_ACCEPT = '.md,.markdown,.txt,text/markdown,text/plain'

/** 单份简历最大 512KB —— 再大基本就是粘错了文件 */
export const MAX_RESUME_BYTES = 512 * 1024

const MD_EXT = /\.(md|markdown|txt)$/i

/** 这个文件能不能当 Markdown 简历读 */
export function looksLikeMarkdown(file: File): boolean {
  if (MD_EXT.test(file.name)) return true
  return file.type === 'text/markdown' || file.type === 'text/plain'
}

/** 读文件成字符串（统一换行、去掉 BOM 和 YAML front-matter） */
export async function readResumeFile(file: File): Promise<string> {
  if (!looksLikeMarkdown(file)) {
    const ext = (file.name.match(/\.[^.]+$/)?.[0] || '该格式').toLowerCase()
    throw new Error(`目前支持 Markdown（.md / .markdown）和纯文本（.txt），${ext} 请先转成 md 再上传，或直接把文字粘进来`)
  }
  if (file.size > MAX_RESUME_BYTES) {
    throw new Error(`文件太大了（${(file.size / 1024 / 1024).toFixed(1)}MB），简历不该超过 512KB`)
  }
  const raw = await file.text()
  return normalizeMarkdown(raw)
}

export function normalizeMarkdown(raw: string): string {
  let s = String(raw || '').replace(/^\uFEFF/, '')
  s = s.replace(/\r\n?/g, '\n')
  // 去掉 YAML front-matter，那部分对面试官没用
  s = s.replace(/^---\n[\s\S]*?\n---\n/, '')
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

const H = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/

/** 一行是不是"带数字的战绩"：3000 / 30% / 200w / 3 倍 / 800ms */
const NUMERIC =
  /(\d[\d,.]*\s*(?:%|w\b|k\b|万|亿|倍|ms|s\b|qps|tps|人|天|次|条|秒|分钟|小时|台|核|g|m\b))/i

/** 把一段文字压成一句可展示的短句 */
function clip(s: string, n = 56): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}

/**
 * 解析 + 标出可疑点。
 * flags 只做"提示"，不参与提问逻辑 —— 真正怎么问交给模型，
 * 这里的作用是让用户一眼看到"这份简历会被从哪儿下手"。
 */
export function analyzeResume(md: string): ResumeAnalysis {
  const text = normalizeMarkdown(md)
  const lines = text.split('\n')

  const sections: ResumeSection[] = []
  const bullets: string[] = []
  let title = ''
  let cur: ResumeSection | null = null
  const bodyLines: string[] = []

  const flush = () => {
    if (cur) {
      cur.body = bodyLines.join('\n').trim()
      sections.push(cur)
      bodyLines.length = 0
    }
  }

  for (const line of lines) {
    const h = line.match(H)
    if (h) {
      flush()
      cur = { level: h[1].length, heading: h[2].trim(), body: '' }
      continue
    }
    const b = line.match(BULLET)
    if (b) bullets.push(b[1].trim())
    if (cur) bodyLines.push(line)
  }
  flush()

  const h1 = lines.find((l) => H.test(l) && (l.match(H)?.[1].length ?? 9) === 1)
  title = h1 ? (h1.match(H)?.[2] || '').trim() : (lines.find((l) => l.trim()) || '').trim()

  // ---- 可疑点：数字 / 职责边界 / 技术选型 ----
  const flags: ResumeFlag[] = []
  const pushFlag = (reason: string, text: string) => {
    if (!text || flags.some((f) => f.text === text)) return
    flags.push({ reason, text: clip(text) })
  }

  const claims = /(负责|主导|从\s*0\s*到\s*1|搭建|重构|优化|设计|选型|引入|迁移|替换|带领|推动|owner)/i
  for (const b of bullets) {
    if (NUMERIC.test(b)) pushFlag('数字', b)
    else if (claims.test(b)) pushFlag('职责边界', b)
  }

  // 正文里没写成 bullet、但带数字/夸张说法的句子也值得问
  if (flags.length < 8) {
    const sentences = text
      .split(/[。\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 8 && s.length <= 120)
    for (const s of sentences) {
      if (flags.length >= 8) break
      if (NUMERIC.test(s)) pushFlag('数字', s)
    }
  }

  // 时间线：出现 "2023.06 - 2024.05" 这类区间时，提醒核对
  const range = text.match(/20\d{2}\s*[.\-/年]\s*\d{1,2}.{0,12}?(?:至今|20\d{2})/)
  if (range && flags.length < 8) pushFlag('时间线', range[0])

  const numbers = bullets.filter((b) => NUMERIC.test(b)).length

  return {
    title: title || '未命名简历',
    sections,
    bullets,
    flags: flags.slice(0, 8),
    stats: {
      chars: text.length,
      sections: sections.length,
      bullets: bullets.length,
      numbers,
    },
  }
}
