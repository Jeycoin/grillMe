/**
 * 小红书配图出图脚本（真浏览器 + CDP）
 *
 * 和 shot.cjs 的区别，也是它存在的三个理由：
 *   1. 顶栏有产品名，直接发会暴露。这里注入 CSS 把 .topbar 干掉，
 *      只留"题面 + 作答 + 复盘"这些纯内容。
 *   2. 网页截图直接发手机上看，字号会小到看不清。这里按 3:4 竖版
 *      裁剪 + 2x scale 出图，文字相对尺寸翻倍。
 *   3. 报告页、对话页都在 overflow 容器里，不放开滚动就只能截到首屏。
 *      这里把 .scroll 的裁剪解除，让整页长出来，再按坐标裁。
 *
 * 用法：
 *   node scripts/xhs-shot.cjs --outdir .preview/xhs
 *   node scripts/xhs-shot.cjs --url http://127.0.0.1:8787/ --vw 760 --vh 1140
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const WebSocket = require('ws')

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  if (i === -1) return def
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : true
}

const URL_ = String(arg('url', 'http://127.0.0.1:8787/'))
const OUTDIR = String(arg('outdir', '.preview/xhs'))
const PORT = Number(arg('port', 9600 + Math.floor(Math.random() * 200)))
const VW = Number(arg('vw', 760))
const VH = Number(arg('vh', 1140))
const SCALE = Number(arg('scale', 2))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 藏掉一切能指向"这是某个产品"的东西 */
const SANITIZE_CSS = `
  .topbar { display: none !important; }
  html, body { height: auto !important; overflow: visible !important; }
  body > div { height: auto !important; overflow: visible !important; }
  #root { height: auto !important; overflow: visible !important; }
  .scroll { overflow: visible !important; height: auto !important; flex: none !important; min-height: 0 !important; }
  .interview-grid { height: auto !important; min-height: 0 !important; flex: none !important; }
  .answer-rail { position: static !important; }
`

/** 四轮作答，内容尽量像真的在面后端岗 */
const ANSWERS = [
  '我目前在做交易系统的后端，主要跟订单链路。最近一年在负责把订单查询从单体里拆成独立服务，QPS 从 800 提到 3000，P99 从 120ms 降到 35ms。做法是加了一层本地缓存，热点商品走缓存，冷数据回源；同时把原来的同步扣减改成了异步化。',
  '缓存一致性上我用的是先更新数据库再删缓存，删除失败会投递到消息队列重试。没用延迟双删是因为我们写比例很低，冲突窗口本来就小，双删带来的额外延迟不划算。不过这里确实有个问题：如果删缓存一直失败、消息也积压了，就会读到脏数据，我们目前靠监控告警人工介入，这块我承认没做到自动收敛。',
  '压测用的是 JMeter，单机 500 并发跑 30 分钟。QPS 那个数字是在缓存命中率 92% 的前提下测出来的，如果缓存全穿透，回源大概只能扛 1200 左右。P99 是取的线上真实流量一天的统计，不是压测值，这点我说得不够严谨。',
  '如果让我重做一次，我会先定好降级策略再动手：缓存层加本地限流，回源连接池做隔离，另外把删除失败的重试做成有上限的补偿任务，到阈值直接告警降级到直连数据库，而不是让它一直积压。',
]

