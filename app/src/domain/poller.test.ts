import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePoller } from './poller';

// 폰을 백그라운드에서 돌아오게 했을 때 대화가 옛 상태로 멈춰 있던 버그(2026-10-04 사용자 실기기) — 받기 고리
describe('makePoller — 돌아오면 바로 다시, 매달린 요청에 안 묶임', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('기다리는 중에 kick 하면 다음 차례를 안 기다리고 바로 받는다', async () => {
    const read = vi.fn(async () => 'v');
    const apply = vi.fn();
    const p = makePoller({ read, apply, everyMs: () => 10_000 });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(read).toHaveBeenCalledTimes(1);
    p.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it('매달린 요청은 kick 이 끊고 새로 받는다 — 늦게 온 옛 답은 버린다', async () => {
    const hung: { resolve: (v: string) => void; signal: AbortSignal }[] = [];
    const read = vi.fn((signal: AbortSignal) => new Promise<string>((resolve) => hung.push({ resolve, signal })));
    const apply = vi.fn();
    const p = makePoller({ read, apply, everyMs: () => 2000 });
    p.start();
    await vi.advanceTimersByTimeAsync(60_000); // 영영 안 오는 요청 — 고리가 멈춰 있다
    expect(read).toHaveBeenCalledTimes(1);
    p.kick();
    expect(hung[0]!.signal.aborted).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
    hung[1]!.resolve('new');
    await vi.advanceTimersByTimeAsync(0);
    hung[0]!.resolve('old'); // 끊긴 요청이 뒤늦게 와도
    await vi.advanceTimersByTimeAsync(0);
    expect(apply.mock.calls.map((c) => c[0])).toEqual(['new']);
    p.stop();
  });

  it('실패해도 다음 차례는 돈다, stop 뒤엔 안 돈다', async () => {
    let n = 0;
    const read = vi.fn(async () => { n++; if (n === 1) throw new Error('끊김'); return 'ok'; });
    const apply = vi.fn();
    const p = makePoller({ read, apply, everyMs: () => 1000 });
    p.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(apply).toHaveBeenCalledWith('ok');
    p.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('fresh — 시작·kick 뒤 첫 답이 오기 전엔 false(옛 내용을 지금 상태처럼 안 보이게)', async () => {
    let release: (v: string) => void = () => {};
    const read = vi.fn(() => new Promise<string>((r) => { release = r; }));
    const fresh: boolean[] = [];
    const p = makePoller({ read, apply: () => {}, everyMs: () => 1000, onFresh: (f) => fresh.push(f) });
    p.start();
    expect(fresh).toEqual([false]);
    release('a');
    await vi.advanceTimersByTimeAsync(0);
    expect(fresh).toEqual([false, true]);
    p.kick();
    expect(fresh).toEqual([false, true, false]);
    release('b');
    await vi.advanceTimersByTimeAsync(0);
    p.kick(true); // 주기만 바뀔 때 — 표시 없이
    expect(fresh).toEqual([false, true, false, true]);
    p.stop();
  });
});

describe('makePoller — 막 시작한 요청은 안 끊는다(돌아옴 신호가 250ms 차로 두 번 와도)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('1.5초 안에 시작한 요청은 kick 이 끊지 않고, 끝나면 바로 한 번 더', async () => {
    const reqs: { resolve: (v: string) => void; signal: AbortSignal }[] = [];
    const read = vi.fn((signal: AbortSignal) => new Promise<string>((resolve) => reqs.push({ resolve, signal })));
    const apply = vi.fn();
    const p = makePoller({ read, apply, everyMs: () => 10_000 });
    p.start();
    await vi.advanceTimersByTimeAsync(300);
    p.kick(); // 막 시작한 요청 — 안 끊음
    expect(reqs[0]!.signal.aborted).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    reqs[0]!.resolve('a');
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).toHaveBeenCalledWith('a');
    expect(read).toHaveBeenCalledTimes(2); // 10초 안 기다리고 바로
    p.stop();
  });
});
