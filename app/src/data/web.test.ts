import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEnv, interruptSession, pair } from './web';

afterEach(() => vi.unstubAllGlobals());

const code = 'a'.repeat(32);

describe('짝짓기 — 저장이 막히면 코드를 쓰기 전에 알린다', () => {
  it('localStorage 쓰기가 실패하면 서버에 코드를 내지 않는다(코드가 안 닳는다)', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} });
    await expect(pair(code)).rejects.toThrow(/저장/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('localStorage 자체가 없어도(접근이 막힘) 마찬가지', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('localStorage', undefined);
    await expect(pair(code)).rejects.toThrow(/저장/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('저장이 되면 코드를 내고 받은 토큰을 둔다', async () => {
    const box = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => void box.set(k, v), removeItem: (k: string) => void box.delete(k) });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ token: 'f'.repeat(64) }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await pair(code);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect([...box.values()]).toContain('f'.repeat(64));
  });
  it('이 저장 공간에 옛 열쇠가 있으면 같이 내서 그 줄을 바꿔 끼운다(같은 폰이 줄줄이 안 쌓이게)', async () => {
    const box = new Map<string, string>([['chammo.token', 'e'.repeat(64)]]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => void box.set(k, v), removeItem: (k: string) => void box.delete(k) });
    const fetch = vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify({ token: 'f'.repeat(64) }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await pair(code, true);
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({ code, home: true, prev: 'e'.repeat(64) });
    expect(box.get('chammo.token')).toBe('f'.repeat(64));
  });
  it('옛 열쇠가 없으면 prev 를 안 보낸다', async () => {
    const box = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => void box.set(k, v), removeItem: (k: string) => void box.delete(k) });
    const fetch = vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify({ token: 'f'.repeat(64) }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await pair(code);
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({ code });
  });
});

describe('401 — 다른 탭이 그사이 열쇠를 바꿔 끼웠으면 새 열쇠를 지우지 않는다', () => {
  const store = (box: Map<string, string>) => vi.stubGlobal('localStorage', { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => void box.set(k, v), removeItem: (k: string) => void box.delete(k) });
  it('보낸 열쇠가 아직 저장돼 있으면(진짜 끊김) 지운다', async () => {
    const box = new Map([['chammo.token', 'e'.repeat(64)]]);
    store(box);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no key', { status: 401 })));
    await expect(interruptSession('aaaa0001')).rejects.toThrow('no key');
    expect(box.has('chammo.token')).toBe(false);
  });
  it('그사이 새 열쇠로 바뀌었으면 지우지 않고 새 열쇠로 한 번 더', async () => {
    const box = new Map([['chammo.token', 'e'.repeat(64)]]);
    store(box);
    const fetch = vi.fn(async (_u: string, init: RequestInit) => {
      if (new Headers(init.headers).get('authorization') === `Bearer ${'e'.repeat(64)}`) {
        box.set('chammo.token', 'f'.repeat(64)); // 다른 탭이 다시 짝지었다
        return new Response('no key', { status: 401 });
      }
      return new Response('{"ok":true}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    expect(await interruptSession('aaaa0001')).toBe('ok');
    expect(box.get('chammo.token')).toBe('f'.repeat(64));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('멈춤 — 비서 세션에 Esc 한 번(/api/interrupt)', () => {
  const tokenBox = () => vi.stubGlobal('localStorage', { getItem: () => 'f'.repeat(64), setItem: () => {}, removeItem: () => {} });
  it('열쇠·JSON 으로 id 만 보낸다', async () => {
    tokenBox();
    const fetch = vi.fn(async (_u: string, _i: RequestInit) => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await interruptSession('aaaa0001')).toBe('ok');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/interrupt');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ id: 'aaaa0001' });
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${'f'.repeat(64)}`);
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });
  it('이미 쉬는 중(409)·연타(429)는 오류가 아니라 결과로', async () => {
    tokenBox();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not working', { status: 409 })));
    expect(await interruptSession('aaaa0001')).toBe('idle');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('too soon', { status: 429 })));
    expect(await interruptSession('aaaa0001')).toBe('soon');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no such session', { status: 404 })));
    await expect(interruptSession('aaaa0001')).rejects.toThrow('no such session');
  });
});

describe('getEnv — 윈도우 맥 경로를 앱과 같은 / 모양으로(폰 "떠 있는 참모가 없어요", 2026-10-05)', () => {
  const box = () => vi.stubGlobal('localStorage', { getItem: () => 't'.repeat(64), setItem: () => {}, removeItem: () => {} });
  it('hqDir·devRoot·extraProjects 를 fwd', async () => {
    box();
    const raw = { assistantName: '참모', language: 'ko', devRoot: 'C:\\Users\\Me/Desktop/dev', extraProjects: ['C:\\Users\\Me\\automation\\bot'], hqDir: 'C:\\Users\\Me/.chammo/hq' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(raw), { status: 200 })));
    expect(await getEnv()).toEqual({ ...raw, devRoot: 'C:/Users/Me/Desktop/dev', extraProjects: ['C:/Users/Me/automation/bot'], hqDir: 'C:/Users/Me/.chammo/hq' });
  });
  it('맥 경로는 그대로', async () => {
    box();
    const raw = { assistantName: '참모', language: 'ko', devRoot: '/Users/me/dev', extraProjects: ['/Users/me/odd\\name'], hqDir: '/Users/me/.chammo/hq' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(raw), { status: 200 })));
    expect(await getEnv()).toEqual(raw);
  });
});
