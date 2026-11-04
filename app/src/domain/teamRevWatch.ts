// 팀 판(보관함 바뀜 판 번호) 바뀜 묻기를 팀마다 하나로 — 프로필판(useProfiles)·글판·홈판(TeamHome)이 같은 판 번호를 3초마다 따로 물었다
// (11-01 perf-bench 창 앞 가만히: team_profile_changed 분당 45~57). Rust 쪽은 '알린 판 > 본 판'이라 가장 옛 판으로 한 번 물어
// 그대로면 아무도 안 바뀐 것이고, 바뀌었으면 모두 깨워 각자 원래대로 자기 판으로 다시 묻게 한다(결과는 따로 물을 때와 같다)
import type { Every } from './sharedPoll';

/** seen: 본 판 · null = 지금은 빼 줘(읽는 중) · 'force' = 묻지 말고 매번 깨워(다 못 받은 판) */
export type RevSub = { seen: () => number | null | 'force'; poke: () => void };

export function makeRevWatch(changed: (team: string, seen: number) => Promise<boolean>, every: Every, ms = 3_000) {
  const teams = new Map<string, { subs: Set<RevSub>; stop: () => void }>();
  const tick = (team: string) => {
    const t = teams.get(team);
    if (!t) return;
    const checked: RevSub[] = [];
    let min = Infinity;
    for (const s of t.subs) {
      const v = s.seen();
      if (v === 'force') s.poke();
      else if (v !== null) { checked.push(s); min = Math.min(min, v); }
    }
    if (checked.length) void changed(team, min).then((c) => { if (c) checked.forEach((s) => s.poke()); }, () => {});
  };
  return {
    watch(team: string, sub: RevSub): () => void {
      let t = teams.get(team);
      if (!t) {
        t = { subs: new Set(), stop: () => {} };
        teams.set(team, t);
        t.stop = every(() => tick(team), ms);
      }
      t.subs.add(sub);
      return () => {
        const x = teams.get(team);
        if (!x) return;
        x.subs.delete(sub);
        if (!x.subs.size) { x.stop(); teams.delete(team); }
      };
    },
  };
}