async function main() {
  const exe = EDGE_CANDIDATES.find((p) => fs.existsSync(p))
  if (!exe) throw new Error('找不到 Edge / Chrome')

  fs.mkdirSync(OUTDIR, { recursive: true })

  const child = spawn(
    exe,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${path.join(process.env.TEMP || '/tmp', 'xhs-shot-' + PORT)}`,
      `--window-size=${VW},${VH}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  try {
    const target = await waitTarget(PORT, 20000)
    const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
    await new Promise((res, rej) => {
      ws.on('open', res)
      ws.on('error', rej)
    })

    let seq = 0
    const pending = new Map()
    ws.on('message', (raw) => {
      const m = JSON.parse(raw)
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m)
        pending.delete(m.id)
      }
    })
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq
        pending.set(id, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)))
        ws.send(JSON.stringify({ id, method, params }))
      })

    await send('Runtime.enable')
    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', {
      width: VW,
      height: VH,
      deviceScaleFactor: 1,
      mobile: false,
    })
    // 浅色主题：截图里更适合当"笔记"，也避免深色在小红书信息流里发闷
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try{localStorage.setItem('kewenguan.theme.v1','light')}catch(e){}`,
    })

    await send('Page.navigate', { url: URL_ })
    await sleep(1500)

    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
      })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval 异常')
      return r.result.value
    }

    const waitFor = async (expr, timeoutMs, label) => {
      const t0 = Date.now()
      for (;;) {
        if (await evaluate(expr)) return true
        if (Date.now() - t0 > timeoutMs) throw new Error('超时等待：' + label)
        await sleep(600)
      }
    }

    const injectCss = async () => {
      await evaluate(`(() => {
        const id = 'xhs-sanitize'
        let s = document.getElementById(id)
        if (!s) { s = document.createElement('style'); s.id = id; document.head.appendChild(s) }
        s.textContent = ${JSON.stringify(SANITIZE_CSS)}
        return true
      })()`)
    }

    /** 元素在整页坐标系里的位置（已解除 overflow，window 不滚动） */
    const rectOf = (sel) =>
      evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(sel)})
        if (!el) return null
        const b = el.getBoundingClientRect()
        return { x: b.x, y: b.y + window.scrollY, w: b.width, h: b.height }
      })()`)

    const shotClip = async (name, clip) => {
      const r = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: SCALE },
      })
      const file = path.join(OUTDIR, name)
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'))
      console.log(`  ✓ ${name}  ${Math.round(clip.w * SCALE)}×${Math.round(clip.h * SCALE)}`)
      return file
    }

    console.log('[1/4] 打开配置页并藏掉顶栏')
    await injectCss()

    console.log('[2/4] 开始面试')
    await evaluate(`document.querySelector('.btn-accent').click()`)
    await waitFor(`!!document.querySelector('.transcript')`, 20000, '面试页')

    for (let i = 0; i < ANSWERS.length; i++) {
      await sleep(6000)
      await waitFor(
        `(() => { const ta = document.querySelector('.composer textarea'); return ta && !ta.disabled })()`,
        120000,
        `第 ${i + 1} 轮就绪`,
      )
      await evaluate(`(() => {
        const ta = document.querySelector('.composer textarea')
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
        setter.call(ta, ${JSON.stringify(ANSWERS[i])})
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`)
      await sleep(400)
      await evaluate(`document.querySelector('.composer-actions .btn-accent').click()`)
      console.log(`  · 已提交第 ${i + 1} 轮`)
      await waitFor(`document.querySelector('.composer textarea').disabled`, 20000, '提交受理')
    }

    console.log('[3/4] 等面试官把最后一段说完，再扒对话区')
    // 关键：textarea 的 disabled === busy。等它解禁才算这一轮真的生成完，
    // 否则会截到一半流式输出的残句（而且这时候「结束并评分」还是 disabled，
    // 点下去会被无声吞掉——上一版就是栽在这）。
    await waitFor(
      `(() => { const ta = document.querySelector('.composer textarea'); return ta && !ta.disabled })()`,
      120000,
      '最后一轮生成完',
    )
    // 再等音频队列排空，免得截到"待播 2 句"这种中间态
    await sleep(3000)
    await injectCss()

    const tRect = await rectOf('.transcript')
    const bubbles = await evaluate(`[...document.querySelectorAll('.transcript .bubble')].map(b => {
      const r = b.getBoundingClientRect()
      return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY }
    })`)
    if (tRect && bubbles.length >= 4) {
      // 宽度不能卡在 720：对话列实际比这宽，卡了会把每行末尾切掉。
      const w = tRect.w
      const maxH = (w * 4) / 3
      // 从第 3 个气泡起裁：第 1 个是开场寒暄，信息量低
      const y = bubbles[2].top - 14
      // 高度吸附到气泡边界，避免最后一行被腰斩
      let h = maxH
      for (const b of bubbles) {
        const cand = b.bottom + 18 - y
        if (cand > 200 && cand <= maxH) h = cand
      }
      await shotClip('01-对话.png', { x: tRect.x, y, w, h })
    } else {
      console.log(`  ! 对话区元素不足（bubbles=${bubbles ? bubbles.length : 0}），跳过`)
    }

    console.log('[4/4] 结束并评分，扒报告页')
    await waitFor(
      `(() => {
         const btn = [...document.querySelectorAll('.composer-actions button')]
           .find(b => b.textContent.includes('结束并评分'))
         return btn && !btn.disabled
       })()`,
      60000,
      '「结束并评分」可点',
    )
    await evaluate(`(() => {
      const btn = [...document.querySelectorAll('.composer-actions button')]
        .find(b => b.textContent.includes('结束并评分'))
      btn.click()
      return true
    })()`)
    await waitFor(`!!document.querySelector('.score-hero')`, 240000, '报告页')
    await sleep(2000)
    await injectCss()

    const pRect = await rectOf('.page') || (await rectOf('.page-narrow'))
    const scoreRect = await rectOf('.score-hero')
    if (pRect && scoreRect) {
      const w = Math.min(pRect.w, 720)
      const h = (w * 4) / 3
      await shotClip('02-复盘-评分.png', { x: pRect.x, y: Math.max(pRect.y, scoreRect.y - 96), w, h })
    }

    const weakTop = await evaluate(`(() => {
      const card = [...document.querySelectorAll('.card')]
        .find(c => c.textContent.includes('这一场暴露的薄弱点'))
      if (!card) return null
      const r = card.getBoundingClientRect()
      return r.top + window.scrollY
    })()`)
    if (pRect && weakTop != null) {
      const w = Math.min(pRect.w, 720)
      const h = (w * 4) / 3
      await shotClip('03-复盘-短板.png', { x: pRect.x, y: weakTop - 24, w, h })
    }

    // 顺带把整页留一份，方便回头挑
    const full = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: VW, height: 2400, scale: 1 },
    })
    fs.writeFileSync(path.join(OUTDIR, '00-整页留档.png'), Buffer.from(full.data, 'base64'))

    const summary = await evaluate(`document.body.innerText.slice(0, 400)`)
    console.log('\n页面文字开头：\n' + summary)
    console.log('\n出图目录：' + path.resolve(OUTDIR))

    ws.close()
  } finally {
    try {
      child.kill()
    } catch {
      /* noop */
    }
  }
}

function waitTarget(port, timeoutMs) {
  const httpGet = (p) =>
    new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: p }, (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => resolve(d))
      })
      req.on('error', reject)
      req.setTimeout(2000, () => req.destroy(new Error('timeout')))
    })
  return (async () => {
    const t0 = Date.now()
    for (;;) {
      try {
        const list = JSON.parse(await httpGet('/json/list'))
        const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
        if (page) return page
      } catch {
        /* 端口未就绪 */
      }
      if (Date.now() - t0 > timeoutMs) throw new Error('CDP target 未就绪')
      await sleep(250)
    }
  })()
}

main().catch((e) => {
  console.error('[失败] ' + e.message)
  process.exitCode = 1
})
