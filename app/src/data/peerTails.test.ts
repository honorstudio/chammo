// 폰 세션판 — 하위 세션이 13개 넘으면 앞 12개만 꼬리를 받아 나머지 쉬는 세션이 늘 '모름'이었다(2026-10-11 bug-hunt 회귀 리뷰).
// 서버는 한 번에 12개까지라 12개씩 나눠 묻고 합친다
import { describe, expect, it } from 'vitest';
import { makeApi, type Io } from './peerApi';

describe('readTails — 12개씩 나눠 묻는다', () => {
  it('30개면 세 번, 결과는 합친다', async () => {
    const asked: string[][] = [];
    const io = { json: async (p: string) => { const ids = decodeURIComponent(p.split('ids=')[1] ?? '').split(','); asked.push(ids); return Object.fromEntries(ids.map((i) => [i, `tail-${i}`])); } } as unknown as Io;
    const ids = Array.from({ length: 30 }, (_, i) => `s${i}`);
    const out = await makeApi(io).readTails(ids);
    expect(asked.map((a) => a.length)).toEqual([12, 12, 6]);
    expect(Object.keys(out).length).toBe(30);
    expect(out.s29).toBe('tail-s29');
  });
  it('없으면 묻지 않는다', async () => {
    const io = { json: async () => { throw new Error('asked'); } } as unknown as Io;
    expect(await makeApi(io).readTails([])).toEqual({});
  });
});
