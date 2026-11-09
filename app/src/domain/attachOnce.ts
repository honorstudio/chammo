// 칸(요소)에 이벤트를 붙이되 같은 칸이면 그대로 둔다 — 렌더마다 떼고 붙이면 끄는 중 상태가 사라진다(그림 확대 끌기 끊김, 11-05 사용자)

export type Attached<E> = { el: E | null; off: (() => void) | null };

/** el 이 지난번과 같으면 아무것도 안 한다. 다르면 앞 것을 떼고(off) 새 칸에 붙인다(attach 가 떼는 함수를 돌려준다). null 이면 떼기만 */
export function attachOnce<E>(h: Attached<E>, el: E | null, attach: (el: E) => () => void): void {
  if (h.el === el) return;
  h.off?.();
  h.off = null;
  h.el = el;
  if (el !== null) h.off = attach(el);
}
