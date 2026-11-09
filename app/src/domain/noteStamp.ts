// 폰: 맥 메모 폴더 도장 — 폰이 3초마다 받는 세션 목록 머리줄(mobile_http /api/sessions notes)에 실려 온다(2026-11-08 폰 메모 실시간).
// 바뀌면 열려 있는 메모 탭이 목록만 다시 받고, 고친 시각이 달라진 카드만 다시 받는다. 요청은 안 는다 — 세션 목록은 어차피 받는다
let stamp: string | null = null;
const subs = new Set<(s: string) => void>();

/** 받은 도장 — 같으면 알리지 않는다. 처음 본 것도 알린다: 메모 탭이 목록을 받은 뒤 첫 도장 전에 맥이 고쳤으면 그걸 놓친다(메모 탭이 떠 있을 때 페이지마다 목록 한 번 더) */
export function seeNoteStamp(s: string | undefined): void {
  if (typeof s !== 'string' || s === stamp) return;
  stamp = s;
  subs.forEach((f) => f(s));
}

/** 도장이 바뀌면 — 끄는 함수를 돌려준다 */
export function onNoteStamp(f: (s: string) => void): () => void {
  subs.add(f);
  return () => { subs.delete(f); };
}

/** 시험용 — 처음 상태로 */
export function resetNoteStamp(): void {
  stamp = null;
  subs.clear();
}
