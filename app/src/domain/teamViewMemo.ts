// 팀 화면 기억 — 팀 홈 글판·팀 보관함 목록의 마지막 판을 팀마다 메모리에(10-28 사용자 "팀홈 팀보관함 매번 새로 로드").
// 팀 스페이스는 탭을 바꾸면 화면이 통째로 내려가서, 기억이 없으면 다시 붙을 때마다 자리표시 + 중계 목록 전체를 다시 받았다.
// 기억은 이 창(웹뷰) 메모리만 — 평문 글·파일 이름이라 저장소엔 안 쓴다(앱 재시작 뒤 첫 열기는 Rust 가 기기 열쇠로 봉한 목록, team_locker_cached)

export type Memo<T> = { v: T; at: number };

/** 소켓이 놓친 판(끊겼다 붙음) 대비 — 이만큼 지난 기억은 보여 주되 뒤에서 한 번 새로 */
export const MEMO_STALE_MS = 10 * 60_000;

export function teamViewMemo<T extends { rev: number }>() {
  const m = new Map<string, Memo<T>>();
  const ears = new Set<(team: string) => void>();
  return {
    get: (team: string): Memo<T> | null => m.get(team) ?? null,
    /** 더 옛 판으로는 안 덮는다 — 늦게 온 느린 응답이 새 판을 되돌리지 않게 */
    put: (team: string, v: T, now = Date.now()) => {
      const old = m.get(team);
      if (old && old.v.rev > v.rev) return;
      m.set(team, { v, at: now });
      for (const f of ears) f(team);
    },
    /** 기억이 바뀌면 그 팀 이름으로 — 같은 판을 다른 자리(띠 팀 칸)도 읽을 때. 돌려준 함수로 뗀다 */
    on: (f: (team: string) => void) => { ears.add(f); return () => { ears.delete(f); }; },
  };
}

/** 다시 붙을 때 망을 부르나 — 기억이 없거나, 오래됐거나, 소켓이 알린 판(told)이 기억보다 새로울 때만. told 0 = 아직 모름(맥 쪽 재시작) — 기억 그대로 두고 판이 오면 그때 */
export function needFetch<T extends { rev: number }>(memo: Memo<T> | null, told: number, now = Date.now()): boolean {
  return !memo || now - memo.at > MEMO_STALE_MS || told > memo.v.rev;
}

/** 팀 보관함에서 보던 폴더 — 팀(대화 파일 보기면 팀:방)마다 이 창 메모리에. 파일 탭을 열고 닫으면 보관함 화면이 다시 붙는데, 기억이 없으면
 *  맨 위로 돌아갔다(10-30 사용자 '회사소개' 폴더). 빈 글 = 맨 위 */
export function placeMemo() {
  const m = new Map<string, string>();
  return {
    get: (key: string) => m.get(key) ?? '',
    put: (key: string, place: string) => { if (place) m.set(key, place); else m.delete(key); },
  };
}
