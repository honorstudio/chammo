import { describe, expect, it } from 'vitest';
import { ORCH_COLORS } from './avatar';
import { contrast, mix, orchVars } from './orchTheme';

const LIGHT = { surface: '#ffffff', text: '#1d1d20' };
const DARK = { surface: '#1b1b1f', text: '#e7e7ea' };

describe('contrast — WCAG 대비', () => {
  it('검정·흰색 21:1, 같은 색 1:1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});

describe('orchVars — 참모 색 하나로 채팅 칸 변수 세트(밝은·어두운 둘 다 4.5:1)', () => {
  it.each(ORCH_COLORS)('%s', (c) => {
    const v = orchVars(c);
    expect(v['--orch']).toBe(c);
    // 꽉 찬 참모 색 위 글자(보내기 버튼·고른 탭) — 노랑처럼 밝으면 진한 글자
    expect(contrast(v['--orch-ink'], v['--orch-solid'])).toBeGreaterThanOrEqual(4.5);
    // 바탕 위 참모 색 글자(링크·칩·고른 탭 이름)
    expect(contrast(v['--orch-text-light'], LIGHT.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v['--orch-text-dark'], DARK.surface)).toBeGreaterThanOrEqual(4.5);
    // 내 말풍선 = 참모 색 14% + 바탕, 글자는 앱 글자색
    expect(contrast(LIGHT.text, mix(c, LIGHT.surface, 0.14))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DARK.text, mix(c, DARK.surface, 0.14))).toBeGreaterThanOrEqual(4.5);
  });
  it('꽉 찬 면(고른 탭 알약·보내기) 위 글자·프사 몸은 늘 흰색 — 모자라면 면을 진하게(2026-10-02 사용자 "초록 알약에 글자·프사가 묻힌다")', () => {
    for (const c of ORCH_COLORS) {
      const v = orchVars(c);
      expect(v['--orch-ink']).toBe('#ffffff');
      // 글자·몸(흰색)과 면, 그리고 흰 몸 위 눈(=면 색) 모두 4.5:1 — 밝은·어두운 테마 공통(면 색은 테마와 상관없다)
      expect(contrast('#ffffff', v['--orch-solid'])).toBeGreaterThanOrEqual(4.5);
    }
    expect(orchVars('#9b51e0')['--orch-solid']).toBe('#9b51e0'); // 이미 되는 색은 그대로
    expect(orchVars('#c98a00')['--orch-solid']).not.toBe('#c98a00'); // 노랑은 진하게
  });
  it('고르지 않은 쪽 알약(앱 글자색 면) 안 프사 — 몸 = 바탕색, 눈 = 테마별로 맞춘 참모 글자색', () => {
    for (const c of ORCH_COLORS) {
      const v = orchVars(c);
      expect(contrast(v['--orch-text-light'], LIGHT.surface)).toBeGreaterThanOrEqual(4.5); // 밝은: 검정 알약·흰 몸
      expect(contrast(v['--orch-text-dark'], DARK.surface)).toBeGreaterThanOrEqual(4.5); // 어두운: 흰 알약·어두운 몸
      expect(contrast(LIGHT.surface, LIGHT.text)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(DARK.surface, DARK.text)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('이상한 값이면 빈 세트(앱 강조색으로 떨어진다)', () => {
    expect(orchVars('red;x')).toEqual({});
  });
});
