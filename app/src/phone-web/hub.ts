// 폰 → 중계 허브 → 컴퓨터 터널 (ADR 0013). fetch 와 같은 모양(Response)으로 돌려줘서 data/web.ts 의 call() 이 그대로 쓴다.
// 틀 봉하기·열기는 번호 차례가 생명이라 줄(queue) 하나로만. 끊기면 기다리던 요청은 망 오류(fetch 처럼 TypeError)로 끝나고 다음 요청이 다시 붙는다
import { agree, b64, DATA, HELLO, helloFrame, NONCE_LEN, Session, unb64 } from './tunnel';
import { phoneKeys } from './keys';
import { wsUrl } from './relayClient';
import type { RelayLink } from './link';

const CHUNK = 128 * 1024; // Rust phone_relay_core::CHUNK 와 같게
const CONNECT_MS = 10_000;
const PASS = ['authorization', 'content-type', 'range', 'accept'];
/** 기다리는 요청이 있는데 이만큼 아무것도 안 오면 중계에 한 번 물어보고(ping), 그 뒤 이만큼 더 조용하면 반열림으로 보고 끊는다.
 *  셀룰러는 소켓이 열린 채 죽는다(닫힘도 안 옴) — 안 끊으면 iOS 가 몇 분 뒤 닫을 때까지 모든 요청이 'aborted' 로 끝났다(2026-10-27 사용자).
 *  중계는 모르는 틀(ping)에 error 로 바로 답해서, 맥 일이 오래 걸려도 중계가 살아 있으면 안 끊는다 */
const STALL_MS = 12_000;
const PROBE_MS = 8_000;
/** 맥에 응답 압축(gzip)을 부탁한다 — 대화 기록 JSON 이 4~5배 준다. 옛 맥은 무시하고, 압축한 답엔 같은 머리를 단다 */
export const GZ = 'x-chammo-gz';
const enc = new TextEncoder();
const dec = new TextDecoder();

/** 컴퓨터가 허브에 없다(꺼짐·잠듦·앱 꺼짐) */
export class OfflineError extends TypeError {
  constructor() {
    super('컴퓨터 Chammo 가 꺼져 있어요');
  }
}

type Wait = { ok: (r: Response) => void; no: (e: unknown) => void; parts: Uint8Array[]; n: number; s: number; h: Record<string, string> };

export class HubTunnel {
  private ws: WebSocket | null = null;
  private session: Session | null = null;
  private opening: Promise<void> | null = null;
  private waits = new Map<number, Wait>();
  private nextId = 1;
  private sendQ: Promise<unknown> = Promise.resolve();
  private recvQ: Promise<unknown> = Promise.resolve();
  /** 컴퓨터가 허브에 있나(서버 owner 알림) — 화면이 '꺼져 있어요'를 보일 때 */
  ownerOn: boolean | null = null;
  onOwner: ((on: boolean) => void) | null = null;

  /** 마지막으로 뭐라도 받은 때(ms) — 받기 시간 한도(data/web.ts)가 '느리지만 오고 있나'를 본다 */
  lastRx = 0;
  private probedAt = 0;
  private watch: ReturnType<typeof setInterval> | null = null;
  private readonly stallMs: number;
  private readonly probeMs: number;

  constructor(private readonly link: RelayLink, opts: { stallMs?: number; probeMs?: number } = {}) {
    this.stallMs = opts.stallMs ?? STALL_MS;
    this.probeMs = opts.probeMs ?? PROBE_MS;
  }

  /** 기다리는 요청이 있을 때만 돈다 — 조용하면 ping, 그래도 조용하면 끊는다(다음 요청이 새로 붙는다) */
  private guard() {
    if (this.watch) return;
    const tick = Math.max(20, Math.min(1000, this.stallMs / 4));
    this.watch = setInterval(() => {
      if (!this.waits.size || !this.ws) { this.stopGuard(); return; }
      const now = Date.now();
      const quiet = now - this.lastRx;
      if (quiet < this.stallMs) { this.probedAt = 0; return; }
      if (!this.probedAt) {
        this.probedAt = now;
        try { this.ws.send(JSON.stringify({ t: 'ping' })); } catch { /* 닫히는 중 */ }
        return;
      }
      if (now - this.probedAt >= this.probeMs && this.lastRx < this.probedAt) this.fail(new TypeError('Load failed'));
    }, tick);
  }

  private stopGuard() {
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
    this.probedAt = 0;
  }

