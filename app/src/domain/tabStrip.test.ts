import { describe, expect, it } from 'vitest';
import { keepInView, tabFade, wheelToX } from './tabStrip';

// 2026-10-22 사용자: 스페이스 탭이 넘치면 스크롤 막대가 탭 줄을 밀고, 홈·보관함·앱 고정 탭이 같이 밀려 사라졌다
describe('tabFade — 넘친 쪽 끝만 흐리게', () => {
  it('안 넘치면 양쪽 다 없음', () => {
    expect(tabFade(0, 500, 500)).toEqual({ l: false, r: false });
  });
  it('처음 = 오른쪽만, 가운데 = 양쪽, 끝 = 왼쪽만', () => {
    expect(tabFade(0, 1100, 740)).toEqual({ l: false, r: true });
    expect(tabFade(200, 1100, 740)).toEqual({ l: true, r: true });
    expect(tabFade(360, 1100, 740)).toEqual({ l: true, r: false });
  });
  it('소수점 스크롤(배율·트랙패드)도 끝으로 본다', () => {
    expect(tabFade(359.5, 1100, 740)).toEqual({ l: true, r: false });
    expect(tabFade(0.4, 1100, 740)).toEqual({ l: false, r: true });
  });
});

describe('wheelToX — 마우스 세로 휠을 가로 스크롤로', () => {
  it('세로가 더 크면 그만큼 가로로', () => {
    expect(wheelToX(0, 120)).toBe(120);
    expect(wheelToX(3, -80)).toBe(-80);
  });
  it('트랙패드 가로 밀기(가로가 더 큼)·움직임 없음은 그대로 둔다(0 = 브라우저 몫)', () => {
    expect(wheelToX(40, 10)).toBe(0);
    expect(wheelToX(0, 0)).toBe(0);
  });
  it('줄 단위 휠(deltaMode 1)은 줄 높이만큼', () => {
    expect(wheelToX(0, 3, 1)).toBe(3 * 32);
  });
});

describe('keepInView — 고른 탭이 보이게(새로 연 탭이 화면 밖이었다)', () => {
  it('이미 보이면 그대로', () => {
    expect(keepInView(0, 740, 100, 220)).toBe(0);
  });
  it('오른쪽 밖이면 그 탭 오른쪽 끝 + 여백까지', () => {
    expect(keepInView(0, 740, 969, 1089)).toBe(1089 + 24 - 740);
  });
  it('왼쪽 밖이면 그 탭 왼쪽 끝 - 여백까지(0 밑으로는 안 간다)', () => {
    expect(keepInView(300, 740, 130, 250)).toBe(130 - 24);
    expect(keepInView(300, 740, 10, 130)).toBe(0);
  });
  it('흐린 끝(여백) 안에 걸쳐도 꺼낸다', () => {
    expect(keepInView(0, 740, 600, 730)).toBe(730 + 24 - 740);
  });
});
