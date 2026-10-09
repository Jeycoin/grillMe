/**
 * 语音链路端到端验证（真浏览器 + 假麦克风）
 *
 * 用 Edge/Chrome 的 fake media device 顶替真实麦克风，
 * 通过 CDP 驱动真实页面，观察语音状态机的流转：
 *   面试官正在说 → （真正说完）→ 在听
 *
 * 重点验证：面试官"文本流结束 + 音频播完"之前绝不能开麦。
 *
 * 用法：node scripts/voice-e2e.js
 */
const http = require('http')
const { spawn } = require('child_process')
const WebSocket = require('ws')

const CDP_PORT = 9333
const APP_URL = 'http://127.0.0.1:8787/'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const USER_DIR = process.env.TEMP + '\\kewenguan-e2e'

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: CDP_PORT, path }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve(d))
    })
    req.on('error', reject)
    req.setTimeout(2000, () => req.destroy(new Error('timeout')))
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForTarget(timeoutMs) {
  const t0 = Date.now()
  for (;;) {
    try {
      const list = JSON.parse(await httpGet('/json/list'))
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* 端口还没起来 */
    }
    if (Date.now() - t0 > timeoutMs) throw new Error('CDP target 未就绪')
    await sleep(300)
  }
}

function client(ws) {
  let seq = 0
  const pending = new Map()
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++seq
        pending.set(id, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)))
        ws.send(JSON.stringify({ id, method, params }))
      })
    },
    close: () => ws.close(),
  }
}

let cdp
async function evaluate(expr) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval 异常')
  return r.result.value
}

/** 轮询直到表达式为真 */
async function until(expr, timeoutMs, label) {
  const t0 = Date.now()
  for (;;) {
    try {
      if (await evaluate(expr)) return true
    } catch {
      /* 页面可能还在导航 */
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`超时等待：${label}`)
    await sleep(300)
  }
}

const log = (s) => console.log(s)

