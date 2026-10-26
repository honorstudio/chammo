// 홈 대시보드 띄움(2026-10-24 사용자 시안 home-inplace v1 A) — 홈에서 누른 것은 홈 안에서: 참모 미니 대화·결정 펼침·세션 한눈·끝남 한 줄·기능 서랍.
// 한 번에 하나만 — 다른 것을 누르면 앞의 것이 닫히고, 같은 것을 다시 누르거나 Esc·바깥을 누르면 닫힌다
/** chat = 참모 id · ask = 결정 대기 key · peek = 오래 조용 task · done = 오늘 끝남 task · fn = 기능 키(r:·rv:…) · office = 사무실 크게(id 없음) */
export type HomePop = { kind: 'chat' | 'ask' | 'peek' | 'done' | 'fn' | 'office'; id: string } | null;

export const isPop = (p: HomePop, kind: NonNullable<HomePop>['kind'], id: string) => !!p && p.kind === kind && p.id === id;

export const flipPop = (cur: HomePop, next: NonNullable<HomePop>): HomePop => (isPop(cur, next.kind, next.id) ? null : next);

export const closeOnKey = (cur: HomePop, key: string): HomePop => (key === 'Escape' ? null : cur);

/** 미니 대화 목록 자리 — 새 말이 오면 맨 아래. 단 보이는 칸보다 긴 새 답은 첫 줄부터(맨 아래면 답 끝만 보여 위로 올려 읽어야 했다).
 *  last = 마지막 말풍선 줄(목록 안 위치·높이, reply = 참모 답). 목록 위 여백 12px 만큼 띄운다 */
export function miniScroll(o: { scrollHeight: number; clientHeight: number; last?: { top: number; height: number; reply: boolean } }): number {
  const bottom = Math.max(0, o.scrollHeight - o.clientHeight);
  const l = o.last;
  if (!l || !l.reply || l.height <= o.clientHeight - 24) return bottom;
  return Math.min(bottom, Math.max(0, l.top - 12));
}
