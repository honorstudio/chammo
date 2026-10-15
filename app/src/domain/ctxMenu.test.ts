import { describe, expect, it } from 'vitest';
import { menuPos, menuStep, trailingClick } from './ctxMenu';

// 앱 공용 오른쪽 클릭 메뉴(OrchDialogs ContextMenu) — 화면 밖으로 안 넘치게, 화살표로 오르내리기
describe('menuPos — 누른 자리에서 화면 안으로', () => {
  it('넉넉하면 누른 자리 그대로', () => {
    expect(menuPos(100, 100, 200, 150, 1440, 900)).toEqual({ left: 100, top: 100 });
  });
  it('오른쪽 끝에서 누르면 왼쪽으로 펼친다(맥 메뉴처럼)', () => {
    expect(menuPos(1400, 100, 200, 150, 1440, 900)).toEqual({ left: 1200, top: 100 });
  });
  it('아래 끝에서 누르면 위로 펼친다', () => {
    expect(menuPos(100, 850, 200, 300, 1440, 900)).toEqual({ left: 100, top: 550 });
  });
  it('위로 펼쳐도 넘치면 화면 위 여백에 붙는다', () => {
    expect(menuPos(100, 200, 200, 600, 1440, 700)).toEqual({ left: 100, top: 8 });
  });
  it('창보다 길면 위 여백에 붙이고 높이를 잘라 스크롤', () => {
    expect(menuPos(100, 300, 200, 1000, 1440, 700)).toEqual({ left: 100, top: 8, maxHeight: 684 });
  });
  it('좁은 창에서도 왼쪽 여백 밖으로 안 나간다', () => {
    expect(menuPos(150, 10, 200, 100, 300, 900).left).toBe(8);
  });
});

describe('menuStep — 화살표·Home·End', () => {
  it('아래·위는 끝에서 처음으로 돈다', () => {
    expect(menuStep(4, 0, 'ArrowDown')).toBe(1);
    expect(menuStep(4, 3, 'ArrowDown')).toBe(0);
    expect(menuStep(4, 0, 'ArrowUp')).toBe(3);
  });
  it('아무것도 안 골랐을 때 — 아래는 처음, 위는 끝', () => {
    expect(menuStep(4, -1, 'ArrowDown')).toBe(0);
    expect(menuStep(4, -1, 'ArrowUp')).toBe(3);
  });
  it('Home·End', () => {
    expect(menuStep(4, 2, 'Home')).toBe(0);
    expect(menuStep(4, 1, 'End')).toBe(3);
  });
  it('다른 키·빈 메뉴는 그대로', () => {
    expect(menuStep(4, 2, 'a')).toBe(2);
    expect(menuStep(0, -1, 'ArrowDown')).toBe(-1);
  });
});

// 2026-10-12 사용자(참모-2 전달, 191.png): 보관함에서 우클릭하면 먼저 왼쪽 클릭처럼 파일이 열리고 메뉴가 그 위에 떴다 —
// 맥 웹뷰는 우클릭(두 손가락·ctrl+클릭) 뒤에 click 을 하나 더 보낸다. 메뉴를 연 직후 메뉴 밖으로 오는 click 은 삼킨다
describe('trailingClick — 우클릭 뒤따라오는 click 인가(삼킨다)', () => {
  it('메뉴를 연 직후(0.4초 안)의 click', () => {
    expect(trailingClick({ button: 0, ctrlKey: false }, 30)).toBe(true);
    expect(trailingClick({ button: 0, ctrlKey: false }, 390)).toBe(true);
  });
  it('맥 ctrl+클릭·오른쪽 버튼 click 은 언제든', () => {
    expect(trailingClick({ button: 0, ctrlKey: true }, 5000)).toBe(true);
    expect(trailingClick({ button: 2, ctrlKey: false }, 5000)).toBe(true);
  });
  it('조금 뒤 보통 click 은 그대로(메뉴 고르기·다른 곳 누르기)', () => {
    expect(trailingClick({ button: 0, ctrlKey: false }, 600)).toBe(false);
  });
});
