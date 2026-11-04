import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bothShown, flagVis, makeEvery } from './pollEvery';

function vis(start = true) {
  let v = start;
  const subs = new Set<(s: boolean) => void>();
  return {
    isShown: () => v,
    onShown: (f: (s: boolean) => void) => { subs.add(f); return () => { subs.delete(f); }; },
    set: (s: boolean) => { v = s; subs.forEach((f) => f(s)); },
    subs,
  };
}

describe('makeEvery — 안 보이면 5배 느리게(2026-10-11)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const ev = (v: ReturnType<typeof vis>) => makeEvery(v, () => Date.now());

  it('보이면 원래 주기', () => {
    const v = vis(true);
    let n = 0;
    ev(v)(() => n++, 1000);
    vi.advanceTimersByTime(3000);
    expect(n).toBe(3);
  });
  it('한 번 던져도 다음 차례는 걸린다 — setInterval 때처럼(2026-10-11 bug-hunt: fn(); arm() 이라 한 번 throw 면 그 폴링이 영영 멈췄다)', () => {
    const v = vis(true);
    let n = 0;
    ev(v)(() => { n++; if (n === 1) throw new Error('once'); }, 1000);
    expect(() => vi.advanceTimersByTime(1000)).toThrow('once');
    vi.advanceTimersByTime(2000);
    expect(n).toBe(3);
  });
  it('안 보이면 5배', () => {
    const v = vis(false);
    let n = 0;
    ev(v)(() => n++, 1000);
    vi.advanceTimersByTime(4999);
    expect(n).toBe(0);
    vi.advanceTimersByTime(1);
    expect(n).toBe(1);
  });
  it('안 보이는 동안 원래 주기가 지났으면 다시 보이는 순간 바로 한 번', () => {
    const v = vis(true);
    let n = 0;
    ev(v)(() => n++, 1000);
    v.set(false);
    vi.advanceTimersByTime(2000);
    expect(n).toBe(0);
    v.set(true);
    vi.advanceTimersByTime(0);
    expect(n).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(n).toBe(2);
  });
  it('금방 다시 보이면 남은 만큼만 기다린다(겹쳐 부르지 않게)', () => {
    const v = vis(true);
    let n = 0;
    ev(v)(() => n++, 1000);
    vi.advanceTimersByTime(300);
    v.set(false);
    v.set(true);
    vi.advanceTimersByTime(699);
    expect(n).toBe(0);
    vi.advanceTimersByTime(1);
    expect(n).toBe(1);
  });
  it('멈추면 더 안 부르고 구독도 푼다', () => {
    const v = vis(true);
    let n = 0;
    const stop = ev(v)(() => n++, 1000);
    stop();
    vi.advanceTimersByTime(5000);
    v.set(false);
    v.set(true);
    vi.advanceTimersByTime(5000);
    expect(n).toBe(0);
    expect(v.subs.size).toBe(0);
  });
});

describe('bothShown — 앱 창이 앞이고 이 칸도 안 덮였을 때만 보임(11-01 가만히 IPC)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('둘 중 하나라도 안 보이면 안 보임 · 바뀔 때만 알린다', () => {
    const app = vis(true), pane = flagVis(true);
    const both = bothShown(app, pane);
    const seen: boolean[] = [];
    const off = both.onShown((s) => seen.push(s));
    expect(both.isShown()).toBe(true);
    pane.set(false);
    app.set(false); // 이미 안 보임 — 또 알리지 않는다
    pane.set(true);
    app.set(true);
    expect(seen).toEqual([false, true]);
    off();
    pane.set(false);
    expect(seen).toEqual([false, true]);
  });

  it('팀 화면이 참모 채팅을 덮으면 1초 읽기가 5초로, 걷히면 밀린 한 번을 바로', () => {
    const app = vis(true), pane = flagVis(true);
    let n = 0;
    makeEvery(bothShown(app, pane), () => Date.now())(() => n++, 1000);
    pane.set(false);
    vi.advanceTimersByTime(4999);
    expect(n).toBe(0);
    vi.advanceTimersByTime(1);
    expect(n).toBe(1);
    vi.advanceTimersByTime(1500);
    pane.set(true);
    vi.advanceTimersByTime(0);
    expect(n).toBe(2);
  });
});
