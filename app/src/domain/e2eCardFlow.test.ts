// 허용 카드 숫자 흐름 — 10-27 사용자: 무인 아이맥 채팅 뷰가 카드를 그리자마자 난수(nM)를 내 자리를 잡았고,
// 맥북 종 카드는 busy 를 삼키고 '기다려요'에 갇혔다. 2초마다 망 요청 셋을 쏘다 중계 한도(429)에 걸려 카드도 안 닫혔다
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cardFlow, readyEvery, type CardState } from './e2eCardFlow';
import type { CardMode, NumberApi } from './e2eNumber';

type Opened = { mode: CardMode; code: string; mine: boolean };
const opened = (mode: CardMode, mine = false): Opened => ({ mode, code: '', mine });

function fakeApi(first: Opened = opened('number')) {
  const calls = { open: 0, claim: 0, ready: 0 };
  let openRes: Opened = first;
  let claimRes: () => Promise<Opened> = () => Promise.resolve(opened('number', true));
  let readyRes = false;
  const api: NumberApi = {
    open: () => { calls.open++; return Promise.resolve(openRes); },
    claim: () => { calls.claim++; return claimRes(); },
    ready: () => { calls.ready++; return Promise.resolve(readyRes); },
    approve: () => Promise.resolve('0420'),
    op: () => Promise.resolve(),
  };
  return {
    api, calls,
    setOpen: (o: Opened) => { openRes = o; },
    setClaim: (f: () => Promise<Opened>) => { claimRes = f; },
    setReady: (r: boolean) => { readyRes = r; },
  };
}

function run(f: ReturnType<typeof fakeApi>) {
  let st: CardState = { mode: 'loading', code: '', ready: false, mine: false, err: '' };
  const flow = cardFlow('mac2', f.api, (s) => { st = s; });
  flow.start();
  return { flow, now: () => st };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('허용 카드 숫자 흐름', () => {
  it('카드를 그리기만 해서는 난수를 안 낸다 — 사람이 칸을 누를 때까지 중계에 아무것도 안 묻는다', async () => {
    const f = fakeApi();
    const { now } = run(f);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(now().mode).toBe('number');
    expect(now().mine).toBe(false);
    expect(f.calls).toEqual({ open: 1, claim: 0, ready: 0 });
  });

  it('사람 손(진짜 클릭)에서만 claim — 쥔 뒤에야 숫자 준비를 묻고, 준비되면 멈춘다', async () => {
    const f = fakeApi();
    const { flow, now } = run(f);
    await vi.advanceTimersByTimeAsync(0);
    flow.claim(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.calls.claim).toBe(0);
    flow.claim(true);
    flow.claim(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls.claim).toBe(1);
    expect(now().mine).toBe(true);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(f.calls.ready).toBeGreaterThan(0);
    f.setReady(true);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(now().ready).toBe(true);
    const n = f.calls.ready;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.calls.ready).toBe(n);
  });

  it('다른 기기가 먼저 쥐었으면(busy) 이유를 보이고 조용히 다시 쏘지 않는다', async () => {
    const f = fakeApi();
    f.setClaim(() => Promise.reject(new Error('다른 기기에서 이 기기를 확인하고 있어')));
    const { flow, now } = run(f);
    await vi.advanceTimersByTimeAsync(0);
    flow.claim(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(now().err).toContain('다른 기기에서');
    expect(now().mode).toBe('number');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.calls).toEqual({ open: 1, claim: 1, ready: 0 });
    // 새 기기 '숫자 다시' 뒤 사람이 다시 누르면 이번엔 쥔다
    f.setClaim(() => Promise.resolve(opened('number', true)));
    flow.claim(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(now()).toMatchObject({ mine: true, err: '' });
  });

  it('숫자를 오래 기다리면 묻는 사이를 늘린다 — 10분에 중계 한도(기기당 300)의 1/3 밑', async () => {
    const f = fakeApi();
    const { flow } = run(f);
    await vi.advanceTimersByTimeAsync(0);
    flow.claim(true);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(f.calls.ready).toBeLessThan(100);
    expect(readyEvery(0)).toBe(2000);
    expect(readyEvery(100)).toBeGreaterThan(2000);
  });

  it('새 컴퓨터가 봉인 전(wait)이면 망 없는 열기만 되풀이하고, 그새 누른 사람 뜻은 숫자 갈래가 되면 이어 간다', async () => {
    const f = fakeApi(opened('wait'));
    const { flow, now } = run(f);
    await vi.advanceTimersByTimeAsync(0);
    flow.claim(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls.claim).toBe(0);
    f.setOpen(opened('number'));
    await vi.advanceTimersByTimeAsync(2_100);
    expect(f.calls.claim).toBe(1);
    expect(now().mine).toBe(true);
  });

  it('이 기기가 이미 쥔 카드(mine)를 다시 그리면 누르지 않아도 숫자 기다림을 이어 간다', async () => {
    const f = fakeApi(opened('number', true));
    const { now } = run(f);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(f.calls.claim).toBe(0);
    expect(f.calls.ready).toBeGreaterThan(0);
    expect(now().mine).toBe(true);
  });

  it('멈추면(stop) 더는 묻지 않는다', async () => {
    const f = fakeApi(opened('wait'));
    const { flow } = run(f);
    await vi.advanceTimersByTimeAsync(0);
    flow.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.calls.open).toBe(1);
  });
});
