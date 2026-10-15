// 모드 안 '뒤로'(2026-10-15 사용자 B 확정, docs/design-drafts/mode-nav-v1) — 칸 머리엔 X 가 없고(끄기는 ⋯ 메뉴), 뒤로는 모드가 그린 키트 BackBar 하나.
// 앱은 그 단추(key mode-back)를 모든 모드에서 같은 모양으로 그리고, 폰은 칸 왼쪽 끝에서 오른쪽으로 밀면 그 단추를 누른다.

/** 키트 BackBar 의 단추 key(hq-mode-kit kit.tsx) */
export const BACK_KEY = 'mode-back';

/** 뒤로 단추 글 — 앞 ‹ 를 떼고 돌아갈 곳만(앱은 ‹ 를 아이콘으로). 글이 없으면 label('뒤로 — 오늘')에서 */
export function backText(text: string, label: string): string {
  const t = text.replace(/^\s*‹\s*/, '').trim();
  if (t) return t;
  return label.replace(/^\s*뒤로\s*—\s*/, '').trim();
}

type Pt = { x: number; y: number };
/** 칸 왼쪽 끝(24px 안)에서 시작해 오른쪽으로 60px 넘게, 세로 흔들림은 가로의 절반 아래 — 세로 스크롤·가운데 밀기와 안 섞이게 */
export function edgeSwipe(card: { left: number; width: number }, from: Pt, to: Pt): boolean {
  const dx = to.x - from.x, dy = Math.abs(to.y - from.y);
  return from.x - card.left <= 24 && from.x >= card.left - 8 && dx >= 60 && dy < dx * 0.5;
}
