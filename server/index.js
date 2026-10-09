/**
 * 服务入口
 */
import { startServer } from './app.js'

const server = await startServer()

process.on('SIGINT', () => {
  console.log('\n  再见。')
  server.close(() => process.exit(0))
})
process.on('uncaughtException', (err) => {
  console.error('[未捕获异常]', err)
})
