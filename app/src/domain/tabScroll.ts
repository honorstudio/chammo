/** 넘친 탭 줄 양 끝에 까는 흐림 폭(px) — 그 밑에 걸린 탭은 반쯤 가려 보여서, 고른 탭은 흐림 밖까지 굴린다(2026-10-10 사용자) */
export const TAB_FADE = 28;

/** 가로로 넘치는 탭 줄에서 고른 탭이 보이게 할 scrollLeft — 이미 다 보이면 null(안 움직임).
 *  ⌘1~9 로 탭을 고르면 줄이 따라가지 않아 고른 탭이 화면 밖에 남던 것(2026-10-09 사용자). 좌표는 화면 기준(getBoundingClientRect) */
export function tabScrollLeft(box: { left: number; width: number; scrollLeft: number }, tab: { left: number; width: number }): number | null {
  const under = box.left + TAB_FADE - tab.left;
  if (under > 0) return Math.max(0, box.scrollLeft - under);
  const over = tab.left + tab.width - (box.left + box.width - TAB_FADE);
  if (over > 0) return box.scrollLeft + over;
  return null;
}

/** 탭 줄 양 끝 너머에 탭이 더 있나 — 흐림을 어느 쪽에 깔지. 레티나에서 scrollLeft 가 소수라 1px 은 끝으로 친다 */
export function tabEdges(el: { scrollLeft: number; scrollWidth: number; clientWidth: number }): { left: boolean; right: boolean } {
  return { left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 };
}

/** 탭 최소 폭(chat.css [role=tab] min-width 와 같은 값) — 프사만 남는 폭 */
export const TAB_MIN = 34;
/** × 를 올렸을 때만 띄우는 문턱 — 안 고른 탭 몫이 이보다 좁으면(이름이 몇 글자뿐) */
export const TAB_TIGHT = 136;

/** 탭 줄이 좁나 — 안 고른 탭 하나에 돌아갈 몫이 최소 폭 + 28px 아래면 좁다. 좁으면 안 고른 탭의 × 는 올렸을 때만 이름 위에 뜬다
 *  (최소 폭에서 × 가 글자 자리를 먹어 이름이 두 글자만 보였다, 2026-10-10 사용자 PC). 탭 폭이 아니라 줄 폭으로 재서
 *  × 를 빼고 넣어도 값이 안 바뀐다 — 롤오버·전환에 탭이 출렁이지 않는다. row = 탭 줄 안쪽 폭, add = + 버튼, active = 고른 탭 */
export function tabsTight(m: { row: number; add: number; active: number; gap: number; n: number }): boolean {
  if (m.n < 2) return false;
  const room = (m.row - m.add - m.gap - m.active) / (m.n - 1) - m.gap;
  return room < TAB_TIGHT;
}
