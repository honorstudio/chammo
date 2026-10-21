import { describe, expect, it } from 'vitest';
import { hangulFit, HANGUL_FIT, termFont } from './termFont';

describe('터미널 한글 칸 — 윈도우에서 한글 칸이 벌어졌다(2026-10-22 윈도우 QA 31: 시험 PC 실측 Cascadia W 7.03px, 한글 12px)', () => {
  it('재현 값: 12px 에 칸 7.03px 면 한글을 117% 로 키워 두 칸(14.06px)을 채운다', () => {
    expect(hangulFit(7.03125, 12)).toBe(117.2);
    expect(hangulFit(6.59765625, 12)).toBe(110); // Consolas
  });
  it('이상한 값은 그대로(100)', () => {
    expect(hangulFit(0, 12)).toBe(100);
    expect(hangulFit(20, 12)).toBe(100);
    expect(hangulFit(NaN, 12)).toBe(100);
  });
  it('윈도우만 맞춘 글꼴, 맥은 그대로', () => {
    expect(termFont(true)).toContain(`"${HANGUL_FIT}"`);
    expect(termFont(true)).not.toContain('"Chammo Hangul",');
    expect(termFont(false)).toContain('"Chammo Hangul"');
    expect(termFont(false)).not.toContain(HANGUL_FIT);
  });
});
