/**
 * 录音器：麦克风 → 16kHz 单声道 PCM → WAV Blob
 *
 * 为什么自己编码 WAV 而不用 MediaRecorder：
 * MediaRecorder 给的是 webm/opus，ASR 接口对它支持不稳；
 * 而 WAV 是所有语音接口的"普通话"，自己编码 30 行就够，省掉格式焦虑。
 *
 * 采样率降到 16k：语音模型都是按 16k 训的，而且能把上传体积压掉 2/3。
 * 降采样用的是盒式平均（相当于一个粗糙的低通），对语音足够。
 */

const TARGET_RATE = 16000

/** AudioWorklet 的源码。用 Blob URL 注入，避免打包路径问题（dev / file:// 都能用） */
const WORKLET_SRC = `
class PCMCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch && ch.length) this.port.postMessage(new Float32Array(ch))
    return true
  }
}
registerProcessor('pcm-capture', PCMCapture)
`

/**
 * 共享的 AudioContext。
 *
 * 浏览器的自动播放策略要求音频上下文由**用户手势**唤起，
 * 但我们的开麦是"面试官说完话"之后自动触发的 —— 那不是手势。
 * 所以在用户点"开始面试"时就先把上下文建好、唤醒，
 * 之后录音器复用它，就不会出现"麦克风开了但一点声音都收不到"。
 */
let sharedCtx: AudioContext | null = null

function audioCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  return window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext || null
}

/** 在用户手势里调用，唤醒音频子系统 */
export async function unlockAudio(): Promise<void> {
  const AC = audioCtor()
  if (!AC) return
  try {
    if (!sharedCtx || sharedCtx.state === 'closed') sharedCtx = new AC()
    if (sharedCtx.state === 'suspended') await sharedCtx.resume()
  } catch {
    /* 拿不到就算了，录音时会再试一次 */
  }
}

function getSharedContext(): AudioContext | null {
  return sharedCtx && sharedCtx.state !== 'closed' ? sharedCtx : null
}

/** 盒式平均降采样 */
function downsample(input: Float32Array, fromRate: number, toRate: number = TARGET_RATE): Float32Array {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const outLen = Math.floor(input.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    out[i] = sum / Math.max(1, end - start)
  }
  return out
}

/** Float32 [-1,1] → 16bit PCM WAV */
export function encodeWav(samples: Float32Array, sampleRate: number = TARGET_RATE): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buf)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM 头长度
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // 单声道
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // 字节率
  view.setUint16(32, 2, true) // 块对齐
  view.setUint16(34, 16, true) // 位深
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let off = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    off += 2
  }
  return new Blob([buf], { type: 'audio/wav' })
}

