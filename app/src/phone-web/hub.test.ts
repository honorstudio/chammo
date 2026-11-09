// 폰 터널(hub.ts) — 느린 셀룰러에서 생기는 두 가지(2026-10-27 사용자 'aborted' + 채팅 안 감):
// ① 셀룰러 반열림(소켓은 열린 채 아무것도 안 옴)을 알아채고 끊은 뒤 새로 붙는다 ② 맥에 압축을 부탁하고, 압축된 답을 풀어 준다
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const subtle = globalThis.crypto.subtle;
const phone = (await subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
const phonePub = new Uint8Array(await subtle.exportKey('raw', phone.publicKey));
const mac = (await subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
const macPub = new Uint8Array(await subtle.exportKey('raw', mac.publicKey));

vi.mock('./keys', () => ({ linkedKeys: async () => ({ x: phone, xPub: Buffer.from(phonePub).toString('base64url') }), NoKeysError: class extends Error {} }));
vi.mock('./relayClient', () => ({ wsUrl: async () => 'wss://relay.test/ws', call: async () => ({ status: 200, json: {} }) }));

const { HubTunnel } = await import('./hub');
const { b64, unb64 } = await import('./tunnel');
const { netRetry } = await import('../domain/netRetry');

const enc = new TextEncoder();
const dec = new TextDecoder();
const cat = (...xs: Uint8Array[]) => { const o = new Uint8Array(xs.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of xs) { o.set(x, i); i += x.length; } return o; };
async function aes(ikm: Uint8Array, salt: Uint8Array, info: string) {
  const k = await subtle.importKey('raw', ikm as Uint8Array<ArrayBuffer>, 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, info: enc.encode(info) }, k, 256);
  return subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const head = (n: number) => { const h = new Uint8Array(9); h[0] = 2; new DataView(h.buffer).setBigUint64(1, BigInt(n)); return h; };
const iv = (n: number) => { const v = new Uint8Array(12); new DataView(v.buffer).setBigUint64(4, BigInt(n)); return v; };

type Reply = (req: { m: string; p: string; h: Record<string, string> }) => { s: number; h: Record<string, string>; b: Uint8Array } | null;

/** 가짜 맥(진짜 phone_tunnel.rs 와 같은 순서) 뒤에 선 가짜 소켓 — silent 면 붙은 뒤 아무것도 안 오간다(반열림) */
class FakeWs {
  static all: FakeWs[] = [];
  static reply: Reply = () => ({ s: 200, h: {}, b: enc.encode('ok') });
  static silentAfterHello = false;
  /** 앞에서 몇 개 소켓은 맥이 허브에 없다(owner off) — 맥이 다시 붙는 몇 초 */
  static offlineFirst = 0;
  /** 맥이 모르는 세션 틀을 받으면 RESET 틀(3)을 돌려준다(새 맥) — false 면 옛 맥처럼 그냥 버린다 */
  static macResets = true;
  readyState = 0;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: { t?: string }[] = [];
  silent = false;
  closed = false;
  private s: { p2m: CryptoKey; m2p: CryptoKey; send: number; recv: number } | null = null;
  private q: Promise<unknown> = Promise.resolve();
  constructor() {
    FakeWs.all.push(this);
    const on = FakeWs.all.length > FakeWs.offlineFirst;
    setTimeout(() => { this.readyState = 1; this.push({ t: 'owner', on }); }, 0);
  }
  /** 닫는 틀 없이 끊김(11-02 맥·허브 사이 1006) — 브라우저는 onclose 만 받는다 */
  drop() { this.closed = true; this.readyState = 3; setTimeout(() => this.onclose?.(), 0); }
  /** 맥이 허브에 다시 붙음(11-04 03:07 '허브 끊김 → 다시 붙음') — 맥은 터널 세션을 다 잊는다. owner = 중계가 owner on 을 다시 알리나 */
  macRestart(owner: boolean) { this.s = null; if (owner) this.push({ t: 'owner', on: true }); }
  static OPEN = 1;
  private push(m: unknown, then?: () => void) { if (!this.silent && !this.closed) setTimeout(() => { this.onmessage?.({ data: JSON.stringify(m) }); then?.(); }, 0); }
  close() { this.closed = true; this.readyState = 3; }
  send(text: string) {
    const m = JSON.parse(text) as { t?: string; d?: string };
    this.sent.push(m);
    if (this.silent || this.closed) return;
    if (m.t !== 'f') { this.push({ t: 'error', code: 'bad_message' }); return; } // 중계는 모르는 틀에 error 로 답한다
    this.q = this.q.then(() => this.mac(unb64(m.d!)));
  }
  private async mac(frame: Uint8Array) {
    if (frame[0] === 1) {
      const v = JSON.parse(dec.decode(frame.slice(1))) as { pk: string; n: string };
      const pub = await subtle.importKey('raw', unb64(v.pk), ECDH, true, []);
      const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: pub }, mac.privateKey, 256));
      const nM = crypto.getRandomValues(new Uint8Array(16));
      const salt = cat(enc.encode('chammo-tunnel/v1'), unb64(v.n), nM);
      this.s = { p2m: await aes(shared, salt, 'phone->mac'), m2p: await aes(shared, salt, 'mac->phone'), send: 1, recv: 0 };
      const c = cat(head(0), new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv(0), additionalData: head(0) }, this.s.m2p, enc.encode('chammo-ok'))));
      this.push({ t: 'f', d: b64(cat(new Uint8Array([1]), enc.encode(JSON.stringify({ v: 1, n: b64(nM), c: b64(c) })))) }, () => { if (FakeWs.silentAfterHello) this.silent = true; });
      return;
    }
    const s = this.s;
    if (!s) { if (FakeWs.macResets) this.push({ t: 'f', d: b64(new Uint8Array([3])) }); return; } // phone_relay_core 'no session'
    const n = Number(new DataView(frame.buffer, frame.byteOffset + 1, 8).getBigUint64(0));
    s.recv = n;
    const r = JSON.parse(dec.decode(await subtle.decrypt({ name: 'AES-GCM', iv: iv(n), additionalData: frame.slice(0, 9) }, s.p2m, frame.slice(9)))) as { id: number; m: string; p: string; h: Record<string, string> };
    const out = FakeWs.reply(r);
    if (!out) return;
    const k = s.send++;
    const pt = enc.encode(JSON.stringify({ id: r.id, i: 0, n: 1, s: out.s, h: out.h, b: b64(out.b) }));
    this.push({ t: 'f', d: b64(cat(head(k), new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv(k), additionalData: head(k) }, s.m2p, pt)))) });
  }
}

