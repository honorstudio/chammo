// 팀 설정 권한 칩(relay ADR 0014) — 칩 하나 누르기의 다음 값과 보이는 값. 10-31 사용자 승인: 누르는 즉시 바꾸고 서버는 뒤에서(실패면 되돌림)

/** 칩 하나 누르기 → 다음 권한 — 전체는 혼자, 나머지는 켜고 끄기(켜면 전체는 빠진다). 다 끄면 팀원 */
export function nextPerms(cur: string[], key: string): string[] {
  if (key === 'all') return cur.includes('all') ? [] : ['all'];
  return cur.includes(key) ? cur.filter((x) => x !== key) : [...cur.filter((x) => x !== 'all'), key];
}

/** 보이는 권한 — 저장 중이면 누른 값, 아니면 서버 값 */
export const shownPerms = (server: string[], pend: string[] | undefined): string[] => pend ?? server;

/** 저장 줄 세우기 — 앞 저장이 끝난 뒤 다음을 보낸다(실패해도 다음은 간다). 같이 돌면 늦게 온 앞 답(뒤 저장 전 서버 상태)이
 *  뒤 줄 칩을 옛 값으로 덮었다(10-31 리뷰). 답이 누른 차례대로 와서 마지막 답이 모든 저장을 담는다 */
export function inOrder() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T,>(job: () => Promise<T>): Promise<T> => {
    const p = tail.then(job);
    tail = p.catch(() => {});
    return p;
  };
}
