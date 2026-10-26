// 숫자 확인 두드리기(knockLink) — 가짜 허브·가짜 컴퓨터로 끝까지. 허브(chammo-relay hub.ts)는 end:true 답을 보내자마자 소켓을 닫는다
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commitMOf } from './sas';
import { b64, ECDH, open, seal, unb64 } from './tunnel';

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;
const raw = async (k: CryptoKey) => new Uint8Array(await subtle.exportKey('raw', k));

let phone: { sign: CryptoKeyPair; x: CryptoKeyPair; signPub: string; xPub: string };
vi.mock('./keys', () => ({ phoneKeys: async () => phone }));
vi.mock('./relayClient', () => ({ wsUrl: async () => 'wss://relay.test/v0/hubs/mac1/knock' }));

/** 가짜 소켓 — 폰이 보낸 것을 컴퓨터(mac)에게, 컴퓨터 답을 허브가 하듯 넘긴다 */
class FakeWs {
  static last: FakeWs;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: Record<string, unknown>[] = [];
  closed = false;
  constructor(public url: string) {
    FakeWs.last = this;
    setTimeout(() => this.onopen?.(), 0);
  }
  send(s: string) {
    this.sent.push(JSON.parse(s) as Record<string, unknown>);
    void mac.onKnock(this, JSON.parse(s) as { box: string });
  }
  close() {
    this.closed = true;
  }
  /** 허브 → 폰 */
  push(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  /** 허브가 닫는다 — close 사건은 다음 차례(task)에. 상자 풀기(WebCrypto 여러 번)는 그보다 늦게 끝날 수 있다 */
  hubClose(code = 1000) {
    this.closed = true;
    setImmediate(() => this.onclose?.({ code }));
  }
}

/** 가짜 컴퓨터 — Rust phone_relay::link_step 처럼 link1 → link2(cM), link3 → link4(nM) */
const mac = {
  keys: null as CryptoKeyPair | null,
  pub: new Uint8Array(),
  nm: globalThis.crypto.getRandomValues(new Uint8Array(16)),
  px: new Uint8Array(),
  sasShown: false,
  async onKnock(ws: FakeWs, m: { box: string }) {
    const body = JSON.parse(dec.decode(await open(this.keys!.privateKey, this.pub, unb64(m.box)))) as Record<string, string>;
    if (body.step === 'link1') {
      this.px = unb64(body.x!);
      ws.push({ t: 'reply', box: b64(await seal(this.px, enc.encode(JSON.stringify({ step: 'link2', cM: b64(await commitMOf(this.pub, this.nm)) })))) });
    } else if (body.step === 'link3') {
      ws.push({ t: 'reply', box: b64(await seal(this.px, enc.encode(JSON.stringify({ step: 'link4', nM: b64(this.nm) })))) });
    }
  },
  /** 사람이 카드에서 허용 — link5(end) 를 보내고 허브가 바로 닫는다 */
  async approve(ws: FakeWs) {
    const box = b64(await seal(this.px, enc.encode(JSON.stringify({ step: 'link5', ok: true, token: 't'.repeat(43), device: 'dev-phone', mac: { id: 'mac1', name: 'MacBook' } }))));
    ws.push({ t: 'reply', box });
    ws.hubClose();
  },
};

const macKnock = mac.onKnock;
const computer = () => ({ id: 'mac1', name: 'MacBook', kind: 'full', tunnelPub: b64(mac.pub), online: true });
const sasOnScreen = () => new Promise<string>((ok) => { onSas = ok; });
let onSas: (s: string) => void = () => {};

beforeEach(async () => {
  const x = (await subtle.generateKey(ECDH, false, ['deriveBits'])) as CryptoKeyPair;
  phone = { sign: x, x, signPub: b64(new Uint8Array(32).fill(7)), xPub: b64(await raw(x.publicKey)) };
  mac.keys = (await subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
  mac.pub = await raw(mac.keys.publicKey);
  mac.onKnock = macKnock;
  vi.stubGlobal('WebSocket', FakeWs);
});

describe('knockLink — 허용 뒤 허브가 바로 닫아도', () => {
  it('link5 를 받은 직후 닫힘이 와도 토큰을 저장한다(10-26 사용자 폰 "못 열었어요")', async () => {
    const { knockLink } = await import('./linkKnock');
    const sas = sasOnScreen();
    const run = knockLink('https://relay.test', 'dev-phone', computer(), (s) => onSas(s), async () => true);
    await sas;
    await mac.approve(FakeWs.last);
    const r = await run;
    expect(r.token).toBe('t'.repeat(43));
    expect(r.link).toMatchObject({ mac: 'mac1', device: 'dev-phone', macName: 'MacBook' });
  });
});

describe('knockLink — 끊겼을 때 문구는 QR 이 아니라 지금 할 일', () => {
  it('숫자를 띄운 뒤 허용 전에 끊기면: 다시 눌러 새 숫자로', async () => {
    const { knockLink, LINK_ERRORS } = await import('./linkKnock');
    const sas = sasOnScreen();
    const run = knockLink('https://relay.test', 'dev-phone', computer(), (s) => onSas(s), async () => true);
    await sas;
    FakeWs.last.hubClose();
    await expect(run).rejects.toThrow(LINK_ERRORS.cut);
    expect(LINK_ERRORS.cut).not.toContain('QR');
  });
  it('숫자 전에 컴퓨터가 닫으면(refused): 컴퓨터 로그인·켜짐을 보라고', async () => {
    const { knockLink, LINK_ERRORS } = await import('./linkKnock');
    const run = knockLink('https://relay.test', 'dev-phone', computer(), () => {}, async () => true);
    mac.onKnock = async (ws) => { ws.push({ t: 'refused' }); ws.hubClose(); };
    await expect(run).rejects.toThrow(LINK_ERRORS.refused);
    expect(LINK_ERRORS.refused).not.toContain('QR');
  });
  it('같은 폰이 새 확인을 시작해 옛 소켓이 바뀌면(4004) 옛 확인은 replaced', async () => {
    const { knockLink, LINK_ERRORS } = await import('./linkKnock');
    const run = knockLink('https://relay.test', 'dev-phone', computer(), () => {}, async () => true);
    mac.onKnock = async (ws) => ws.hubClose(4004);
    await expect(run).rejects.toThrow(LINK_ERRORS.replaced);
  });
});
