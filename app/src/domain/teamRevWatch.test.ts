import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRevWatch } from './teamRevWatch';
import type { Every } from './sharedPoll';

const every: Every = (fn, ms) => { const id = setInterval(fn, ms); return () => clearInterval(id); };

describe('팀 판 바뀜 묻기를 팀마다 하나로(11-01 창 앞 가만히 team_profile_changed 분당 45~57)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('셋이 같은 팀을 봐도 3초에 한 번, 가장 옛 판으로 묻는다 · 그대로면 아무도 안 깨운다', async () => {
    let told = 7;
    const asked: number[] = [];
    const w = makeRevWatch((_t, seen) => { asked.push(seen); return Promise.resolve(told > seen); }, every);
    const pokes = [0, 0, 0];
    const offs = [7, 7, 9].map((rev, i) => w.watch('t1', { seen: () => rev, poke: () => { pokes[i] = (pokes[i] ?? 0) + 1; } }));
    await vi.advanceTimersByTimeAsync(9000);
    expect(asked).toEqual([7, 7, 7]);
    expect(pokes).toEqual([0, 0, 0]);
    told = 8; // 소켓이 새 판을 알림 — 모두 깨워 각자 자기 판으로 다시 묻게
    await vi.advanceTimersByTimeAsync(3000);
    expect(pokes).toEqual([1, 1, 1]);
    offs.forEach((f) => f());
    await vi.advanceTimersByTimeAsync(9000);
    expect(asked.length).toBe(4); // 다 떠나면 멈춘다
  });

  it('읽는 중(null)은 빼고, force 는 묻지 않고 매번 깨운다 · 팀이 다르면 따로', async () => {
    const asked: string[] = [];
    const w = makeRevWatch((t, seen) => { asked.push(`${t}:${seen}`); return Promise.resolve(false); }, every);
    let forced = 0, other = 0;
    w.watch('t1', { seen: () => null, poke: () => {} });
    w.watch('t1', { seen: () => 'force', poke: () => { forced++; } });
    w.watch('t2', { seen: () => 3, poke: () => { other++; } });
    await vi.advanceTimersByTimeAsync(3000);
    expect(forced).toBe(1);
    expect(other).toBe(0);
    expect(asked).toEqual(['t2:3']);
  });
});
