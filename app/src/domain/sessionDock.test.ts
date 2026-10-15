import { describe, expect, it } from 'vitest';
import { DOCK_DEFAULT, DOCK_MIN, RAIL_DEFAULT, dockHeight, railWidth } from './sessionDock';

// 2026-10-12 패널 하나로 S2 — 세션 독 펼침 높이는 위 손잡이로 끌어 정하고 앱 전체 한 값으로 기억(기본 240, 최소 140, 최대 가운데의 60%)
describe('dockHeight — 독 펼침 높이', () => {
  it('기억이 없으면 기본 240', () => {
    expect(DOCK_DEFAULT).toBe(240);
    expect(dockHeight(null, 800)).toBe(240);
  });
  it('최소 140', () => {
    expect(DOCK_MIN).toBe(140);
    expect(dockHeight(60, 800)).toBe(140);
  });
  it('최대 가운데 높이의 60%', () => {
    expect(dockHeight(700, 800)).toBe(480);
    expect(dockHeight(300, 800)).toBe(300);
  });
  it('가운데가 아주 낮으면 최소가 이긴다', () => expect(dockHeight(300, 200)).toBe(140));
  it('숫자가 아니면 기본', () => expect(dockHeight(Number.NaN, 800)).toBe(240));
});

// 2026-10-12 사용자(참모-2 전달, 191.png): 펼친 띠가 맡은 일 글 길이만큼 늘어나 490px 까지 갔고 크기도 못 바꿨다 —
// 기본 240, 오른쪽 손잡이로 끌어 200~360, 앱 전체 한 값
describe('railWidth — 펼친 띠 폭', () => {
  it('기억이 없으면 240', () => expect(railWidth(null)).toBe(RAIL_DEFAULT));
  it('200 ~ 360 사이로', () => {
    expect(RAIL_DEFAULT).toBe(240);
    expect(railWidth(120)).toBe(200);
    expect(railWidth(490)).toBe(360);
    expect(railWidth(280)).toBe(280);
    expect(railWidth(Number.NaN)).toBe(240);
  });
});
