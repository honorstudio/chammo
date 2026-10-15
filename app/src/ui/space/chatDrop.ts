// 채팅 칸 어디든 끌어 놓기(2026-10-12 사용자 "채팅 칸에 하이라이트 정도만 돼도 끌어서 넣어져야") — 보관함 카드·목록·기록 줄·칩·예약(dragPath),
// 띠 프사 @멘션(OrchRail), 맥 파인더 파일(fileDrop)이 같이 쓴다. 채팅 칸(머리·대화 기록·입력칸·카드 여백) 위면 칸 전체를 강조하고, 놓으면 그 칸 세션 입력칸에
import { chatCellAt } from '../../domain/drop';

export type ChatDrop = { id: string; hot: HTMLElement; color: string };

/** 그 점이 채팅 칸 안이면 받을 세션과 강조할 자리(채팅 카드, 없으면 칸) — 탭 보기 뒤에 숨긴 창(.cell.behind)은 뺀다 */
export function chatDropAt(x: number, y: number): ChatDrop | null {
  const col = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('.office-chats');
  if (!col) return null;
  const cells = [...col.querySelectorAll<HTMLElement>('.cell[data-session]')].filter((c) => !c.classList.contains('behind'));
  const id = chatCellAt(cells.map((c) => { const r = c.getBoundingClientRect(); return { id: c.dataset.session ?? '', left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }), x, y);
  const cell = cells.find((c) => c.dataset.session === id);
  if (!id || !cell) return null;
  return { id, hot: col.querySelector<HTMLElement>(':scope > .och-card') ?? col, color: getComputedStyle(cell).getPropertyValue('--orch').trim() };
}

// 강조는 한 번에 한 자리 — 끌기(스페이스·띠)와 파인더 끌기가 같은 자리를 쓴다. 색은 받을 세션 참모 색(--drop)
let lit: HTMLElement | null = null;
export function lightChat(t: ChatDrop | null) {
  const el = t?.hot ?? null;
  if (lit && lit !== el) { lit.classList.remove('drop-hot'); lit.style.removeProperty('--drop'); }
  if (el) { el.classList.add('drop-hot'); if (t!.color) el.style.setProperty('--drop', t!.color); else el.style.removeProperty('--drop'); }
  lit = el;
}