const link = { relay: 'https://relay.test', mac: 'm1', macX: b64(macPub), device: 'd1' };

beforeEach(() => {
  FakeWs.all = [];
  FakeWs.silentAfterHello = false;
  FakeWs.offlineFirst = 0;
  FakeWs.macResets = true;
  FakeWs.reply = () => ({ s: 200, h: {}, b: enc.encode('ok') });
  vi.stubGlobal('WebSocket', FakeWs);
});
afterEach(() => vi.unstubAllGlobals());

describe('폰 터널 — 느린 셀룰러', () => {
  it('보통 길: 요청 하나가 맥 답으로 온다', async () => {
    const t = new HubTunnel(link);
    expect(await (await t.fetch('/api/env')).text()).toBe('ok');
  });

  it('소켓이 열린 채 조용히 죽으면(반열림) 기다리던 요청을 망 오류로 끝내고, 다음 요청은 새 소켓으로 붙는다', async () => {
    const t = new HubTunnel(link, { stallMs: 120, probeMs: 120 });
    FakeWs.silentAfterHello = true;
    const at = Date.now();
    const p = t.fetch('/api/sessions'); // hello 뒤 바로 먹통 — 이 요청은 답이 없다
    await expect(p).rejects.toBeInstanceOf(TypeError);
    expect(Date.now() - at).toBeLessThan(2000);
    // 먹통이라고 보기 전에 중계에 한 번 물어봤다(답 없음)
    expect(FakeWs.all[0]!.sent.some((m) => m.t === 'ping')).toBe(true);
    FakeWs.silentAfterHello = false;
    expect(await (await t.fetch('/api/env')).text()).toBe('ok');
    expect(FakeWs.all.length).toBe(2);
  });

  it('맥 일이 오래 걸려도 중계가 물음에 답하면 끊지 않는다', async () => {
    const t = new HubTunnel(link, { stallMs: 80, probeMs: 80 });
    let late: (() => void) | null = null;
    FakeWs.reply = (r) => {
      if (r.p !== '/api/slow') return { s: 200, h: {}, b: enc.encode('ok') };
      late = () => {};
      return null;
    };
    await t.fetch('/api/env');
    const p = t.fetch('/api/slow');
    let done = false;
    p.catch(() => {}).finally(() => { done = true; });
    await new Promise((r) => setTimeout(r, 500));
    expect(late).not.toBeNull();
    expect(done).toBe(false); // 중계가 살아 있으니 아직 기다린다
    expect(FakeWs.all.length).toBe(1);
    t.close();
  });

  it('맥에 압축을 부탁하고(x-chammo-gz), 압축된 답은 풀어서 준다', async () => {
    const body = JSON.stringify({ text: '대화 한 줄\n'.repeat(4000) });
    let asked = '';
    FakeWs.reply = (r) => {
      asked = r.h['x-chammo-gz'] ?? '';
      return { s: 200, h: { 'content-type': 'application/json', 'x-chammo-gz': '1' }, b: new Uint8Array(gzipSync(body)) };
    };
    const t = new HubTunnel(link);
    const r = await t.fetch('/api/transcript?id=x');
    expect(asked).toBe('1');
    expect(await r.text()).toBe(body);
    expect(r.headers.get('x-chammo-gz')).toBeNull();
  });

  it('압축 안 된 답(옛 맥)은 그대로', async () => {
    FakeWs.reply = () => ({ s: 200, h: { 'content-type': 'text/plain' }, b: enc.encode('plain') });
    const t = new HubTunnel(link);
    expect(await (await t.fetch('/api/x')).text()).toBe('plain');
  });
});

