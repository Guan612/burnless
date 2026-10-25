/**
 * W7 音效：WebAudio 程序化合成，零外部音频资源——决策 #10「素材代码化」的音效版：
 * 不引 CC0 音频包、无下载无版权负担，色板换成音色表，仓库自包含。
 * 底层两个原语 tone（单音）/ noise（噪声）；其上是 MIDI 式音序器 seq：
 * 音名写谱（'C5:0.5 E5'、'C5+E5+G5' 和弦、'.' 休止），bpm 定拍长——
 * 旋律/号角/小调用它谱，免引 .mid 文件与软波表。
 * 浏览器自动播放策略：AudioContext 需一次用户手势才出声，全局 pointerdown/keydown 解锁。
 * 静音状态持久化 localStorage；引擎单例，useMatchRoom / 界面直接调 play()。
 */

export type SfxName =
  | 'join' // 有摊主入座
  | 'coin' // 卖出一串
  | 'restock_open' // 进货车到
  | 'restock_done' // 进货完成（收银机）
  | 'restock_skipped' // 错过进货
  | 'surge' // 美食节人潮
  | 'inspection_pass' // 抽检合格
  | 'inspection_fine' // 罚款警报
  | 'bad_review' // 差评
  | 'loyal_return' // 回头客
  | 'stock_out' // 断货
  | 'self_verified' // 自证清白
  | 'report_hit' // 举报命中
  | 'report_clean' // 举报落空
  | 'smear_done' // 刷差评得手
  | 'smear_caught' // 被抓现行
  | 'ended' // 打烊结算
  | 'match_start' // 开市号角
  | 'victory' // 结算凯歌（街区红人 / 不烧心大师）
  | 'defeat' // 结算灰调（大排档学徒）
  | 'ui_confirm' // 按钮确认
  | 'ui_tick' // 滑杆细响
  | 'toggle' // 静音开关反馈

const MUTE_KEY = 'burnless.muted'
const MASTER_GAIN = 0.55

