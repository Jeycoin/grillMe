/**
 * 全局配置：模型供应商注册表 + 角色分工
 *
 * 设计原则：供应商不写死模型列表，启动/请求时实时拉取 /v1/models，
 * 这样供应商上新车我们不用改代码。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const ROOT = path.resolve(__dirname, '..')
export const DATA_DIR = path.join(ROOT, 'data')

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true })

const env = process.env

/**
 * 文本大模型供应商（OpenAI 兼容协议）
 */
export const PROVIDERS = {
  dashscope: {
    id: 'dashscope',
    label: '阿里百炼 · 通义',
    short: '通义',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: env.DASHSCOPE_API_KEY || '',
    consoleUrl: 'https://bailian.console.aliyun.com',
    // 实时语音走这个 host（不是 compatible-mode）
    realtimeWS: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
    supportsVoice: true,
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    short: 'DS',
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: env.DEEPSEEK_API_KEY || '',
    consoleUrl: 'https://platform.deepseek.com',
    supportsVoice: false,
  },
  hunyuan: {
    id: 'hunyuan',
    label: '腾讯混元',
    short: '混元',
    baseURL: 'https://api.hunyuan.cloud.tencent.com/v1',
    apiKey: env.HUNYUAN_API_KEY || '',
    consoleUrl: 'https://console.cloud.tencent.com/hunyuan',
    supportsVoice: false,
  },
  minimax: {
    id: 'minimax',
    label: 'MiniMax',
    short: 'MM',
    baseURL: 'https://api.minimaxi.com/v1',
    apiKey: env.MINIMAX_API_KEY || '',
    consoleUrl: 'https://platform.minimaxi.com',
    supportsVoice: false,
  },
}

/**
 * 角色默认模型 —— 可在前端切，这里是出厂设置
 *  brain    面试官主脑：决定问什么、怎么追问、怎么打分
 *  quick    快脑：实时场景下的轻量判断（是否该打断、要不要追问）
 *  asr      语音识别
 *  tts      语音合成（要能"讲语气"）
 */
export const ROLE_DEFAULTS = {
  brain: { provider: 'dashscope', model: 'qwen3.8-max' },
  quick: { provider: 'dashscope', model: 'qwen3.8-flash' },
  asr: { provider: 'dashscope', model: 'qwen3-asr-flash-realtime' },
  // qwen3-tts-flash 原生支持 instructions（自然语言描述语气）。
  // 旧名字 qwen3-tts-instruct-flash 已不存在，请求会 404，别再用。
  tts: { provider: 'dashscope', model: process.env.TTS_MODEL || 'qwen3-tts-flash' },
}

/** 拉取模型列表时要排除的非对话模型关键词 */
export const NON_CHAT_HINTS = [
  'embedding', 'rerank', 'image', 'vl-', 'ocr', 'tts', 'asr', 'audio',
  'speech', 'livetranslate', 'mt-', 'math', 'codeqwen', 'wan2', 'z-image',
  'flf', 'video', 'ocr', 'character', 'deep-research', 'deep-search',
  'sre-', 'test-', 'xiaomi-analysis', 'gui-plus',
]

export const SERVER = {
  port: Number(env.PORT || 8787),
  host: '127.0.0.1',
}

export function providerById(id) {
  return PROVIDERS[id] || null
}

/** 该供应商是否已配好 Key */
export function providerReady(id) {
  const p = PROVIDERS[id]
  return Boolean(p && p.apiKey)
}

/** 返回前端可安全展示的配置（不含 Key） */
export function publicConfig() {
  return {
    providers: Object.values(PROVIDERS).map((p) => ({
      id: p.id,
      label: p.label,
      short: p.short,
      ready: Boolean(p.apiKey),
      supportsVoice: p.supportsVoice,
      consoleUrl: p.consoleUrl,
    })),
    roleDefaults: ROLE_DEFAULTS,
  }
}
