/**
 * 播放队列：面试官说的话按句排队播，支持随时打断（barge-in）
 *
 * 为什么要队列而不是来一句播一句：
 * 面试官的回复是流式生成的，我们按句子切分后逐句合成。
 * 合成速度和解说速度不一致，必须排队，否则两句会叠在一起。
 */

export interface QueueOptions {
  /** 开始播放某一句 */
  onStart?: (index: number, total: number) => void
  /** 整个队列播完 */
  onIdle?: () => void
  /** 播报状态变化（true=正在说话） */
  onSpeakingChange?: (speaking: boolean) => void
  /** 音量 0~1 */
  volume?: number
}

type Item = {
  blob: Blob
  url: string
}

export class AudioQueue {
  private items: Item[] = []
  private playing: HTMLAudioElement | null = null
  private currentUrl: string | null = null
  private stopped = false
  private speaking = false
  private played = 0

  constructor(private opts: QueueOptions = {}) {}

  /** 队列里还有几句没播 */
  get pending() {
    return this.items.length
  }

  get isSpeaking() {
    return this.speaking
  }

  /** 入队一段音频 */
  enqueue(blob: Blob) {
    if (this.stopped) return
    const url = URL.createObjectURL(blob)
    this.items.push({ blob, url })
    if (!this.playing) this.next()
  }

  private next() {
    if (this.stopped) return
    const item = this.items.shift()
    if (!item) {
      this.setSpeaking(false)
      this.opts.onIdle?.()
      return
    }

    const audio = new Audio(item.url)
    audio.volume = this.opts.volume ?? 1
    this.playing = audio
    this.currentUrl = item.url
    this.setSpeaking(true)

    const total = this.played + this.items.length + 1
    this.opts.onStart?.(this.played, total)

    const done = () => {
      URL.revokeObjectURL(item.url)
      if (this.currentUrl === item.url) this.currentUrl = null
      this.playing = null
      this.played++
      this.next()
    }
    audio.onended = done
    audio.onerror = done

    audio.play().catch(() => {
      // 自动播放被拦（用户还没交互过），直接跳过这句，避免整个队列卡死
      done()
    })
  }

  private setSpeaking(v: boolean) {
    if (this.speaking === v) return
    this.speaking = v
    this.opts.onSpeakingChange?.(v)
  }

  /**
   * 立刻中断当前播放并清空队列。
   * barge-in（用户打断面试官）就是调这个。
   *
   * 注意：这里**不触发 onIdle** —— 打断不是"说完了"，
   * 如果触发会让自动开麦逻辑误以为该轮到用户了。
   */
  stop() {
    if (this.playing) {
      try {
        this.playing.pause()
      } catch {
        /* noop */
      }
      this.playing = null
    }
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl)
      this.currentUrl = null
    }
    for (const it of this.items) URL.revokeObjectURL(it.url)
    this.items = []
    this.setSpeaking(false)
  }

  /** 彻底销毁 */
  dispose() {
    this.stopped = true
    this.stop()
  }

  /** 重新启用（下一轮对话前调用） */
  revive() {
    this.stopped = false
  }
}
