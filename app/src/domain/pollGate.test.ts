import { describe, expect, it } from 'vitest';
import { ALL_EVERY_MS, allDue, singleFlight } from './pollGate';

describe('allDue — 꺼진 세션 목록(agents --all)은 15초에 한 번(2026-10-04 mac-perf, 3초마다 부르면 코어 7%)', () => {
  const base = { lastAt: 100_000, now: 100_000 + 3_000, force: false, prevLive: ['a', 'b'], live: ['a', 'b'] };
  it('15초 안이면 안 읽는다', () => expect(allDue(base)).toBe(false));
  it('15초가 지나면 읽는다', () => expect(allDue({ ...base, now: base.lastAt + ALL_EVERY_MS })).toBe(true));
  it('처음엔 읽는다', () => expect(allDue({ ...base, lastAt: 0 })).toBe(true));
  it('사람이 부른 새로 고침(지우기·이어 켜기 뒤)은 바로 읽는다', () => expect(allDue({ ...base, force: true })).toBe(true));
  it('살아 있던 세션이 사라지면 바로 읽는다 — 꺼진 목록에 늦게 나타나 아무 데도 안 보이는 틈을 줄인다', () => {
    expect(allDue({ ...base, live: ['a'] })).toBe(true);
  });
  it('새 세션이 생기기만 한 건 기다린다(꺼진 목록은 살아 있는 걸 알아서 뺀다)', () => {
    expect(allDue({ ...base, live: ['a', 'b', 'c'] })).toBe(false);
  });
});

describe('singleFlight — 앞 새로 고침이 안 끝났으면 겹쳐 부르지 않는다', () => {
  const gate = () => {
    const calls: boolean[] = [];
    const ends: (() => void)[] = [];
    const run = (force: boolean) => { calls.push(force); return new Promise<void>((r) => ends.push(r)); };
    return { calls, ends, go: singleFlight(run) };
  };
  it('폴링 차례는 도는 중이면 버린다', async () => {
    const g = gate();
    const a = g.go(false);
    const b = g.go(false);
    expect(g.calls).toEqual([false]);
    g.ends[0]!();
    await a; await b;
    expect(g.calls).toEqual([false]);
  });
  it('사람이 부른 것은 앞이 끝난 뒤 한 번 더(새 값을 기다리는 쪽이 낡은 값으로 끝나지 않게)', async () => {
    const g = gate();
    const a = g.go(false);
    let bDone = false;
    const b = g.go(true).then(() => { bDone = true; });
    const c = g.go(true); // 이미 줄 서 있으면 같이 탄다
    expect(g.calls).toEqual([false]);
    g.ends[0]!();
    await a;
    await Promise.resolve(); await Promise.resolve();
    expect(g.calls).toEqual([false, true]);
    expect(bDone).toBe(false);
    g.ends[1]!();
    await b; await c;
    expect(bDone).toBe(true);
    expect(g.calls).toEqual([false, true]);
  });
  it('실패해도 다음 차례는 돈다', async () => {
    let n = 0;
    const go = singleFlight(async () => { n++; if (n === 1) throw new Error('x'); });
    await go(false).catch(() => {});
    await go(false);
    expect(n).toBe(2);
  });
});
