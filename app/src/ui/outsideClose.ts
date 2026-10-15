/**
 * 팝오버·메뉴 바깥 누름에 닫기 — 창에서 capture 로 pointerdown·mousedown 둘 다 본다.
 * 버블링으로 받으면 채팅 칸처럼 onMouseDown 에서 stopPropagation 하는 칸을 눌렀을 때 신호가 안 와 메뉴가 남았다
 * (2026-10-12 209.png 도우미 묶음 메뉴). pointerdown 을 preventDefault 하는 칸은 mousedown 이 안 오니 둘 다 듣는다.
 * inside = 그 누름이 팝오버 안쪽(또는 여닫는 단추)이면 true — 안쪽은 안 닫는다. 돌려주는 함수가 정리
 */
export function closeOnOutside(target: EventTarget, inside: (t: EventTarget | null) => boolean, close: () => void): () => void {
  const down = (e: Event) => { if (!inside(e.target)) close(); };
  const cap = { capture: true };
  target.addEventListener('pointerdown', down, cap);
  target.addEventListener('mousedown', down, cap);
  return () => { target.removeEventListener('pointerdown', down, cap); target.removeEventListener('mousedown', down, cap); };
}
