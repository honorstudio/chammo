// 폰이 전혀 안 붙던 것(11-07 13:39 — 허브 소켓이 초당 1번꼴로 전부 401, 화면은 '저절로 다시 붙어요'). 브라우저 WebSocket 은 401 을 못 보고 onerror 만 받는다.
// 소켓이 안 열리면 같은 서명으로 HTTP 한 번 물어 진짜 상태를 가른다 — 401 이면 TrustError, 망 오류면 지금처럼
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const keys = { x: await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']), xPub: '' };
const macX = Buffer.from(new Uint8Array(await crypto.subtle.exportKey('raw', ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair).publicKey))).toString('base64url');

const call = vi.fn();
const linkedKeys = vi.fn(async () => keys);
vi.mock('./keys', () => ({ linkedKeys: () => linkedKeys(), NoKeysError: class NoKeysError extends Error {} }));
vi.mock('./relayClient', () => ({ wsUrl: async () => 'wss://relay.test/ws', call: (...a: unknown[]) => call(...a) }));

const { HubTunnel, TrustError, OfflineError, ASK_EVERY_MS, DENIED_HOLD_MS } = await import('./hub');
const { NoKeysError } = await import('./keys');
const { netRetry, isTransient } = await import('../domain/netRetry');

/** 곧바로 실패하는 소켓(401·망 오류 — 브라우저엔 같아 보인다) */
class RefusedWs {
  static n = 0;
  static OPEN = 1;
  readyState = 0;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor() {
    RefusedWs.n++;
    setTimeout(() => { this.onerror?.(); this.onclose?.(); }, 0);
  }
  close() {}
  send() {}
}

const link = { relay: 'https://relay.test', mac: 'mac1', macX, device: 'dev1' };
const tunnel = () => new HubTunnel(link);

beforeEach(() => {
  RefusedWs.n = 0;
  call.mockReset();
  linkedKeys.mockReset();
  linkedKeys.mockImplementation(async () => keys);
  vi.stubGlobal('WebSocket', RefusedWs);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('허브 소켓이 안 열리면 HTTP 로 가른다', () => {
  it('재현: 서명이 거절되면(401) TrustError — 전엔 TypeError 라 저절로 붙는다고 했다', async () => {
    call.mockResolvedValue({ status: 401, json: null });
    await expect(tunnel().fetch('/api/env')).rejects.toBeInstanceOf(TrustError);
    expect(call).toHaveBeenCalledWith('https://relay.test', keys, 'dev1', 'GET', '/v0/me/self');
  });

  it('망 오류·서버 오류면 지금처럼 TypeError(저절로 다시) — 멀쩡한 폰을 풀렸다고 하지 않는다', async () => {
    for (const r of [() => Promise.reject(new TypeError('Load failed')), () => Promise.resolve({ status: 200, json: {} }), () => Promise.resolve({ status: 500, json: null }), () => Promise.resolve({ status: 403, json: null }), () => Promise.resolve({ status: 429, json: null })]) {
      call.mockReset();
      call.mockImplementation(r);
      const e = await tunnel().fetch('/api/env').catch((x: unknown) => x);
      expect(e).toBeInstanceOf(TypeError);
      expect(e).not.toBeInstanceOf(TrustError);
    }
  });

  it('401 뒤엔 잠깐 소켓을 안 연다 — 초당 1번 두드리기가 멈춘다', async () => {
    call.mockResolvedValue({ status: 401, json: null });
    const t = tunnel();
    await t.fetch('/a').catch(() => {});
    expect(RefusedWs.n).toBe(1);
    for (let i = 0; i < 5; i++) await expect(t.fetch('/a')).rejects.toBeInstanceOf(TrustError);
    expect(RefusedWs.n).toBe(1);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('잠깐 지나면 한 번 다시 본다 — 폰 시계·잠깐의 거절이면 저절로 풀린다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    call.mockResolvedValue({ status: 401, json: null });
    const t = tunnel();
    await t.fetch('/a').catch(() => {});
    vi.setSystemTime(Date.now() + DENIED_HOLD_MS + 1);
    call.mockResolvedValue({ status: 200, json: {} });
    const e = await t.fetch('/a').catch((x: unknown) => x);
    expect(RefusedWs.n).toBe(2);
    expect(e).not.toBeInstanceOf(TrustError);
  });

  it('망 오류가 계속돼도 묻기는 간격을 둔다 — 실패마다 서명 요청을 쏘지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    call.mockRejectedValue(new TypeError('Load failed'));
    const t = tunnel();
    for (let i = 0; i < 4; i++) await t.fetch('/a').catch(() => {});
    expect(RefusedWs.n).toBe(4);
    expect(call).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + ASK_EVERY_MS + 1);
    await t.fetch('/a').catch(() => {});
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('컴퓨터가 꺼진 것(OfflineError)은 안 묻는다', async () => {
    vi.stubGlobal('WebSocket', class {
      static OPEN = 1;
      readyState = 0;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      constructor() { setTimeout(() => this.onmessage?.({ data: JSON.stringify({ t: 'owner', on: false }) }), 0); }
      close() {}
      send() {}
    });
    await expect(tunnel().fetch('/a')).rejects.toBeInstanceOf(OfflineError);
    expect(call).not.toHaveBeenCalled();
  });

  it('링크는 있는데 열쇠가 없으면 소켓을 안 열고 바로 TrustError — 새 열쇠로 옛 링크를 서명하지 않는다', async () => {
    linkedKeys.mockRejectedValue(new NoKeysError());
    await expect(tunnel().fetch('/a')).rejects.toBeInstanceOf(TrustError);
    expect(RefusedWs.n).toBe(0);
    expect(call).not.toHaveBeenCalled();
  });

  it('열쇠 저장소 읽기가 잠깐 실패한 건(그 밖 오류) 풀렸다고 하지 않는다', async () => {
    linkedKeys.mockRejectedValue(new Error('Connection to Indexed Database server lost'));
    const e = await tunnel().fetch('/a').catch((x: unknown) => x);
    expect(e).not.toBeInstanceOf(TrustError);
    expect(RefusedWs.n).toBe(0);
  });
});

describe('받기 다시 하기 — TrustError 는 다시 해도 소용없다', () => {
  it('TrustError 는 잠깐 끊김이 아니다', () => {
    expect(isTransient(new TrustError())).toBe(false);
    expect(isTransient(new TypeError('Load failed'))).toBe(true);
    expect(isTransient(new OfflineError())).toBe(true);
  });
  it('netRetry 가 바로 멈춘다', async () => {
    let n = 0;
    await expect(netRetry(async () => { n++; throw new TrustError(); })).rejects.toBeInstanceOf(TrustError);
    expect(n).toBe(1);
  });
});
