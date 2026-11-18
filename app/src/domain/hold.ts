// 길게 누르기 — 폰·패드의 길게 누르기 메뉴(밀기 줄·보관함 칸·말풍선·팀 파일)가 다 같은 때로.
// 사파리는 0.5초쯤 누르면 글 고르기(파란 블록)·확대경·공유 말풍선을 띄운다 — 우리 메뉴가 그보다 먼저 떠야 '길게 누른 동작'으로 느껴진다(11-18 사용자 아이패드)

/** 메뉴가 뜨는 때 — 사파리 글 고르기(약 0.5초)보다 먼저 */
export const HOLD_MS = 450;
/** 이만큼 가만히 누르고 있으면 눌린 느낌(작아짐·어두워짐) — 짧은 누름·스크롤 시작엔 안 보이게 */
export const PRESS_MS = 120;
/** 이보다 움직이면 스크롤로 보고 길게 누르기를 접는다 */
export const MOVE_PX = 8;

export const holdMoved = (dx: number, dy: number) => Math.hypot(dx, dy) > MOVE_PX;

type Closest = { closest?: (sel: string) => unknown } | null | undefined;
/** 사파리 기본 동작(글 고르기 시작·기본 메뉴)을 막을 자리인가 — 길게 누르기 대상 안, 그 안의 글 칸은 빼고 */
export function blocksNative(target: Closest): boolean {
  if (!target?.closest) return false;
  return !!target.closest('[data-hold]') && !target.closest('[data-hold-text]');
}
