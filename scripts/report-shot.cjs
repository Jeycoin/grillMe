/**
 * 走完一整场面试，用于给「报告页」截图。
 * 配合 shot.cjs --script 使用：
 *   node scripts/shot.cjs --url http://127.0.0.1:8787/ --theme light \
 *     --size 1440x2600 --full --script scripts/report-shot.cjs --out report.png
 *
 * 关键点：React 的受控输入不能直接改 .value，
 * 必须用原生 setter 再派发 input 事件，否则 state 不会更新、按钮一直是禁用的。
 */
const ANSWERS = [
  '我目前是后端开发，主要做交易系统的订单链路。最近一年在负责把订单查询从单体拆成独立服务，QPS 从 800 提到了 3000，P99 从 120ms 降到 35ms。做法是加了一层本地缓存，热点商品走缓存，冷数据回源，同时把原来的同步扣减改成了异步化。',
  '缓存一致性上我用的是先更新数据库再删缓存，删除失败会投递到消息队列重试。为什么不用延迟双删，是因为我们的写比例很低，冲突窗口很小，双删带来的额外延迟不划算。不过这里确实有个问题，如果删除缓存一直失败、消息也积压了，会读到脏数据，我们目前是靠监控告警人工介入，这块我承认没做到自动收敛。',
  '压测用的是 JMeter，单机 500 并发，跑 30 分钟。QPS 那个数字是在缓存命中率 92% 的前提下测出来的，如果缓存全穿透，回源大概只能扛 1200 左右。P99 是取了线上真实流量一天的统计，不是压测值，这点我说得不够严谨。',
]

module.exports = async ({ evaluate, click, sleep, capture, log }) => {
  const setDraft = async (text) => {
    await evaluate(`(() => {
      const ta = document.querySelector('.composer textarea')
      if (!ta) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, ${JSON.stringify(text)})
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
  }

  const waitFor = async (expr, timeoutMs, label) => {
    const t0 = Date.now()
    for (;;) {
      if (await evaluate(expr)) return true
      if (Date.now() - t0 > timeoutMs) throw new Error('超时等待：' + label)
      await sleep(600)
    }
  }

  log('  点击「开始面试」')
  await click('.btn-accent')
  await waitFor(`!!document.querySelector('.voice-bar')`, 20000, '面试页')

  for (let i = 0; i < ANSWERS.length; i++) {
    // 等面试官说完（语音条回到"待机/在听"，且没有待播）
    await sleep(6000)
    // textarea 的 disabled === busy，"解禁"就代表面试官这一轮生成完了。
    // 注意别去看「作答」按钮的 disabled —— 草稿为空时它一直是禁用的。
    await waitFor(
      `(() => {
         const ta = document.querySelector('.composer textarea')
         return ta && !ta.disabled
       })()`,
      120000,
      `第 ${i + 1} 轮就绪`,
    )
    await setDraft(ANSWERS[i])
    await sleep(400)
    await evaluate(`document.querySelector('.composer-actions .btn-accent').click()`)
    log(`  已提交第 ${i + 1} 轮作答`)
    // 等这一轮受理（textarea 重新被禁用）
    await waitFor(`document.querySelector('.composer textarea').disabled`, 20000, '提交受理')
  }

  log('  等最后一段说完…')
  await sleep(12000)

  log('  点击「结束并评分」')
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.composer-actions button')]
      .find(b => b.textContent.includes('结束并评分'))
    btn?.click()
  })()`)

  await waitFor(`document.body.innerText.includes('面试报告') || !!document.querySelector('.score-hero')`, 120000, '报告页')
  await sleep(1500)
  await capture()
  log('  报告页已截图')
}
