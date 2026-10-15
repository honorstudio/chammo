import { describe, expect, it } from 'vitest';
import { sharedPoll, type Every } from './sharedPoll';

/** 손으로 돌리는 주기 실행기 — fire() 가 한 바퀴 */
function manual() {
  const fns = new Set<() => void>();
  const every: Every = (fn) => { fns.add(fn); return () => fns.delete(fn); };
  return { every, fire: () => fns.forEach((f) => f()), running: () => fns.size };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('sharedPoll — 여러 화면이 같은 걸 묻던 폴링 하나로', () => {
  it('구독자가 둘이어도 한 바퀴에 한 번만 묻는다', async () => {
    const m = manual();
    let calls = 0;
    const p = sharedPoll(async () => { calls++; return [calls]; }, 1500, [] as number[], m.every);
    const a: number[][] = [];
    const b: number[][] = [];
    p.subscribe((v) => a.push(v));
    p.subscribe((v) => b.push(v));
    await flush();
    expect(calls).toBe(1);
    m.fire();
    await flush();
    expect(calls).toBe(2);
    expect(a).toEqual([[1], [2]]);
    expect(b).toEqual([[1], [2]]);
    expect(m.running()).toBe(1);
  });
  it('값이 같으면 알리지 않는다', async () => {
    const m = manual();
    const p = sharedPoll(async () => ['x'], 1500, [] as string[], m.every);
    const got: string[][] = [];
    p.subscribe((v) => got.push(v));
    await flush();
    m.fire();
    await flush();
    expect(got).toEqual([['x']]);
    expect(p.current()).toEqual(['x']);
  });
  it('다 떠나면 멈추고, 다시 오면 바로 한 번 묻고 다시 돈다', async () => {
    const m = manual();
    let calls = 0;
    const p = sharedPoll(async () => ++calls, 1500, 0, m.every);
    const off1 = p.subscribe(() => {});
    const off2 = p.subscribe(() => {});
    await flush();
    off1();
    expect(m.running()).toBe(1);
    off2();
    expect(m.running()).toBe(0);
    p.subscribe(() => {});
    await flush();
    expect(calls).toBe(2);
    expect(m.running()).toBe(1);
  });
  it('앞 물음이 안 끝났으면 겹쳐 묻지 않고, 실패해도 다음 바퀴에 다시', async () => {
    const m = manual();
    let calls = 0;
    let fail = true;
    let release: () => void = () => {};
    const p = sharedPoll(() => { calls++; if (fail) return Promise.reject(new Error('x')); return new Promise<number>((ok) => { release = () => ok(calls); }); }, 1500, 0, m.every);
    p.subscribe(() => {});
    await flush();
    fail = false;
    m.fire();
    m.fire(); // 아직 답이 없다 — 건너뜀
    expect(calls).toBe(2);
    release();
    await flush();
    m.fire();
    expect(calls).toBe(3);
  });
});
