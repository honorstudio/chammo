// 패드 소리(넷째 조각) — 마이크 받기와 소리 틀기. 소리는 아이가 화면을 누른 그 순간에 열어야 난다(iPad PWA) → 첫 톡에 unlock.
// 미리 만든 말 20개(맥 kids_voice PHRASES 순서)는 처음에 다 받아 두어 0초에 튼다. 답 조각은 받은 차례대로 이어 튼다.
import { downsample, rms, wavBytes } from '../../domain/kidsTurn';

/** 미리 만든 말 번호(1부터) — 맥 kids_voice::PHRASES 와 같은 순서 */
export const PRE = { umm: 1, gotIt: 2, good: 3, making: 4, again: 8, today: 14, night: 15, tapToTalk: 19 } as const;
/** 추임새 21~25("응~"·"음음"·"그래서?"·"응응"·"그다음엔?") — 이어 갈 것 같은 쉼에 한 번, 대답·기록 아님 */
export const FILLERS = [21, 22, 23, 24, 25] as const;
export const PRE_COUNT = 25;
/** 다음 추임새 — 같은 말 연속 금지 */
export function nextFiller(last: number | null, rnd = Math.random): number {
  const pool = FILLERS.filter((i) => i !== last);
  return pool[Math.floor(rnd() * pool.length) % pool.length]!;
}

type Ctx = AudioContext;
const newCtx = (): Ctx => new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

export class Sound {
  ctx: Ctx | null = null;
  private pre: (AudioBuffer | null)[] = [];
  private queue: AudioBuffer[] = [];
  private playing: AudioBufferSourceNode | null = null;
  /** 줄이 다 비면 */
  onIdle: (() => void) | null = null;

  /** 누른 그 순간에 부른다 — 소리 길을 연다 */
  unlock(): Ctx {
    if (!this.ctx) this.ctx = newCtx();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** 미리 만든 말 받아 두기 — 못 받은 건 건너뛰고(그 말만 안 난다) 조금 뒤 못 받은 것만 다시 받는다.
   *  처음 쓰는 맥은 아직 만드는 중이라 404(not ready) — 맥은 기다리지 않고 뒤에서 만든다(11-18 진짜 아이패드) */
  async loadPre(get: (i: number) => Promise<ArrayBuffer>, n = PRE_COUNT, { tries = 24, gapMs = 5000 }: { tries?: number; gapMs?: number } = {}) {
    const ctx = this.ctx ?? (this.ctx = newCtx());
    this.pre = Array.from({ length: n }, () => null);
    const fetchMissing = () => Promise.all(this.pre.map((b, i) => (b ? null : get(i + 1).then((x) => ctx.decodeAudioData(x)).then((x) => { this.pre[i] = x; }, () => undefined))));
    await fetchMissing();
    for (let t = 0; t < tries && this.pre.some((b) => !b); t++) {
      await new Promise((r) => setTimeout(r, gapMs));
      await fetchMissing();
    }
  }
  hasPre(i: number) {
    return !!this.pre[i - 1];
  }

  /** 내가 내는 소리(추임새 빼고)가 끝나는 때(벽시계 ms) — 그동안과 끝난 직후엔 말 감지를 끈다(시작 소리·답을 아이 말로 잡지 않게, 11-18).
   *  소리 시계(ctx.currentTime)는 소리 길이 멈추면 안 가서(헤드리스·백그라운드) 영영 '소리 내는 중'이 된다 — 벽시계로 */
  private until = 0;
  private start(buf: AudioBuffer, then?: () => void, mute = true) {
    const ctx = this.unlock();
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.connect(ctx.destination);
    s.onended = () => then?.();
    s.start();
    if (mute) this.until = Math.max(this.until, performance.now() + (buf.duration ?? 0) * 1000);
    return s;
  }
  /** 소리를 내는 중이거나 끝난 지 extraSec 안인가 */
  sounding(extraSec: number) {
    return this.busy || performance.now() < this.until + extraSec * 1000;
  }

  /** 미리 만든 말 — 줄과 상관없이 바로(0초 반응) */
  playPre(i: number) {
    const b = this.pre[i - 1];
    if (b) this.start(b);
    return !!b;
  }

  /** 추임새 — 아이가 다시 말하면 바로 멈출 수 있게 쥐고 있는다 */
  private filler: AudioBufferSourceNode | null = null;
  playFiller(i: number) {
    const b = this.pre[i - 1];
    if (!b) return false;
    this.stopFiller();
    this.filler = this.start(b, () => { this.filler = null; }, false); // 추임새는 아이 말에 바로 멈춰야 해서 감지를 안 끈다
    return true;
  }
  stopFiller() {
    try { this.filler?.stop(); } catch { /* 이미 끝 */ }
    this.filler = null;
  }

  /** 시작(오르는 두 음)·끝(내리는 두 음) 소리 — 파일 없이 만든다 */
  chime(up: boolean) {
    const ctx = this.unlock();
    const t = ctx.currentTime;
    this.until = Math.max(this.until, performance.now() + 300);
    (up ? [660, 880] : [880, 660]).forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      g.gain.setValueAtTime(0, t + i * 0.09);
      g.gain.linearRampToValueAtTime(0.18, t + i * 0.09 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.18);
    });
  }

  /** 답 조각을 줄에 — 앞 조각이 끝나면 다음 */
  async enqueue(wav: ArrayBuffer) {
    const ctx = this.unlock();
    this.queue.push(await ctx.decodeAudioData(wav));
    if (!this.playing) this.next();
  }
  private next() {
    const b = this.queue.shift();
    if (!b) { this.playing = null; this.onIdle?.(); return; }
    this.playing = this.start(b, () => this.next());
  }
  get busy() {
    return !!this.playing || this.queue.length > 0;
  }
  stopAll() {
    this.queue = [];
    try { this.playing?.stop(); } catch { /* 이미 끝 */ }
    this.playing = null;
  }
}

/** 마이크 — 한 번 열어 두고 듣는 동안만 모은다. 메아리 줄이기·잡음 줄이기 켬 */
export class Mic {
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private rate = 48000;

  async open(ctx: Ctx, get: () => Promise<MediaStream> = () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })) {
    if (!this.stream) this.stream = await get();
    this.rate = ctx.sampleRate;
    this.src = ctx.createMediaStreamSource(this.stream);
    return this;
  }

  /** 모으기 시작 — 조각마다 소리 크기를 알려 준다(약 85ms) */
  start(ctx: Ctx, onFrame: (level: number) => void) {
    this.chunks = [];
    const node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => {
      const x = new Float32Array(e.inputBuffer.getChannelData(0));
      this.chunks.push(x);
      onFrame(rms(x));
    };
    this.src?.connect(node);
    node.connect(ctx.destination); // 이어야 돈다(출력은 0 — 내보내지 않는다)
    this.node = node;
  }

  /** 지금까지 모은 것을 16kHz wav 로 */
  wav(): Uint8Array {
    const n = this.chunks.reduce((s, c) => s + c.length, 0);
    const all = new Float32Array(n);
    let o = 0;
    for (const c of this.chunks) { all.set(c, o); o += c.length; }
    return wavBytes(downsample(all, this.rate, 16000), 16000);
  }

  stop() {
    if (this.node) { this.node.onaudioprocess = null; try { this.src?.disconnect(this.node); this.node.disconnect(); } catch { /* 이미 끊김 */ } }
    this.node = null;
  }
}
