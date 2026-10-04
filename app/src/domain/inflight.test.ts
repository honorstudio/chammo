import { describe, expect, it } from 'vitest';
import { shared } from './inflight';

describe('shared — 같은 것을 이미 받는 중이면 그 요청을 같이 기다린다(느린 망에서 같은 수백 KB 를 두 번 받았다, 2026-10-04)', () => {
  it('받는 중에 또 부르면 새로 안 받고 같은 답', async () => {
    let n = 0;
    let done!: (v: string) => void;
    const load = () => { n++; return new Promise<string>((r) => { done = r; }); };
    const a = shared('k1', load);
    const b = shared('k1', load);
    expect(n).toBe(1);
    done('x');
    expect(await a).toBe('x');
    expect(await b).toBe('x');
  });
  it('끝나면 놓는다 — 다음엔 새로 받는다(낡은 값을 붙잡지 않게)', async () => {
    let n = 0;
    const load = async () => ++n;
    expect(await shared('k2', load)).toBe(1);
    expect(await shared('k2', load)).toBe(2);
  });
  it('실패해도 놓는다 — 다음엔 다시 받는다', async () => {
    let n = 0;
    const load = async () => { n++; if (n === 1) throw new Error('down'); return 'ok'; };
    await expect(shared('k3', load)).rejects.toThrow('down');
    expect(await shared('k3', load)).toBe('ok');
  });
  it('열쇠가 다르면 따로', async () => {
    let n = 0;
    const load = () => new Promise<number>((r) => setTimeout(() => r(++n), 5));
    await Promise.all([shared('a', load), shared('b', load)]);
    expect(n).toBe(2);
  });
});
