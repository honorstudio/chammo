import { describe, expect, it } from 'vitest';
import { attended, IDLE_MS, idleLeft, nextBlinkMs } from './attention';

describe('attended — 사람이 앱을 보고 있나(아바타를 움직일까, 2026-10-04 mac-perf)', () => {
  const base = { hidden: false, focused: true, lidClosed: false, lastInput: 1_000, now: 1_000 };
  it('앞에 있고 방금 입력했으면 본다', () => expect(attended(base)).toBe(true));
  it('창이 숨으면 안 본다', () => expect(attended({ ...base, hidden: true })).toBe(false));
  it('앱이 맨 앞이 아니면 안 본다(다른 앱을 보는 중)', () => expect(attended({ ...base, focused: false })).toBe(false));
  it('입력이 2분 없으면 안 본다 — 덮개를 닫으면 창이 가짜 화면에 보이는 채로 남아 숨음이 안 걸린다', () => {
    expect(attended({ ...base, now: base.lastInput + IDLE_MS - 1 })).toBe(true);
    expect(attended({ ...base, now: base.lastInput + IDLE_MS })).toBe(false);
  });
  it('덮개를 닫으면 2분을 안 기다리고 바로 안 본다 — 앞 창·방금 입력이어도(2026-10-05)', () => {
    expect(attended({ ...base, lidClosed: true })).toBe(false);
  });
  it('덮개를 열면 다른 조건대로 — 앞 창·입력이 맞으면 보고, 아니면 여전히 안 본다', () => {
    expect(attended({ ...base, lidClosed: false })).toBe(true);
    expect(attended({ ...base, lidClosed: false, focused: false })).toBe(false);
    expect(attended({ ...base, lidClosed: false, now: base.lastInput + IDLE_MS })).toBe(false);
  });
  it('2분 뒤 첫 입력이 오면 바로 다시 본다', () => {
    const now = base.lastInput + IDLE_MS * 3;
    expect(attended({ ...base, now })).toBe(false);
    expect(attended({ ...base, lastInput: now, now })).toBe(true);
  });
});

describe('idleLeft — 2분이 차기까지 남은 시간(타이머 하나로 잰다)', () => {
  it('남은 만큼', () => expect(idleLeft(0, 30_000)).toBe(IDLE_MS - 30_000));
  it('이미 지났으면 0', () => expect(idleLeft(0, IDLE_MS * 2)).toBe(0));
});

describe('nextBlinkMs — 깜빡임은 6~8초에 한 번(사용자 2026-10-04, 예전엔 일할 때 1.5초마다)', () => {
  it('0 → 6초, 1에 가까우면 8초 아래', () => {
    expect(nextBlinkMs(0)).toBe(6_000);
    expect(nextBlinkMs(0.999)).toBeLessThan(8_000);
    expect(nextBlinkMs(0.999)).toBeGreaterThanOrEqual(7_990);
  });
  it('이상한 값은 6~8초 안으로', () => {
    for (const r of [-1, 2, Number.NaN]) {
      const v = nextBlinkMs(r);
      expect(v).toBeGreaterThanOrEqual(6_000);
      expect(v).toBeLessThanOrEqual(8_000);
    }
  });
});
