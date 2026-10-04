// 세션 목록 폴링 문지기 — claude agents 는 한 번에 0.19 CPU초·순간 170MB 라 3초마다 두 번(--json + --all)이면 코어 14%(2026-10-04 mac-perf).
// 꺼진 세션 목록(--all)은 15초에 한 번, 앞 차례가 안 끝났으면 겹쳐 부르지 않는다. 대가: 꺼진 목록이 최대 15초 늦다(사용자 OK)
export const ALL_EVERY_MS = 15_000;

/** 이번 차례에 --all 을 읽을까 — 사람이 부른 것·살아 있던 세션이 사라진 때는 바로 */
export function allDue(o: { lastAt: number; now: number; force: boolean; prevLive: string[]; live: string[] }): boolean {
  if (o.force || !o.lastAt || o.now - o.lastAt >= ALL_EVERY_MS) return true;
  const now = new Set(o.live);
  return o.prevLive.some((id) => !now.has(id));
}

/**
 * 한 번에 하나만 돈다. 도는 중에 온 폴링 차례(force=false)는 버리고, 사람이 부른 것(force=true)은 앞이 끝난 뒤 한 번 더 돌린다 —
 * 지우기·이어 켜기 뒤 `await refresh()` 가 낡은 목록으로 끝나지 않게
 */
export function singleFlight(run: (force: boolean) => Promise<void>): (force?: boolean) => Promise<void> {
  let cur: Promise<void> | null = null;
  let next: Promise<void> | null = null;
  const start = (force: boolean): Promise<void> => {
    const p = run(force).finally(() => { if (cur === p) cur = null; });
    cur = p;
    return p;
  };
  return (force = false) => {
    if (!cur) return start(force);
    if (!force) return cur;
    next ??= cur.catch(() => {}).then(() => { next = null; return start(true); });
    return next;
  };
}
