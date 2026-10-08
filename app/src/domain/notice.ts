// 폰 결과·오류 알림 모달(ui/mobile/Notice)이 저절로 닫히는 때 — 정보는 읽을 만큼(4~8초), 오류·할 일이 붙은 안내는 사람이 닫을 때까지(null)
const MIN_MS = 4000;
const MAX_MS = 8000;
const PER_CHAR_MS = 60;

export function noticeCloseMs({ text, error, action = false }: { text: string; error: boolean; action?: boolean }): number | null {
  if (error || action) return null;
  return Math.min(MAX_MS, Math.max(MIN_MS, 1500 + text.length * PER_CHAR_MS));
}
