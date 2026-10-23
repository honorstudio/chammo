// 중계 길 폰의 전송 고르기(ADR 0013) — 테일넷 빠른 길이 닿으면 직접, 끊기면 터널
import { beforeEach, expect, it, vi } from 'vitest';

const tunnelCalls: string[] = [];
vi.mock('../phone-web/link', () => ({ readLink: () => ({ relay: 'https://relay.test', mac: 'm', macX: 'x', device: 'd' }) }));
vi.mock('../phone-web/proxy', () => ({ installProxy: () => {} }));
vi.mock('../phone-web/hub', () => ({
  tunnelFor: () => ({
    fetch: async (path: string) => {
      tunnelCalls.push(path);
      if (path === '/api/env') return new Response(JSON.stringify({ directUrl: 'https://mac.tail1.ts.net' }), { status: 200 });
      return new Response('{"via":"tunnel"}', { status: 200 });
    },
  }),
}));

const store = new Map<string, string>([['chammo.token', 'k'.repeat(64)]]);
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });

let tailnet = true;
const directCalls: string[] = [];
vi.stubGlobal('fetch', async (url: string) => {
  directCalls.push(url);
  if (!tailnet) throw new TypeError('Load failed');
  return new Response(url.endsWith('/api/hello') ? '{}' : '{"via":"direct"}', { status: 200 });
});

beforeEach(() => { tunnelCalls.length = 0; directCalls.length = 0; });

it('테일넷 https 가 닿으면 직접, 망 오류면 같은 요청을 터널로', async () => {
  const { readLogin } = await import('./web');
  // 첫 요청은 빠른 길을 알아보는 동안 터널로
  expect(await readLogin()).toContain('tunnel');
  await new Promise((r) => setTimeout(r, 0));
  expect(directCalls).toContain('https://mac.tail1.ts.net/api/hello');
  expect(await readLogin()).toContain('direct');
  expect(directCalls.at(-1)).toBe('https://mac.tail1.ts.net/api/login');
  tailnet = false;
  expect(await readLogin()).toContain('tunnel');
  expect(tunnelCalls.at(-1)).toBe('/api/login');
});
