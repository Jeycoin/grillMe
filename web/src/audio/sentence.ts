/**
 * 流式断句器
 *
 * 面试官的回复是流式吐字的。如果等整段生成完再合成语音，
 * 用户要盯着屏幕干等好几秒。
 * 这里做的是：一边收字，一边在句子边界就切出来送去合成，
 * 让面试官"说到第一句的时候，第二句还在生成"。
 */
const HARD_STOP = /[。！？；!?;…]/u
const SOFT_STOP = /[，,、：:]/u

export class SentenceSplitter {
  private buf = ''
  private emitted: string[] = []

  constructor(
    /** 短于这个长度不切（避免"嗯。"这种碎片单独合成） */
    private minLen = 6,
    /** 一直没标点时，超过这个长度强制切 */
    private maxLen = 42,
  ) {}

  /**
   * 喂入一段增量文本，返回这次可以送去合成的完整句子（可能为空数组）
   */
  push(delta: string): string[] {
    this.buf += delta
    const out: string[] = []

    for (;;) {
      const idx = this.findCut()
      if (idx < 0) break
      const seg = this.buf.slice(0, idx + 1).trim()
      this.buf = this.buf.slice(idx + 1)
      if (seg) out.push(seg)
    }

    // 太长了还没标点，硬切
    if (this.buf.length >= this.maxLen) {
      const cut = this.findSoftCut() ?? this.maxLen
      const seg = this.buf.slice(0, cut).trim()
      this.buf = this.buf.slice(cut)
      if (seg) out.push(seg)
    }

    this.emitted.push(...out)
    return out
  }

  /** 找到第一个满足条件的硬断句位置，没有则 -1 */
  private findCut(): number {
    let best = -1
    for (let i = 0; i < this.buf.length; i++) {
      if (HARD_STOP.test(this.buf[i])) {
        // 断句点前的片段要够长，或者后面确实还有内容
        if (i + 1 >= this.minLen || this.buf.length > i + 1) {
          best = i
          break
        }
      }
    }
    return best
  }

  /** 在软标点处找一个较靠后的切点 */
  private findSoftCut(): number | null {
    for (let i = this.buf.length - 1; i >= Math.floor(this.buf.length / 2); i--) {
      if (SOFT_STOP.test(this.buf[i])) return i + 1
    }
    return null
  }

  /** 收尾：把残留的吐出来 */
  flush(): string | null {
    const rest = this.buf.trim()
    this.buf = ''
    if (!rest) return null
    this.emitted.push(rest)
    return rest
  }

  /** 本轮总共切出了几句 */
  get count() {
    return this.emitted.length
  }

  reset() {
    this.buf = ''
    this.emitted = []
  }
}
