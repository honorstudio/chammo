// 장애 몬스터(시안 docs/design-drafts/tama-next v1 D, 2026-10-10 사용자 "추천대로") — 진짜 문제가 귀여운 몬스터로 나온다.
// 재료는 앱이 이미 아는 것만(CI 기록·세션 상태·리뷰 화면의 열린 PR) — 새 외부 호출 없음. 문제가 풀리면 처치(코인·도감),
// 방치하면 간식 하나를 훔쳐 먹는 정도(벌은 약하게). 순수 함수: 1분 계산(useTama)이 지금 본 것을 넘긴다
import { tr } from '../../i18n';
import type { TamaEvent } from './pet';

export type MonsterKind = 'slime' | 'ghost' | 'golem';
/** since = 문제가 시작된 때(첫 빨강·처음 본 멈춤·PR 연 때), at = 몬스터로 나타난 때(아직 안 나왔으면 없음) */
export type Monster = { id: string; kind: MonsterKind; where: string; since: number; lv: number; at?: number; stole?: true };
/** 끝난 몬스터 — end = 처치(또는 도망) 시각. fled = 문제가 풀린 게 아니라 사라짐(보상 없음) */
export type Slain = { id: string; kind: MonsterKind; where: string; lv: number; at: number; end: number; fled?: true };
export type Monsters = { live: Monster[]; log: Slain[] };
export const EMPTY_MONSTERS: Monsters = { live: [], log: [] };

/** 지금 본 것. null = 이번엔 모름(기능 꺼짐·아직 못 읽음) — 그 종류 몬스터는 그대로 둔다 */
export type Watch = {
  /** CI 배틀 사건 — label 이 저장소 폴더 이름 */
  ci: TamaEvent[] | null;
  /** 선택지 창에서 멈춘 세션 */
  stuck: { id: string; name: string }[] | null;
  /** 살아 있는 세션 id — 유령의 세션이 꺼졌는지(도망) 다시 움직였는지(처치) 가른다 */
  alive: string[] | null;
  /** 열린 PR. where = 보여 줄 이름(폴더 #번호) */
  prs: { key: string; where: string; createdAt: number; draft: boolean }[] | null;
};

const MIN = 60_000, H = 60 * MIN, D = 24 * H;
const GHOST_AFTER = 30 * MIN;
const GOLEM_AFTER = 3 * D;
const SLIME_STALE = 3 * D;
const STEAL_AFTER = 6 * H;
const MAX_LV = 5;
const LOG_MAX = 200;

/** 처치 코인 — 레벨 × 5, 15 까지 */
export const coinsOf = (lv: number) => 5 * Math.min(Math.max(lv, 1), 3);

type Seen = { id: string; kind: MonsterKind; where: string; since: number; lv: number; show: boolean };
/** 이번에 문제가 남은 것들, 그리고 사라진 것의 결말(처치 시각 또는 도망) */
type Judge = { seen: Seen[]; end: (m: Monster) => { t: number; fled: boolean } };

function slimes(ci: TamaEvent[], now: number): Judge {
  const repos = new Map<string, TamaEvent[]>();
  for (const e of ci) if (e.type === 'ci' && e.label) repos.set(e.label, [...(repos.get(e.label) ?? []), e]);
  const seen: Seen[] = [];
  const pass = new Map<string, number>(); // 마지막 빨강 뒤 첫 초록
  for (const [repo, evs] of repos) {
    evs.sort((a, b) => a.t - b.t);
    let streak = 0, first = 0, green: number | undefined;
    for (const e of evs) {
      if (e.type !== 'ci') continue;
      if (!e.pass) { if (!streak) first = e.t; streak++; green = undefined; } else { green ??= e.t; streak = 0; }
    }
    const lastT = evs[evs.length - 1]!.t;
    if (green !== undefined) pass.set(repo, green);
    if (streak >= 2 && now - lastT <= SLIME_STALE) seen.push({ id: `ci:${repo}`, kind: 'slime', where: repo, since: first, lv: Math.min(MAX_LV, streak), show: true });
  }
  return {
    seen,
    end: (m) => {
      const g = pass.get(m.where);
      return g !== undefined && g > m.since ? { t: g, fled: false } : { t: now, fled: true };
    },
  };
}

function ghosts(stuck: { id: string; name: string }[], alive: string[] | null, live: Monster[], now: number): Judge {
  const seen = stuck.map(({ id, name }): Seen => {
    const since = live.find((m) => m.id === `stuck:${id}`)?.since ?? now;
    const over = now - since - GHOST_AFTER;
    return { id: `stuck:${id}`, kind: 'ghost', where: name, since, lv: Math.min(MAX_LV, 1 + Math.floor(Math.max(0, over) / H)), show: over >= 0 };
  });
  return { seen, end: (m) => ({ t: now, fled: !alive?.includes(m.id.slice('stuck:'.length)) }) };
}

function golems(prs: NonNullable<Watch['prs']>, now: number): Judge {
  const seen = prs
    .filter((p) => !p.draft && now - p.createdAt >= GOLEM_AFTER)
    .map((p): Seen => ({ id: `pr:${p.key}`, kind: 'golem', where: p.where, since: p.createdAt, lv: Math.min(MAX_LV, Math.floor((now - p.createdAt) / D) - 2), show: true }));
  return { seen, end: () => ({ t: now, fled: false }) };
}

