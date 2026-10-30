// 팀 캘린더 따라잡기 문지기(0.4.5 리뷰) — stale 동안 1초 poll 이 매 tick sync 를 또 시작했고, 실패하면 매초 sync → 배경 몫(BG_CAP) 소진 →
// 다른 팀 요청이 '잠시 쉬래요'. 팀마다 한 번에 하나(도는 중이면 같은 약속), 실패하면 2·4·8…초(최대 2분) 쉬는 동안 부르면 null
export const SYNC_BACKOFF_MAX = 120_000;

export function syncGate<T>(now: () => number = Date.now) {
  const st = new Map<string, { run: Promise<T> | null; fails: number; until: number }>();
  return (team: string, run: () => Promise<T>): Promise<T> | null => {
    let s = st.get(team);
    if (!s) st.set(team, (s = { run: null, fails: 0, until: 0 }));
    const g = s;
    if (g.run) return g.run;
    if (now() < g.until) return null;
    const p = run().then(
      (v) => { g.fails = 0; g.until = 0; return v; },
      (e) => { g.fails += 1; g.until = now() + Math.min(SYNC_BACKOFF_MAX, 1000 * 2 ** g.fails); throw e; },
    ).finally(() => { if (g.run === p) g.run = null; });
    g.run = p;
    return p;
  };
}
