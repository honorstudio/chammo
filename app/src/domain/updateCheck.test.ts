import { describe, expect, it } from 'vitest';
import hook from '../ui/useUpdates.ts?raw';
import { dueCheck, EVERY_MS, SHOWN_GAP_MS, TICK_MS, updateChecker } from './updateCheck';

const MIN = 60 * 1000;
const H = 60 * MIN;

// 2026-10-24 PM PC 제보: 새 판이 나와도 배너가 안 뜨고, 앱을 다 끄고 다시 켜야 떴다 — 켤 때 한 번 + 6시간 타이머뿐이었다
describe('updateChecker — 켜져 있는 동안에도 새 판을 놓치지 않게', () => {
  function sim() {
    let t = 0;
    let calls = 0;
    const c = updateChecker(() => { calls++; }, () => t);
    return { c, at: (ms: number) => { t = ms; }, calls: () => calls };
  }

  it('켜자마자 한 번', () => {
    const s = sim();
    expect(s.c.start()).toBe(true);
    expect(s.calls()).toBe(1);
  });

  it('창이 다시 앞에 오면(다시 켜기·독·포커스) 확인한다', () => {
    const s = sim();
    s.c.start();
    s.at(30 * MIN);
    expect(s.c.shown()).toBe(true);
    expect(s.calls()).toBe(2);
  });

  it('앞에 오는 게 잦아도 한도 안에서만 친다', () => {
    const s = sim();
    s.c.start();
    s.at(SHOWN_GAP_MS - 1);
    expect(s.c.shown()).toBe(false);
    s.at(SHOWN_GAP_MS);
    expect(s.c.shown()).toBe(true);
    expect(s.calls()).toBe(2);
  });

  it('잠자기를 껴도 벽시계로 잰다 — 깨어난 뒤 첫 짧은 틱에서 친다', () => {
    const s = sim();
    s.c.start();
    // 타이머는 잠든 동안 안 흐른다(맥 mach_absolute_time·윈도우 QPC) — 짧은 틱이 벽시계로 지났는지 본다
    s.at(TICK_MS);
    expect(s.c.tick()).toBe(false);
    s.at(8 * H);
    expect(s.c.tick()).toBe(true);
  });

  it('틱은 확인 주기 전엔 안 친다(앞에 와서 친 것도 센다)', () => {
    const s = sim();
    s.c.start();
    s.at(EVERY_MS - 1);
    expect(s.c.tick()).toBe(false);
    s.at(EVERY_MS);
    expect(s.c.tick()).toBe(true);
    s.at(EVERY_MS + 20 * MIN);
    expect(s.c.shown()).toBe(true);
    s.at(2 * EVERY_MS);
    expect(s.c.tick()).toBe(false);
  });
});

describe('주기·한도 값', () => {
  it('켜져 있으면 몇 시간 안에, 깨어나면 15분 안에 확인', () => {
    expect(EVERY_MS).toBeLessThanOrEqual(3 * H);
    expect(TICK_MS).toBeLessThanOrEqual(15 * MIN);
  });
  it('GitHub 비로그인 한도(IP 당 시간 60번)를 사무실 여럿이 나눠 써도 — 한 앱이 시간당 4번 넘게 안 친다', () => {
    expect(SHOWN_GAP_MS).toBeGreaterThanOrEqual(15 * MIN);
    expect(dueCheck(0, SHOWN_GAP_MS - 1, 'shown')).toBe(false);
  });
  it('켤 때는 한도와 상관없이 친다', () => {
    expect(dueCheck(0, 1, 'start')).toBe(true);
    expect(dueCheck(null, 0, 'tick')).toBe(true);
  });
  it('시계가 뒤로 가면(시간 맞춤) 기다리지 않고 친다', () => {
    expect(dueCheck(10 * H, 9 * H, 'tick')).toBe(true);
  });
});

// 훅은 DOM 없이 못 돌려서(jsdom 없음) 이어 붙인 자리만 본다
describe('useUpdates 가 판단을 거쳐 부른다', () => {
  it('짧은 틱과 창이 앞에 올 때 둘 다 붙어 있다', () => {
    expect(hook).toMatch(/setInterval\(c\.tick, TICK_MS\)/);
    expect(hook).toMatch(/onShown\(\(v\) => \{ if \(v\) c\.shown\(\); \}\)/);
  });
});
