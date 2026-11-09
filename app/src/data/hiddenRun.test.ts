import { beforeEach, describe, expect, it, vi } from 'vitest';

// 0.4.9 윈도우 실측 — 숨은 터미널이 ESC[6n 에 답을 안 해 claude auth login 이 안 돌았다(새 사용자가 로그인 장을 못 넘어감)
const calls: { write: [number, string][]; onData: (b: Uint8Array) => void; resolve: (n: number) => void } = { write: [], onData: () => {}, resolve: () => {} };
vi.mock('./tauri', () => ({
  openPty: (_c: string, _d: unknown, _w: number, _h: number, on: (b: Uint8Array) => void) => { calls.onData = on; return new Promise<number>((r) => { calls.resolve = r; }); },
  closePty: () => Promise.resolve(),
  writePty: (id: number, data: string) => { calls.write.push([id, data]); return Promise.resolve(); },
}));
import { cursorAsks, hiddenRun } from './hiddenRun';

const bytes = (s: string) => new TextEncoder().encode(s);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('숨은 터미널의 커서 답', () => {
  beforeEach(() => { calls.write = []; });
  it('조각 경계에 걸친 ESC[6n 도 한 번씩 센다', () => {
    expect(cursorAsks('', 'a\x1b[6nb')).toEqual({ asks: 1, tail: 'b' });
    const first = cursorAsks('', 'x\x1b[');
    expect(first.asks).toBe(0);
    expect(cursorAsks(first.tail, '6n').asks).toBe(1);
    expect(cursorAsks('', '\x1b[6n\x1b[6n').asks).toBe(2);
  });
  it('번호를 받기 전에 온 물음도 번호를 받자마자 답한다 — 안 답하면 가짜 콘솔이 자식을 영영 안 띄운다', async () => {
    hiddenRun('claude auth login');
    calls.onData(bytes('\x1b[6n\x1b[m'));
    expect(calls.write).toEqual([]);
    calls.resolve(7);
    await flush();
    expect(calls.write).toEqual([[7, '\x1b[1;1R']]);
  });
  it('번호를 받은 뒤의 물음엔 바로 답하고, 없으면 안 쓴다', async () => {
    hiddenRun('x');
    calls.resolve(9);
    await flush();
    calls.onData(bytes('hello'));
    expect(calls.write).toEqual([]);
    calls.onData(bytes('\x1b[6n'));
    expect(calls.write).toEqual([[9, '\x1b[1;1R']]);
  });
});
