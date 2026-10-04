import { afterEach, describe, expect, it, vi } from 'vitest';
import { debounce, dialLabel, dialStart, isLive, stepDial, viewPhase } from './voiceDial';

describe('목소리 다이얼 — 넘기면 바로 들린다(2026-10-02 목소리 고르기 시안 B)', () => {
  it('고른 목소리에서 시작, 안 골랐으면 기본 배정 목소리에서', () => {
    expect(dialStart('F2', 'M1')).toBe(6);
    expect(dialStart(null, 'F1')).toBe(5);
    expect(dialStart(null, undefined)).toBe(0);
  });
  it('끝에서 넘기면 처음으로, 처음에서 뒤로 넘기면 끝으로', () => {
    expect(stepDial(9, 1)).toBe(0);
    expect(stepDial(0, -1)).toBe(9);
    expect(stepDial(3, 1)).toBe(4);
  });
  it("이름은 F1·M1 그대로 — '여자/남자' 글자는 쓰지 않는다(사용자 '폭력적이다')", () => {
    expect(dialLabel('F2', 'M1')).toBe('F2');
    expect(dialLabel(null, 'M1')).toBe('기본 · M1');
    expect(dialLabel(null, undefined)).toBe('기본');
    expect(dialLabel('M3', 'M1')).not.toMatch(/여자|남자/);
  });
});

describe('들어 보기 상태 — 준비 중 · 재생 중 · 끝 · 멈춤', () => {
  it('내가 누른 번호의 상태만 본다. 아직 앞 번호면 준비 중', () => {
    expect(viewPhase(0, { id: 7, phase: 'playing' })).toBe('idle');
    expect(viewPhase(8, { id: 7, phase: 'playing' })).toBe('preparing');
    expect(viewPhase(8, { id: 8, phase: 'playing' })).toBe('playing');
    expect(viewPhase(8, { id: 8, phase: 'done' })).toBe('done');
  });
  it('준비 중·재생 중일 때만 계속 묻는다', () => {
    expect(isLive('preparing')).toBe(true);
    expect(isLive('playing')).toBe(true);
    expect(isLive('done')).toBe(false);
    expect(isLive('stopped')).toBe(false);
    expect(isLive('idle')).toBe(false);
  });
});

describe('debounce — 빨리 연달아 넘기면 마지막 것만 소리', () => {
  afterEach(() => vi.useRealTimers());
  it('300ms 안에 또 오면 앞 것은 버린다', () => {
    vi.useFakeTimers();
    const got: string[] = [];
    const d = debounce((v: string) => got.push(v), 300);
    d('F1'); vi.advanceTimersByTime(100);
    d('F2'); vi.advanceTimersByTime(100);
    d('F3'); vi.advanceTimersByTime(299);
    expect(got).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(got).toEqual(['F3']);
  });
  it('취소하면 아무것도 안 한다(창을 닫을 때)', () => {
    vi.useFakeTimers();
    const got: string[] = [];
    const d = debounce((v: string) => got.push(v), 300);
    d('M1'); d.cancel(); vi.advanceTimersByTime(500);
    expect(got).toEqual([]);
  });
});