async function main() {
  log('== 启动带假麦克风的 Edge ==')
  const child = spawn(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--window-size=1280,1000',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${USER_DIR}`,
      // 假麦克风：Chrome 会喂一段合成音频当输入
      '--use-fake-device-for-media-stream',
      // 自动同意麦克风授权，免去弹窗
      '--use-fake-ui-for-media-stream',
      // CDP 的 JS click 不算"可信手势"，所以关掉自动播放限制
      '--autoplay-policy=no-user-gesture-required',
      APP_URL,
    ],
    { stdio: 'ignore' },
  )

  try {
    const target = await waitForTarget(20000)
    log(`  target: ${target.url}`)

    const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
    await new Promise((res, rej) => {
      ws.on('open', res)
      ws.on('error', rej)
    })
    cdp = client(ws)
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')

    // 收集页面报错
    const pageErrors = []
    ws.on('message', (raw) => {
      const m = JSON.parse(raw)
      if (m.method === 'Runtime.exceptionThrown') {
        pageErrors.push(m.params?.exceptionDetails?.exception?.description || 'unknown')
      }
    })

    log('\n== 等配置页就绪 ==')
    await until(
      `!!document.querySelector('.btn-accent') && document.body.innerText.includes('开始面试')`,
      30000,
      '配置页渲染',
    )
    const hasVoiceCard = await evaluate(`document.body.innerText.includes('语音对话')`)
    const voiceTag = await evaluate(
      `(document.querySelector('.tag.tag-ok')||{}).textContent || ''`,
    )
    log(`  语音卡片存在: ${hasVoiceCard}`)
    log(`  状态标记: ${voiceTag.trim()}`)

    const voiceOn = await evaluate(
      `(() => { const cb = [...document.querySelectorAll('.card')].find(c => c.innerText.includes('语音对话')); return cb ? cb.querySelector('input[type=checkbox]').checked : null })()`,
    )
    log(`  语音开关默认值: ${voiceOn}`)

    log('\n== 点击「开始面试」 ==')
    await evaluate(`document.querySelector('.btn-accent').click()`)

    log('  等进入面试间…')
    await until(`!!document.querySelector('.voice-bar')`, 30000, '语音状态条出现')
    log('  语音状态条已出现')

    // 开场问题需要 LLM + 多次 TTS，给足时间
    log('\n== 采样语音状态流转（最多 90 秒）==')
    const timeline = []
    let last = ''
    const t0 = Date.now()
    let sawListening = false

    while (Date.now() - t0 < 90000) {
      const snap = await evaluate(`(() => {
        const bar = document.querySelector('.voice-bar')
        if (!bar) return null
        const mic = document.querySelector('.mic-btn')
        return {
          state: (bar.querySelector('.voice-state')||{}).textContent || '',
          cls: bar.className,
          pending: (bar.querySelector('.voice-pending')||{}).textContent || '',
          micBusy: mic ? mic.className : '',
        }
      })()`)

      if (snap && snap.state && snap.state !== last) {
        const sec = ((Date.now() - t0) / 1000).toFixed(1)
        timeline.push(`${sec}s  ${snap.cls.replace('voice-bar ', '')}  ${snap.state}${snap.pending ? '  [' + snap.pending + ']' : ''}`)
        log(`  ${timeline[timeline.length - 1]}`)
        last = snap.state
        if (snap.state.includes('在听')) {
          sawListening = true
          break
        }
      }
      await sleep(400)
    }

    // ---- 主动结束收音，验证 WAV 编码 + ASR 上传链路 ----
    let asrOk = false
    let recovered = false
    if (sawListening) {
      log('\n== 点麦克风结束收音 → 上传识别 ==')
      await sleep(1500) // 让假麦克风攒一点音频
      await evaluate(`document.querySelector('.mic-btn').click()`)

      const t1 = Date.now()
      let phase = ''
      while (Date.now() - t1 < 40000) {
        const s = await evaluate(`(() => {
          const bar = document.querySelector('.voice-bar')
          return {
            state: (bar.querySelector('.voice-state')||{}).textContent || '',
            toast: [...document.querySelectorAll('.toast,.toast-item,body *')]
              .map(e => e.textContent || '').find(t => t.includes('没听清')) || '',
          }
        })()`)
        if (s.state.includes('正在识别')) {
          if (phase !== 'asr') {
            phase = 'asr'
            log(`  ${((Date.now() - t1) / 1000).toFixed(1)}s  正在识别你的回答…（上传已发生）`)
          }
        } else if (phase === 'asr' && s.state.includes('在听')) {
          log(`  ${((Date.now() - t1) / 1000).toFixed(1)}s  回到「在听」→ 空识别后自动重开麦 ✓`)
          recovered = true
          break
        }
        await sleep(300)
      }
      asrOk = phase === 'asr'
    }

    log('\n== 结果 ==')
    const bubbles = await evaluate(`document.querySelectorAll('.bubble-q').length`)

    log(`  面试官气泡数: ${bubbles}`)
    log(`  状态流转: ${timeline.length ? '正常' : '无变化'}`)
    log(`  是否走到「在听」（自动开麦）: ${sawListening ? '是 ✓' : '否 ✗'}`)
    log(`  录音结束→ASR 上传: ${asrOk ? '是 ✓' : '否 ✗'}`)
    log(`  空识别后自动重开麦: ${recovered ? '是 ✓' : '否 ✗'}`)
    if (pageErrors.length) {
      log(`  页面异常 ${pageErrors.length} 条:`)
      pageErrors.slice(0, 5).forEach((e) => log('    ' + String(e).split('\n')[0]))
    } else {
      log('  页面异常: 无 ✓')
    }

    log('\n  完整时间线:')
    timeline.forEach((l) => log('    ' + l))

    // 可选：把"面试中"的画面存下来（--shot <路径>）
    const shotIdx = process.argv.indexOf('--shot')
    if (shotIdx > -1 && process.argv[shotIdx + 1]) {
      const fs = require('fs')
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(process.argv[shotIdx + 1], Buffer.from(r.data, 'base64'))
      log(`\n  截图已保存: ${process.argv[shotIdx + 1]}`)
    }

    ws.close()
    process.exitCode = sawListening ? 0 : 1
  } catch (e) {
    log(`\n[失败] ${e.message}`)
    process.exitCode = 1
  } finally {
    try {
      child.kill()
    } catch {
      /* noop */
    }
  }
}

main()