// ---------- MIDI 式音序器基础：音名 → 频率 ----------
// 十二平均律，A4=440Hz（MIDI 69）；'C4' 为中央 C，'#' 升半音
const NOTE_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function noteFreq(name: string): number {
  const m = /^([A-G])(#?)(\d)$/.exec(name)
  if (!m) return 440
  const midi = (Number(m[3]) + 1) * 12 + (NOTE_SEMITONE[m[1]!] ?? 0) + (m[2] ? 1 : 0)
  return 440 * 2 ** ((midi - 69) / 12)
}

type ToneOpts = {
  f0: number
  f1?: number
  dur: number
  /** 相对当前时刻的起始偏移（秒） */
  at?: number
  type?: OscillatorType
  vol?: number
  /** 保持段占时长的比例（0=立即衰减如拨弦，0.6+ = 长音如号角） */
  hold?: number
}

type NoiseOpts = {
  dur: number
  at?: number
  vol?: number
  /** 带通中心频率 */
  f?: number
}

type TrackOpts = {
  /** 音符串：空格分隔 token；'C5'=一拍，'C5:0.5'=半拍，'C5+E5+G5'=和弦，'.'=休止 */
  notes: string
  bpm: number
  /** 整轨起始偏移（秒） */
  at?: number
  type?: OscillatorType
  vol?: number
  /** 音符实际发声占比（<1 有断奏颗粒感，长和弦垫底用 1） */
  gate?: number
}

class SfxEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private muted = typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1'

  constructor() {
    const unlock = () => {
      this.ctx?.resume().catch(() => {})
    }
    // capture：任何 UI 自己的 handler 之前先解锁音频
    window.addEventListener('pointerdown', unlock, { capture: true })
    window.addEventListener('keydown', unlock, { capture: true })
  }

  get isMuted(): boolean {
    return this.muted
  }

  toggle(): boolean {
    this.muted = !this.muted
    localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0')
    if (!this.muted) this.play('toggle')
    return this.muted
  }

  play(name: SfxName): void {
    if (this.muted) return
    const ctx = this.ensureCtx()
    if (!ctx) return
    // 未解锁（无手势）时静默放弃：不积压不告警；手势一到自然恢复
    if (ctx.state !== 'running') {
      ctx.resume().catch(() => {})
      return
    }
    this.recipe(name, ctx)
  }

  private ensureCtx(): AudioContext | null {
    if (this.ctx) return this.ctx
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    this.ctx = new Ctor()
    this.master = this.ctx.createGain()
    this.master.gain.value = MASTER_GAIN
    this.master.connect(this.ctx.destination)
    return this.ctx
  }

  private tone(ctx: AudioContext, o: ToneOpts): void {
    const t0 = ctx.currentTime + (o.at ?? 0)
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = o.type ?? 'square'
    osc.frequency.setValueAtTime(Math.max(1, o.f0), t0)
    if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + o.dur)
    gain.gain.setValueAtTime(o.vol ?? 0.05, t0)
    if (o.hold) gain.gain.setValueAtTime(o.vol ?? 0.05, t0 + o.dur * o.hold)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + o.dur)
    osc.connect(gain)
    gain.connect(this.master!)
    osc.start(t0)
    osc.stop(t0 + o.dur + 0.03)
  }

  private noise(ctx: AudioContext, o: NoiseOpts): void {
    const t0 = ctx.currentTime + (o.at ?? 0)
    const len = Math.ceil(ctx.sampleRate * o.dur)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buf
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = o.f ?? 2000
    filter.Q.value = 0.8
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(o.vol ?? 0.06, t0)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + o.dur)
    src.connect(filter)
    filter.connect(gain)
    gain.connect(this.master!)
    src.start(t0)
    src.stop(t0 + o.dur + 0.03)
  }

  /** MIDI 式音序器：按 bpm 把音符串排到时间轴上，每个 token 一拍（可 ':beats' 改拍数） */
  private seq(ctx: AudioContext, t: TrackOpts): void {
    const spb = 60 / t.bpm
    let cursor = 0
    for (const token of t.notes.trim().split(/\s+/)) {
      const [head, beatsStr] = token.split(':')
      const dur = (beatsStr ? Number(beatsStr) : 1) * spb
      if (head && head !== '.') {
        const at = (t.at ?? 0) + cursor
        for (const n of head.split('+')) {
          this.tone(ctx, {
            f0: noteFreq(n),
            dur: dur * (t.gate ?? 0.9),
            at,
            type: t.type,
            vol: t.vol,
            // gate=1 是长音/和弦垫：保持到 92% 再放，默认断奏则保持拨弦式衰减
            hold: t.gate === 1 ? 0.92 : undefined,
          })
        }
      }
      cursor += dur
    }
  }

  /** 音色表：与街景色板同思路，参数即素材 */
  private recipe(name: SfxName, ctx: AudioContext): void {
    switch (name) {
      case 'coin': {
        // 金币双音，带随机微移防单调
        const p = 0.94 + Math.random() * 0.12
        this.tone(ctx, { f0: 988 * p, dur: 0.07, vol: 0.045 })
        this.tone(ctx, { f0: 1319 * p, dur: 0.16, at: 0.07, vol: 0.045 })
        break
      }
      case 'join':
        this.tone(ctx, { f0: 523, f1: 784, dur: 0.12, type: 'triangle' })
        break
      case 'restock_open':
        // 两声低鸣：进货车喇叭
        this.tone(ctx, { f0: 330, dur: 0.12, vol: 0.06 })
        this.tone(ctx, { f0: 262, dur: 0.18, at: 0.14, vol: 0.06 })
        break
      case 'restock_done':
        // 收银机：咔哒 + 金币
        this.noise(ctx, { dur: 0.05, vol: 0.08, f: 3500 })
        this.tone(ctx, { f0: 988, dur: 0.06, at: 0.06, vol: 0.045 })
        this.tone(ctx, { f0: 1319, dur: 0.14, at: 0.12, vol: 0.045 })
        break
      case 'restock_skipped':
        this.tone(ctx, { f0: 392, f1: 196, dur: 0.3, type: 'triangle' })
        break
      case 'surge':
        // 上行琶音：人来疯了
        for (const [i, f] of [523, 659, 784, 1047].entries()) {
          this.tone(ctx, { f0: f, dur: 0.1, at: i * 0.07, vol: 0.04, type: 'triangle' })
        }
        break
      case 'inspection_pass':
        this.tone(ctx, { f0: 1047, dur: 0.25, type: 'sine' })
        this.tone(ctx, { f0: 2093, dur: 0.2, at: 0.02, vol: 0.018, type: 'sine' })
        break
      case 'inspection_fine':
        // 三组交替双音：警报
        for (let i = 0; i < 3; i++) {
          this.tone(ctx, { f0: 740, dur: 0.09, at: i * 0.2, vol: 0.065, type: 'sawtooth' })
          this.tone(ctx, { f0: 554, dur: 0.09, at: i * 0.2 + 0.1, vol: 0.065, type: 'sawtooth' })
        }
        break
      case 'bad_review':
        this.tone(ctx, { f0: 220, f1: 110, dur: 0.28, vol: 0.055 })
        break
      case 'loyal_return':
        this.tone(ctx, { f0: 659, f1: 880, dur: 0.15, vol: 0.04, type: 'sine' })
        break
      case 'stock_out':
        this.tone(ctx, { f0: 330, f1: 165, dur: 0.35, type: 'triangle' })
        break
      case 'self_verified':
        this.tone(ctx, { f0: 294, f1: 880, dur: 0.3, type: 'sine' })
        break
      case 'report_hit':
        this.noise(ctx, { dur: 0.12, vol: 0.085, f: 1200 })
        this.tone(ctx, { f0: 660, f1: 440, dur: 0.35, at: 0.05, vol: 0.065, type: 'sawtooth' })
        break
      case 'report_clean':
        this.tone(ctx, { f0: 392, f1: 330, dur: 0.22, type: 'triangle' })
        break
      case 'smear_done':
        // 鬼祟三连低音
        for (let i = 0; i < 3; i++) this.tone(ctx, { f0: 196, dur: 0.05, at: i * 0.08 })
        this.tone(ctx, { f0: 247, dur: 0.1, at: 0.26 })
        break
      case 'smear_caught':
        this.tone(ctx, { f0: 110, f1: 82, dur: 0.4, vol: 0.075, type: 'sawtooth' })
        this.noise(ctx, { dur: 0.2, at: 0.05, vol: 0.065, f: 800 })
        break
      case 'ended':
        // 打烊小调
        for (const [i, f] of [523, 659, 784, 1047].entries()) {
          this.tone(ctx, { f0: f, dur: 0.22, at: i * 0.16, vol: 0.045, type: 'triangle' })
        }
        break
      case 'match_start': {
        // 开市号角：号手四音上行 + 低八度垫底 + 主和弦收束（约 1.6s）
        this.seq(ctx, { bpm: 152, notes: 'C5:0.5 E5:0.5 G5:0.5 C6:2', type: 'square', vol: 0.04 })
        this.seq(ctx, { bpm: 152, notes: 'C3:1.5 G3:0.5 C4:2', type: 'triangle', vol: 0.05 })
        this.seq(ctx, { bpm: 152, notes: '.:2.5 E5+G5+C6:1.25', type: 'sine', vol: 0.018, gate: 1 })
        break
      }
      case 'victory': {
        // 结算凯歌：等「打烊小调」落定（~1s）后接上行回答句，收在 G6
        this.seq(ctx, { bpm: 160, notes: 'E5:0.5 G5:0.5 C6:0.5 E6:0.5 G6:1.5', type: 'square', vol: 0.038, at: 1.05 })
        this.seq(ctx, { bpm: 160, notes: 'C4+E4+G4+C5:3', type: 'sine', vol: 0.018, gate: 1, at: 1.05 })
        break
      }
      case 'defeat': {
        // 结算灰调：小调下行回答句 + A2 低音垫，同样错开打烊音
        this.seq(ctx, { bpm: 120, notes: 'E5:0.5 C5:0.5 A4:0.5 E4:2', type: 'triangle', vol: 0.042, at: 1.05 })
        this.seq(ctx, { bpm: 120, notes: 'A2:3', type: 'sawtooth', vol: 0.026, gate: 1, at: 1.05 })
        break
      }
      case 'ui_confirm':
        // 纯五度上行双音：按钮落定（与金币的银亮双音区分，走三角波更钝）
        this.seq(ctx, { bpm: 150, notes: 'G5:0.5 D6:0.75', type: 'triangle', vol: 0.04 })
        break
      case 'ui_tick':
        // 滑杆细响：随机微移防连续拖动时的机关枪感
        this.tone(ctx, { f0: 1150 + Math.random() * 200, dur: 0.045, vol: 0.02, type: 'sine' })
        break
      case 'toggle':
        this.tone(ctx, { f0: 660, dur: 0.05, vol: 0.035 })
        break
    }
  }
}

export const sfx = new SfxEngine()

/** SimEvent.kind → 音效：现有事件与音色一一对应，直接按名派发 */
export function playEventSound(kind: string): void {
  sfx.play(kind as SfxName)
}
