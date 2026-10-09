/**
 * 视觉稿截图工具（真浏览器 + CDP）
 *
 * 为什么要它：`--dump-dom` 看不到样式，`--force-dark-mode` 又不改
 * prefers-color-scheme，没法验证深色模式。这里直接把主题和视口
 * 通过 CDP 打进去，再截图，得到的就是用户真正看到的画面。
 *
 * 用法：
 *   node scripts/shot.cjs --url http://127.0.0.1:8787/ --out a.png
 *   node scripts/shot.cjs --url .../admin --out b.png --theme dark
 *   node scripts/shot.cjs --url .../ --out c.png --size 1440x2400 --full
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

const URL_ = arg('url', 'http://127.0.0.1:8787/')
const OUT = arg('out', 'shot.png')
const THEME = arg('theme', 'light') // light | dark | auto
const SIZE = String(arg('size', '1440x1900'))
const FULL = Boolean(arg('full', false))
const CLICK = arg('click', null)
const CLICK_TEXT = arg('click-text', null)
const WAIT = Number(arg('wait', 2500))
const SCRIPT = arg('script', null)
const PORT = Number(arg('port', 9400 + Math.floor(Math.random() * 200)))

const [W, H] = SIZE.split('x').map(Number)

function httpGet(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve(d))
    })
    req.on('error', reject)
    req.setTimeout(2000, () => req.destroy(new Error('timeout')))
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitTarget(timeoutMs) {
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
}

async function main() {
  const exe = EDGE_CANDIDATES.find((p) => fs.existsSync(p))
  if (!exe) throw new Error('找不到 Edge / Chrome')

  const child = spawn(
    exe,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${path.join(process.env.TEMP || '/tmp', 'kewenguan-shot-' + PORT)}`,
      `--window-size=${W},${H}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  try {
    const target = await waitTarget(20000)
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
      width: W,
      height: H,
      deviceScaleFactor: 1,
      mobile: false,
    })

    // 首屏之前把主题写进去，避免截到闪白的那一帧
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try{localStorage.setItem('kewenguan.theme.v1',${JSON.stringify(THEME)})}catch(e){}`,
    })

    await send('Page.navigate', { url: URL_ })
    await sleep(1200)

    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
      })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval 异常')
      return r.result.value
    }
    const click = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.click()`)
    const capture = async () => {
      const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: FULL })
      fs.writeFileSync(OUT, Buffer.from(s.data, 'base64'))
    }

    if (SCRIPT) {
      // 用脚本驱动一串交互（比如走完一整场面试再截报告页）
      const fn = require(path.resolve(SCRIPT))
      await fn({ evaluate, click, sleep, capture, out: OUT, log: console.log })
    } else {
      if (CLICK_TEXT) {
        // 按可见文字找按钮更省事（很多按钮没有唯一类名）
        await evaluate(`(() => {
          const t = ${JSON.stringify(CLICK_TEXT)}
          const el = [...document.querySelectorAll('button,a')].find(e => e.textContent.trim() === t)
          el?.click()
          return !!el
        })()`)
        await sleep(WAIT)
      } else if (CLICK) {
        await click(CLICK)
        await sleep(WAIT)
      } else {
        await sleep(WAIT)
      }
    }

    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: FULL,
    })
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))

    const theme = await send('Runtime.evaluate', {
      expression: 'document.documentElement.dataset.theme',
      returnByValue: true,
    })
    console.log(`${path.basename(OUT)}  主题=${theme.result.value}  ${W}x${H}${FULL ? ' +fullpage' : ''}`)

    ws.close()
  } finally {
    try {
      child.kill()
    } catch {
      /* noop */
    }
  }
}

main().catch((e) => {
  console.error('[失败] ' + e.message)
  process.exitCode = 1
})