// 11-02 사용자 폰 '맥에 못 닿았어요: Load failed' — 맥↔중계 허브 소켓이 몇 분마다 닫는 틀 없이 끊기고(양쪽 1006) 몇 초 뒤 다시 붙는다.
// 터널은 그 순간 기다리던 요청을 망 오류로 끝낸다(그대로) — 받기 길(data/web call)이 netRetry 로 감싸 새 소켓으로 다시 받는다
describe('폰 터널 — 허브가 잠깐 끊김', () => {
  const quick = { sleep: () => new Promise<void>((r) => setTimeout(r, 5)) };
  const dropFirst = () => {
    let first = true;
    FakeWs.reply = () => {
      if (!first) return { s: 200, h: {}, b: enc.encode('ok') };
      first = false;
      FakeWs.all[0]!.drop(); // 맥이 답을 내기 전에 소켓이 잘렸다
      return null;
    };
  };

  it('재현: 요청 중 소켓이 닫히면 터널만으론 Load failed', async () => {
    dropFirst();
    const t = new HubTunnel(link);
    await expect(t.fetch('/api/sessions')).rejects.toThrow('Load failed');
  });

  it('netRetry 로 감싸면 새 소켓으로 다시 받아 오류 없이 답', async () => {
    dropFirst();
    const t = new HubTunnel(link);
    expect(await (await netRetry(() => t.fetch('/api/sessions'), quick)).text()).toBe('ok');
    expect(FakeWs.all.length).toBe(2);
  });

  it('맥이 허브에 다시 붙는 사이(owner off 두 번)도 그 뒤 소켓으로 받는다', async () => {
    FakeWs.offlineFirst = 2;
    const t = new HubTunnel(link);
    expect(await (await netRetry(() => t.fetch('/api/sessions'), quick)).text()).toBe('ok');
    expect(FakeWs.all.length).toBe(3);
  });

  it('맥이 계속 꺼져 있으면 몇 번 뒤 꺼짐 오류 그대로 — 화면이 오래 끊김으로 판단한다', async () => {
    FakeWs.offlineFirst = 99;
    const t = new HubTunnel(link);
    await expect(netRetry(() => t.fetch('/api/sessions'), quick)).rejects.toThrow('꺼져 있어요');
  });
});

// 11-04 03:07 사용자 폰 '연결이 느려서 답을 못 받았어요' 2분+ — 맥이 허브에 다시 붙으며 터널 세션을 다 잊었는데(phone_relay Tunnels::default)
// 폰은 옛 세션으로 계속 보냈다: 중계가 준 owner on 을 '이미 세션 있음'으로 무시했고, 맥은 'no session' 으로 조용히 버렸고, ping 엔 중계가 답해서 끊지도 않았다
describe('폰 터널 — 맥이 허브에 다시 붙어 세션을 잊음', () => {
  const quick = { sleep: () => new Promise<void>((r) => setTimeout(r, 5)) };

  it('중계가 owner on 을 다시 알리면 옛 세션을 버리고 새로 악수한다', async () => {
    FakeWs.macResets = false; // 옛 맥이어도
    const t = new HubTunnel(link);
    await t.fetch('/api/env');
    FakeWs.all[0]!.macRestart(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(await (await netRetry(() => t.fetch('/api/sessions'), quick)).text()).toBe('ok');
  });

  it('owner on 을 못 받았어도 맥이 RESET 틀을 주면 기다리던 요청을 망 오류로 끝내고 새로 붙는다', async () => {
    const t = new HubTunnel(link, { stallMs: 5000, probeMs: 5000 });
    await t.fetch('/api/env');
    FakeWs.all[0]!.macRestart(false);
    const at = Date.now();
    await expect(t.fetch('/api/sessions')).rejects.toThrow('Load failed');
    expect(Date.now() - at).toBeLessThan(1000); // 받기 한도(15초)까지 안 기다린다
    expect(await (await t.fetch('/api/env')).text()).toBe('ok');
    expect(FakeWs.all.length).toBe(2);
  });

  it('맥 세션 시간 중 RESET 비슷한 틀이 다른 소켓에서 와도 지금 소켓은 그대로', async () => {
    const t = new HubTunnel(link);
    await t.fetch('/api/env');
    const old = FakeWs.all[0]!;
    t.close();
    expect(await (await t.fetch('/api/env')).text()).toBe('ok');
    old.onmessage?.({ data: JSON.stringify({ t: 'f', d: b64(new Uint8Array([3])) }) });
    expect(await (await t.fetch('/api/env')).text()).toBe('ok');
    expect(FakeWs.all.length).toBe(2);
  });
});
