/**
 * 面经素材接口（主站与后台共用）
 */
import {
  listMaterials,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  bulkImport,
  statsMaterials,
} from '../memory/materials.js'
import { importFromUrl, extractQuestions, fetchPageText } from '../sources/url.js'

export function mountMaterials(app, wrap) {
  app.get('/api/materials', wrap((_req, res) => {
    res.json({ ok: true, materials: listMaterials(), stats: statsMaterials() })
  }))

  app.post('/api/materials', wrap((req, res) => {
    const m = createMaterial(req.body || {})
    res.json({ ok: true, material: m, stats: statsMaterials() })
  }))

  app.patch('/api/materials/:id', wrap((req, res) => {
    const m = updateMaterial(req.params.id, req.body || {})
    if (!m) return res.status(404).json({ ok: false, error: '素材不存在' })
    res.json({ ok: true, material: m, stats: statsMaterials() })
  }))

  app.delete('/api/materials/:id', wrap((req, res) => {
    const okDel = deleteMaterial(req.params.id)
    if (!okDel) return res.status(404).json({ ok: false, error: '素材不存在' })
    res.json({ ok: true, stats: statsMaterials() })
  }))

  /** 批量导入（前端 localStorage 迁移 / 备份还原） */
  app.post('/api/materials/import', wrap((req, res) => {
    if (!Array.isArray(req.body?.items)) {
      return res.status(400).json({ ok: false, error: 'items 必须是数组' })
    }
    res.json({ ok: true, ...bulkImport(req.body.items), stats: statsMaterials() })
  }))

  /**
   * 抽题预览（不落库）。
   * body: { url } 或 { text }，可带 hint
   */
  app.post('/api/materials/extract', wrap(async (req, res) => {
    const { url, text, hint, title } = req.body || {}
    if (url) {
      if (!/^https?:\/\//i.test(url)) {
        return res.status(400).json({ ok: false, error: '请提供合法的 http(s) 链接' })
      }
      const r = await importFromUrl(url, { hint })
      return res.json({ ok: true, preview: { ...r, url, title: r.title || url } })
    }
    if (text) {
      if (String(text).length < 30) return res.status(400).json({ ok: false, error: '文本太短' })
      const r = await extractQuestions(text, { hint })
      return res.json({ ok: true, preview: { ...r, title: title || hint || '手动粘贴素材' } })
    }
    res.status(400).json({ ok: false, error: '需要提供 url 或 text' })
  }))

  /** 只抓正文不抽题，给后台预览用 */
  app.post('/api/materials/fetch', wrap(async (req, res) => {
    const { url } = req.body || {}
    if (!url) return res.status(400).json({ ok: false, error: '缺少 url' })
    const r = await fetchPageText(url)
    res.json({ ok: true, title: r.title, chars: r.text.length, excerpt: r.text.slice(0, 1200) })
  }))
}
