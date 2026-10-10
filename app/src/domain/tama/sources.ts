// 다마고치 먹이 출처 — 작업 기록 원문을 pet.ts 의 TamaEvent 로 바꾼다
import type { TaskEvent } from '../tasks';
import type { TamaEvent } from './pet';

const TEST_PATH = /(^|\/)(__tests__|tests?|e2e|spec)\/|\.(test|spec)\.[a-z0-9]+$|_test\.[a-z]+$|(^|\/)test_[^/]+\.py$/i;
export const isTestPath = (p: string) => TEST_PATH.test(p);

// 커밋 크기 규칙이 예외로 인정하는 자동 생성물 — lock·빌드 결과·스키마 타입·마이그레이션·스냅샷. 줄 수(똥)에서 뺀다
const GENERATED = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|[^/]+\.lock)$|(^|\/)(dist|build)\/|\.min\.(js|css)$|(\.types|\.generated|\.gen)\.[a-z]+$|(^|\/)migrations\/[^/]+\.sql$|(^|\/)__snapshots__\//i;
export const isGeneratedPath = (p: string) => GENERATED.test(p);

/** 스쿼시 머지는 GitHub 가 제목 끝에 (#번호) 를 붙인다 */
const SQUASH_PR = /\(#\d+\)\s*$/;

/**
 * Rust `commit_log` 원문: 커밋마다 `@@C\t해시\t시각(초)\t부모들\t제목` 한 줄 + `--numstat` 줄들.
 * 부모가 둘 이상 = 머지 커밋 → PR 머지(특식)로만 센다. 같은 해시는 한 번만(저장소·브랜치 중복)
 */
export function parseCommitLog(raw: string): TamaEvent[] {
  const out: TamaEvent[] = [];
  const seen = new Set<string>();
  let cur: { t: number; lines: number; hasTest: boolean; pr: boolean } | null = null;
  const flush = () => {
    if (!cur) return;
    out.push({ t: cur.t, type: 'commit', lines: cur.lines, hasTest: cur.hasTest });
    if (cur.pr) out.push({ t: cur.t, type: 'pr' });
    cur = null;
  };
  let skip = false;
  for (const line of raw.split('\n')) {
    if (line.startsWith('@@C\t')) {
      flush();
      const [, hash = '', sec = '', parents = '', subject = ''] = line.split('\t');
      const t = Number(sec) * 1000;
      skip = !hash || !Number.isFinite(t) || seen.has(hash);
      if (skip) continue;
      seen.add(hash);
      if (parents.trim().split(/\s+/).length > 1) { out.push({ t, type: 'pr' }); skip = true; continue; }
      cur = { t, lines: 0, hasTest: false, pr: SQUASH_PR.test(subject) };
      continue;
    }
    if (skip || !cur) continue;
    const [a, d, path] = line.split('\t');
    if (path === undefined) continue;
    if (!isGeneratedPath(path)) cur.lines += (Number(a) || 0) + (Number(d) || 0);
    if (isTestPath(path)) cur.hasTest = true;
  }
  flush();
  return out;
}

/** 참모가 시킨 일이 끝남 = 밥. 이름 = 시킬 때 한 줄, by = 시킨 참모(옛 기록엔 없음) */
export function taskEvents(events: TaskEvent[]): TamaEvent[] {
  const sent = new Map(events.filter((e) => e.type === 'send').map((e) => [e.task, e]));
  return events.flatMap((e) => {
    const t = Date.parse(e.ts);
    if (e.type !== 'done' || !Number.isFinite(t)) return [];
    const s = sent.get(e.task);
    return [{ t, type: 'task' as const, ...(s?.title ? { label: s.title } : {}), ...(s?.from ? { by: s.from } : {}), ...(s?.project ? { proj: s.project } : {}) }];
  });
}

type GhRun = { conclusion?: string; status?: string; createdAt?: string };
const WIN = new Set(['success']);
const LOSE = new Set(['failure', 'timed_out', 'startup_failure']);

/** Rust `ci_runs` 원문(저장소마다 `이름\t<gh run list JSON>`) → 배틀. 끝난 실행만, 취소·건너뜀은 판으로 안 친다 */
export function parseCiRuns(raw: string): TamaEvent[] {
  const out: TamaEvent[] = [];
  for (const line of raw.split('\n')) {
    const repo = line.slice(0, line.indexOf('\t'));
    const json = line.slice(line.indexOf('\t') + 1);
    if (!line.includes('\t') || !json.startsWith('[')) continue;
    let runs: GhRun[];
    try { runs = JSON.parse(json) as GhRun[]; } catch { continue; }
    for (const r of runs) {
      const t = Date.parse(r.createdAt ?? '');
      const c = r.conclusion ?? '';
      if (r.status !== 'completed' || !Number.isFinite(t) || !(WIN.has(c) || LOSE.has(c))) continue;
      out.push({ t, type: 'ci', pass: WIN.has(c), label: repo });
    }
  }
  return out;
}

const HOUR = 3_600_000;
const SAME_WORK_MS = 30 * 60_000;
/** 커밋·PR 말고 '끝낸 일' 먹이 — 하루(새벽 5시~) 합쳐 이만큼까지 */
export const DAY_EXTRA = 10;
export const SHOW_PER_DAY = 3;
const EXTRA = new Set<TamaEvent['type']>(['task', 'show', 'talk', 'routine', 'doc', 'review']);
const HOURLY = new Set<TamaEvent['type']>(['talk', 'doc']);
const dayOf = (t: number) => { const d = new Date(t - 5 * HOUR); return d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate(); };

/**
 * 개발자가 두 갈래(커밋·PR + 끝낸 일)로 먹여도 넘치지 않게 — 넘는 것은 echo(먹이지 않고 살아 있다는 표시만, 코인 0).
 * ① 커밋·PR 뒤 30분 안의 시킨 일·결과물은 같은 일 ② 결과물 하루 3(같은 파일은 한 번) ③ 대화·문서 고침 한 시간에 1 ④ 끝낸 일 하루 합쳐 10.
 * 커밋·PR 은 그대로(과식은 pet.ts 가 따로 본다). 시각순으로 돌려준다
 */
export function balanceFeed(events: TamaEvent[]): TamaEvent[] {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const dev = sorted.filter((e) => e.type === 'commit' || e.type === 'pr').map((e) => e.t);
  const perDay = new Map<number, { all: number; show: number }>();
  const shown = new Set<string>(); // 하루·파일 — 같은 결과물을 또 띄운 건 한 번
  const lastHourly = new Map<TamaEvent['type'], number>();
  let j = 0, lastDev = -Infinity;
  return sorted.map((e) => {
    while (j < dev.length && dev[j]! <= e.t) lastDev = dev[j++]!;
    if (!EXTRA.has(e.type) || e.echo) return e;
    const echo = { ...e, echo: true };
    if ((e.type === 'task' || e.type === 'show') && e.t - lastDev <= SAME_WORK_MS) return echo;
    const last = lastHourly.get(e.type);
    if (HOURLY.has(e.type) && last !== undefined && e.t - last < HOUR) return echo;
    const d = dayOf(e.t);
    if (e.type === 'show' && e.label) { const k = `${d}:${e.label}`; if (shown.has(k)) return echo; shown.add(k); }
    const c = perDay.get(d) ?? { all: 0, show: 0 };
    if (c.all >= DAY_EXTRA || (e.type === 'show' && c.show >= SHOW_PER_DAY)) return echo;
    perDay.set(d, { all: c.all + 1, show: c.show + (e.type === 'show' ? 1 : 0) });
    if (HOURLY.has(e.type)) lastHourly.set(e.type, e.t);
    return e;
  });
}
