// 길게 누르기 — 폰·패드에서 길게 누르면 우리 메뉴가 사파리 글 고르기(파란 블록)·확대경·공유 말풍선보다 먼저(11-18 사용자 아이패드
// "길게 누른 액션 느낌이 아니라 그냥 블록 지정이 되어 버림")
import { describe, expect, it } from 'vitest';
import { blocksNative, HOLD_MS, holdMoved, MOVE_PX, PRESS_MS } from './hold';

/** closest 만 흉내 낸 가짜 요소 — 조상 줄을 속성 이름 목록으로 */
const el = (...attrs: string[][]) => ({ closest: (sel: string) => (attrs.some((a) => a.some((x) => sel.split(',').map((s) => s.trim()).includes(`[${x}]`))) ? {} : null) });

describe('길게 누르기 때', () => {
  it('사파리 글 고르기(약 0.5초)보다 먼저 뜬다 — 그래도 짧은 누름과는 갈리게 0.4초는 넘는다', () => {
    expect(HOLD_MS).toBeLessThan(500);
    expect(HOLD_MS).toBeGreaterThanOrEqual(400);
  });
  it('눌린 느낌은 그보다 먼저, 짧은 누름·스크롤엔 안 보이게 0.1초는 지나서', () => {
    expect(PRESS_MS).toBeGreaterThanOrEqual(100);
    expect(PRESS_MS).toBeLessThan(HOLD_MS - 200);
  });
  it('조금 떨리는 건 누름, 그보다 움직이면 스크롤로 보고 접는다', () => {
    expect(holdMoved(3, 4)).toBe(false);
    expect(holdMoved(MOVE_PX, 0)).toBe(false);
    expect(holdMoved(MOVE_PX + 1, 0)).toBe(true);
    expect(holdMoved(0, -12)).toBe(true);
  });
});

describe('사파리 기본 동작 막기', () => {
  it('길게 누르기 대상 안에서 시작한 글 고르기·기본 메뉴는 막는다', () => {
    expect(blocksNative(el(['data-hold']))).toBe(true);
  });
  it('대상 밖(파일 글·팀 대화 글)은 그대로 — 글을 골라 복사할 수 있어야 한다', () => {
    expect(blocksNative(el([]))).toBe(false);
    expect(blocksNative(null)).toBe(false);
    expect(blocksNative({})).toBe(false);
  });
  it('대상 안이라도 글 칸(입력칸)은 그대로', () => {
    expect(blocksNative(el(['data-hold'], ['data-hold-text']))).toBe(false);
  });
});
