// 기능 화면(예약·리플레이·도구·하니터·리뷰) Esc 닫기 판단 — 화면 밖 판단은 부르는 쪽이 채운다(2026-11-01 사용자)

export type PaneEsc = {
  key: string;
  /** 한글 조합 중 */
  composing: boolean;
  /** 다른 곳(채팅 멈추기·찾기 막대 등)이 이미 쓴 Esc */
  prevented: boolean;
  /** 글 칸·터미널·문서 편집기에서 누름 — 그 칸 것 */
  editable: boolean;
  /** 위에 뜬 창(더보기 펼침·확인 창·미리보기)이 있음 — 그 창이 먼저 */
  overlay: boolean;
};

export function paneEscCloses(e: PaneEsc): boolean {
  return e.key === 'Escape' && !e.composing && !e.prevented && !e.editable && !e.overlay;
}