/** 合并多个 Float32Array */
function concat(chunks: Float32Array[], totalLen: number): Float32Array {
  const out = new Float32Array(totalLen)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

export interface RecorderOptions {
  /** 实时音量（0~1），用于画波形/判断说话 */
  onLevel?: (level: number) => void
  /** 检测到说完话（静音超时）后自动回调 */
  onAutoStop?: (wav: Blob, seconds: number) => void
  /** 判定为"开始说话"的音量阈值 */
  threshold?: number
  /** 说完后静音多久算结束（毫秒） */
  silenceMs?: number
  /** 最长录制时间，兜底防呆 */
  maxMs?: number
}

export class VoiceRecorder {
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  /** 上下文是自己建的（而不是复用的），销毁时才需要 close */
  private ownCtx = false
  private node: AudioWorkletNode | ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private chunks: Float32Array[] = []
  private frames = 0
  private timer: number | null = null
  private startedAt = 0
  private silenceSince = 0
  private hasSpeech = false
  private stopped = false

  /** 当前实时音量，外部可以读来做 barge-in 判断 */
  level = 0

  constructor(private opts: RecorderOptions = {}) {}

  static get supported() {
    return (
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof window !== 'undefined' &&
      Boolean(window.AudioContext || (window as any).webkitAudioContext)
    )
  }

  async start() {
    if (!VoiceRecorder.supported) throw new Error('当前浏览器不支持麦克风采集')
    this.reset()

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true, // 关键：否则面试官的声音会被录进来
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    })

    // 优先复用被手势预热过的上下文
    const shared = getSharedContext()
    if (shared) {
      this.ctx = shared
      this.ownCtx = false
    } else {
      const AC = audioCtor()
      if (!AC) throw new Error('当前浏览器不支持 Web Audio')
      this.ctx = new AC()
      this.ownCtx = true
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume()

    this.source = this.ctx.createMediaStreamSource(this.stream)

    const useWorklet = this.ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined'
    if (useWorklet) {
      try {
        const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }))
        await this.ctx.audioWorklet.addModule(url)
        URL.revokeObjectURL(url)
        const node = new AudioWorkletNode(this.ctx, 'pcm-capture')
        node.port.onmessage = (e) => this.push(e.data as Float32Array)
        this.node = node
      } catch {
        this.node = null
      }
    }

    // 降级：ScriptProcessorNode（已废弃但到处都能跑）
    let isScriptProcessor = false
    if (!this.node) {
      const node = this.ctx.createScriptProcessor(4096, 1, 1)
      node.onaudioprocess = (e) => this.push(new Float32Array(e.inputBuffer.getChannelData(0)))
      this.node = node
      isScriptProcessor = true
    }

    this.source.connect(this.node)
    // ScriptProcessor 需要连到 destination 才会触发
    if (isScriptProcessor) this.node.connect(this.ctx.destination)

    this.startedAt = Date.now()
    this.timer = window.setInterval(() => this.tick(), 80)
  }

  private push(chunk: Float32Array) {
    if (this.stopped) return
    this.chunks.push(chunk)
    this.frames += chunk.length
  }

  private tick() {
    if (!this.ctx) return
    const elapsed = Date.now() - this.startedAt
    const th = this.opts.threshold ?? 0.012

    // 算最近一小段的音量
    const last = this.chunks[this.chunks.length - 1]
    let level = 0
    if (last) {
      let sum = 0
      for (let i = 0; i < last.length; i++) sum += last[i] * last[i]
      level = Math.sqrt(sum / last.length)
    }
    this.level = level
    this.opts.onLevel?.(level)

    if (level > th) {
      this.hasSpeech = true
      this.silenceSince = 0
    } else if (this.hasSpeech) {
      if (!this.silenceSince) this.silenceSince = Date.now()
      const silence = Date.now() - this.silenceSince
      if (silence >= (this.opts.silenceMs ?? 1300)) {
        this.stopInternal(true)
        return
      }
    }

    if (elapsed >= (this.opts.maxMs ?? 120000)) this.stopInternal(true)
  }

  /** 主动结束，返回 WAV */
  async stop(): Promise<{ wav: Blob; seconds: number } | null> {
    return this.stopInternal(false)
  }

  private async stopInternal(auto: boolean): Promise<{ wav: Blob; seconds: number } | null> {
    if (this.stopped) return null
    this.stopped = true

    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    const rate = this.ctx?.sampleRate || 48000

    try {
      this.node?.disconnect()
      this.source?.disconnect()
      // 共享上下文是给下一次录音复用的，不能关掉
      if (this.ownCtx) this.ctx?.close()
      this.stream?.getTracks().forEach((t) => t.stop())
    } catch {
      /* 忽略清理异常 */
    }
    this.ctx = null
    this.node = null
    this.source = null
    this.stream = null
    const all = concat(this.chunks, this.frames)
    const down = downsample(all, rate, TARGET_RATE)
    const seconds = down.length / TARGET_RATE

    if (!down.length) return null
    const wav = encodeWav(down)
    if (auto) this.opts.onAutoStop?.(wav, seconds)
    return { wav, seconds }
  }

  private reset() {
    this.chunks = []
    this.frames = 0
    this.stopped = false
    this.hasSpeech = false
    this.silenceSince = 0
    this.level = 0
  }
}