  private fail(e: unknown) {
    this.stopGuard();
    for (const w of this.waits.values()) w.no(e);
    this.waits.clear();
    this.session = null;
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* 이미 닫힘 */ }
  }

  close() {
    this.fail(new TypeError('closed'));
  }

  /** 붙어 있지 않으면 붙고 hello 까지 */
  private ensure(): Promise<void> {
    if (this.session && this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    this.opening ??= this.open().finally(() => { this.opening = null; });
    return this.opening;
  }

  private async open(): Promise<void> {
    const k = await phoneKeys();
    const shared = await agree(k.x.privateKey, unb64(this.link.macX));
    const nP = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
    const ws = new WebSocket(await wsUrl(this.link.relay, `/v0/hubs/${this.link.mac}/ws`, k, this.link.device));
    this.ws = ws;
    await new Promise<void>((ok, no) => {
      const t = setTimeout(() => { no(new TypeError('허브 연결 시간 초과')); this.fail(new TypeError('timeout')); }, CONNECT_MS);
      const done = (e?: unknown) => { clearTimeout(t); if (e) no(e); else ok(); };
      ws.onerror = () => done(new TypeError('허브에 못 붙었어요'));
      ws.onclose = () => { done(new TypeError('허브 연결이 끊겼어요')); if (this.ws === ws) this.fail(new TypeError('Load failed')); };
      ws.onmessage = (ev) => {
        if (this.ws === ws) this.lastRx = Date.now();
        let m: { t?: string; on?: boolean; d?: string };
        try { m = JSON.parse(String(ev.data)); } catch { return; }
        if (m.t === 'owner') {
          this.ownerOn = !!m.on;
          this.onOwner?.(!!m.on);
          if (!m.on) { done(new OfflineError()); this.fail(new OfflineError()); return; }
          if (!this.session) ws.send(JSON.stringify({ t: 'f', d: b64(helloFrame(unb64(k.xPub), nP)) }));
          return;
        }
        if (m.t !== 'f' || typeof m.d !== 'string') return;
        const frame = unb64(m.d);
        this.recvQ = this.recvQ.then(async () => {
          if (frame[0] === HELLO) {
            try {
              this.session = await Session.connect(shared, nP, frame);
              done();
            } catch (e) {
              // 확인이 안 풀림 = QR 의 컴퓨터 열쇠와 다른 상대 — 바로 끊는다
              done(new TypeError('컴퓨터 확인 실패'));
              this.fail(e);
            }
          } else if (frame[0] === DATA && this.session) {
            try { this.take(await this.session.open(frame)); } catch (e) { this.fail(e); }
          }
        });
      };
    });
  }

  private take(pt: Uint8Array) {
    const v = JSON.parse(dec.decode(pt)) as { id: number; i: number; n: number; s?: number; h?: Record<string, string>; b: string };
    const w = this.waits.get(v.id);
    if (!w) return;
    if (v.i === 0) { w.n = v.n; w.s = v.s ?? 502; w.h = v.h ?? {}; }
    w.parts.push(unb64(v.b));
    if (w.parts.length < w.n) return;
    this.waits.delete(v.id);
    const total = w.parts.reduce((a, p) => a + p.length, 0);
    const body = new Uint8Array(total);
    let at = 0;
    for (const p of w.parts) { body.set(p, at); at += p.length; }
    const nobody = w.s === 204 || w.s === 304 || w.s < 200;
    const gz = w.h[GZ] === '1';
    const h = { ...w.h };
    delete h[GZ];
    // 압축한 답 — 읽는 쪽(r.text()·json())이 풀린 글을 받게 스트림으로 푼다
    const out = nobody ? null : gz ? new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip')) : body;
    w.ok(new Response(out, { status: w.s < 200 ? 502 : w.s, headers: h }));
  }

  /** fetch 와 같은 모양 — path 는 /api/…·/·/assets/… */
  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const signal = init.signal;
    const why = () => (signal?.reason instanceof DOMException ? signal.reason : new DOMException('aborted', 'AbortError'));
    if (signal?.aborted) throw why();
    await this.ensure();
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body == null ? new Uint8Array() : new Uint8Array(await new Response(init.body).arrayBuffer());
    const hs = new Headers(init.headers);
    const h: Record<string, string> = {};
    for (const k of PASS) { const v = hs.get(k); if (v !== null) h[k] = v; }
    // 풀 줄 아는 브라우저만 부탁한다(iOS 16.4 아래는 DecompressionStream 이 없다)
    if (typeof DecompressionStream === 'function') h[GZ] = '1';
    const id = this.nextId++;
    const res = new Promise<Response>((ok, no) => {
      this.waits.set(id, { ok, no, parts: [], n: 1, s: 0, h: {} });
      signal?.addEventListener('abort', () => { if (this.waits.delete(id)) no(why()); }, { once: true });
    });
    // 조용한 동안은 지금부터 잰다 — 오래 쉬다 보낸 첫 요청이 바로 '먹통'으로 안 보이게
    if (this.waits.size === 1) this.lastRx = Math.max(this.lastRx, Date.now());
    this.guard();
    const n = Math.max(1, Math.ceil(body.length / CHUNK));
    for (let i = 0; i < n; i++) {
      const piece = body.subarray(i * CHUNK, (i + 1) * CHUNK);
      const msg = { id, i, n, b: b64(piece), ...(i === 0 ? { m: method, p: path, h } : {}) };
      this.sendQ = this.sendQ.then(async () => {
        if (!this.session || !this.ws) throw new TypeError('Load failed');
        const f = await this.session.seal(enc.encode(JSON.stringify(msg)));
        this.ws.send(JSON.stringify({ t: 'f', d: b64(f) }));
      }).catch((e) => { const w = this.waits.get(id); if (w) { this.waits.delete(id); w.no(e); } });
    }
    return res;
  }
}

let shared: { key: string; t: HubTunnel } | null = null;

/** 이 페이지의 터널 하나 — 짝지은 값이 바뀌면 새로 */
export function tunnelFor(link: RelayLink): HubTunnel {
  const key = `${link.relay}|${link.mac}|${link.device}`;
  if (shared?.key !== key) {
    shared?.t.close();
    shared = { key, t: new HubTunnel(link) };
  }
  return shared.t;
}