/** 지금 본 것으로 몬스터를 나타내고·키우고·끝낸다. stolen = 이번에 간식을 훔쳐 먹은 몬스터 수(나온 지 6시간, 몬스터마다 한 번) */
export function watch(s: Monsters, w: Watch, now: number): { state: Monsters; stolen: number } {
  const judges: [MonsterKind, Judge][] = [];
  if (w.ci) judges.push(['slime', slimes(w.ci, now)]);
  if (w.stuck) judges.push(['ghost', ghosts(w.stuck, w.alive, s.live, now)]);
  if (w.prs) judges.push(['golem', golems(w.prs, now)]);
  const judged = new Set(judges.map(([k]) => k));
  const live: Monster[] = s.live.filter((m) => !judged.has(m.kind));
  const log = [...s.log];
  for (const [kind, j] of judges) {
    const ids = new Set(j.seen.map((x) => x.id));
    for (const m of s.live) {
      if (m.kind !== kind || ids.has(m.id) || m.at === undefined) continue; // 안 나온 채 풀린 건 조용히 사라진다
      const e = j.end(m);
      log.push({ id: m.id, kind, where: m.where, lv: m.lv, at: m.at, end: e.t, ...(e.fled ? { fled: true as const } : {}) });
    }
    for (const x of j.seen) {
      const old = s.live.find((m) => m.id === x.id);
      const at = old?.at ?? (x.show ? now : undefined);
      live.push({ id: x.id, kind, where: x.where, since: x.since, lv: Math.max(old?.lv ?? 0, x.lv), ...(at !== undefined ? { at } : {}), ...(old?.stole ? { stole: true as const } : {}) });
    }
  }
  // 처치 직전 레벨 — 슬라임은 마지막 연속 빨강까지 센다(이번에 처음 본 빨강이 있었을 수 있다)
  if (w.ci) for (const l of log.slice(s.log.length)) if (l.kind === 'slime' && !l.fled) l.lv = Math.max(l.lv, slimeBest(w.ci, l.where));
  let stolen = 0;
  const out = live.map((m) => {
    if (m.at === undefined || m.stole || now - m.at < STEAL_AFTER) return m;
    stolen++;
    return { ...m, stole: true as const };
  });
  return { state: { live: out, log: log.slice(-LOG_MAX) }, stolen };
}

/** 그 저장소의 마지막 연속 빨강 길이 */
function slimeBest(ci: TamaEvent[], repo: string): number {
  let run = 0, best = 0;
  for (const e of ci.filter((x) => x.type === 'ci' && x.label === repo).sort((a, b) => a.t - b.t)) {
    if (e.type !== 'ci') continue;
    if (e.pass) run = 0; else best = ++run;
  }
  return Math.min(MAX_LV, best);
}

/** 처치 = 먹이·코인 사건(도망은 빼고) */
export const slayEvents = (s: Monsters): TamaEvent[] =>
  s.log.filter((l) => !l.fled).map((l) => ({ t: l.end, type: 'slay' as const, kind: l.kind, lv: l.lv, label: l.where }));

/** 지금 화면에 나온 몬스터(나타난 것만) — 레벨 높은 것부터 */
export const shownMonsters = (s: Monsters | undefined): Monster[] => (s?.live ?? []).filter((m) => m.at !== undefined).sort((a, b) => b.lv - a.lv);

export const MONSTER_NAME: Record<MonsterKind, () => string> = {
  slime: () => tr('빨간 슬라임', 'Red Slime'),
  ghost: () => tr('졸음 유령', 'Drowsy Ghost'),
  golem: () => tr('서류 골렘', 'Paper Golem'),
};
/** 위젯 아래 줄처럼 좁은 곳 */
export const MONSTER_SHORT: Record<MonsterKind, () => string> = {
  slime: () => tr('슬라임', 'Slime'),
  ghost: () => tr('유령', 'Ghost'),
  golem: () => tr('골렘', 'Golem'),
};
/** 무슨 문제인가 — where 는 저장소·세션·PR 이름 */
export const monsterWhy = (m: { kind: MonsterKind; where: string; lv: number }) =>
  m.kind === 'slime' ? tr(`${m.where} CI ${m.lv}번 연속 빨강`, `${m.where} CI red ${m.lv} times in a row`)
  : m.kind === 'ghost' ? tr(`${m.where} 세션이 선택지 창에서 멈춤`, `${m.where} is stuck on a choice`)
  : tr(`${m.where} PR 이 ${m.lv + 2}일째 열림`, `${m.where} PR open for ${m.lv + 2} days`);
/** 어떻게 잡나 */
export const MONSTER_HOW: Record<MonsterKind, () => string> = {
  slime: () => tr('그 저장소 CI 가 초록이 되면 처치', 'Beat it with a green CI run on that repo'),
  ghost: () => tr('세션이 답을 받고 다시 움직이면 처치', 'Beat it when the session gets its answer and moves on'),
  golem: () => tr('PR 을 머지하거나 닫으면 처치', 'Beat it by merging or closing the PR'),
};
