// 패드 화면 배치 — 기기 이름이 아니라 지금 창 폭으로(11-18 사용자 '추천대로': 가로 = 맥 그대로 3칸, 세로 = 띠 + 채팅 + 밀어 여는 판, 좁으면 폰 그대로)
import { describe, expect, it } from 'vitest';
import { padMode } from './padLayout';

describe('padMode — 폭으로 나눈다', () => {
  it('폰은 그대로 — 세로·가로 모두(아이폰 가로 844×390 도 높이가 낮아 폰)', () => {
    expect(padMode(390, 844)).toBe('phone');
    expect(padMode(844, 390)).toBe('phone');
    expect(padMode(430, 932)).toBe('phone');
    expect(padMode(932, 430)).toBe('phone');
  });
  it('패드 가로(11"·13")는 3칸', () => {
    expect(padMode(1194, 834)).toBe('wide');
    expect(padMode(1180, 820)).toBe('wide');
    expect(padMode(1376, 1032)).toBe('wide');
  });
  it('13" 세로(1032)도 3칸, 11" 세로(834·820)는 띠 + 채팅', () => {
    expect(padMode(1032, 1376)).toBe('wide');
    expect(padMode(834, 1194)).toBe('two');
    expect(padMode(820, 1180)).toBe('two');
    expect(padMode(744, 1133)).toBe('two'); // iPad mini 세로
  });
  it('분할 화면·슬라이드 오버(700 밑)는 폰 그대로', () => {
    expect(padMode(678, 834)).toBe('phone');
    expect(padMode(507, 834)).toBe('phone');
    expect(padMode(320, 834)).toBe('phone');
  });
  it('읽기 전(0)이나 이상한 값은 폰 — 폰 화면을 잘못 바꾸지 않게', () => {
    expect(padMode(0, 0)).toBe('phone');
    expect(padMode(Number.NaN, 900)).toBe('phone');
  });
});
