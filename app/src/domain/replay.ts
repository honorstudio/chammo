// 하루 리플레이 — 새벽 5시부터 다음 날 5시까지의 커밋·위임·결정·자동 허용을 한 화면용으로 묶는다.
// 시안: docs/design-drafts/day-replay (C 요약 + B 재생 막대(A 레인) + D 다마고치 산책 + E 부품, 사용자 2026-09-27 "다 마음에 든다")
import type { AllowLog } from './autoAllow';
import { tr } from '../i18n';
import { isGeneratedPath } from './tama/sources';
import type { TaskEvent } from './tasks';

const HOUR = 3600_000;
const DAY_START_HOUR = 5;
const BIG = 300;
const MAX_REPO_LANES = 6;
// 레인 이름은 화면에 그대로 나오고 레인 열쇠로도 쓴다 — 언어는 앱이 뜰 때 한 번 정해지므로 모듈 맨 위에서 tr 해도 한 실행 안에선 같은 값
export const TASK_LANE = tr('위임·결정', 'Delegation');
const OTHER_LANE = tr('그 밖', 'Other');

export type DayWindow = { start: number; end: number };

export function dayWindow(now: Date): DayWindow {
  const d = new Date(now);
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), DAY_START_HOUR).getTime();
  return { start, end: start + 24 * HOUR };
}

export const shiftDay = (w: DayWindow, days: number): DayWindow => {
  const s = new Date(w.start);
  const start = new Date(s.getFullYear(), s.getMonth(), s.getDate() + days, DAY_START_HOUR).getTime();
  return { start, end: start + 24 * HOUR };
};

export type DayCommit = { hash: string; repo: string; t: number; subject: string; lines: number; merge: boolean };

/** Rust `commit_log` 원문(저장소마다 `@@R\t이름` 뒤에 커밋들). 같은 해시는 처음 본 저장소로 한 번만 */
export function parseDayCommits(raw: string): DayCommit[] {
  const out: DayCommit[] = [];
  const seen = new Set<string>();
  let repo = '';
  let cur: DayCommit | null = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('@@R\t')) {
      repo = line.slice(4).trim();
      cur = null;
      continue;
    }
    if (line.startsWith('@@C\t')) {
      const [, hash = '', s = '', parents = '', subject = ''] = line.split('\t');
      const t = Number(s) * 1000;
      cur = null;
      if (!hash || !Number.isFinite(t) || seen.has(hash)) continue;
      seen.add(hash);
      cur = { hash, repo, t, subject, lines: 0, merge: parents.trim().split(/\s+/).length > 1 };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const [a, d, path] = line.split('\t');
    if (path !== undefined && !isGeneratedPath(path)) cur.lines += (Number(a) || 0) + (Number(d) || 0);
  }
  return out;
}

export type ReplayKind = 'commit' | 'big' | 'merge' | 'send' | 'done' | 'ask' | 'allow';
export type ReplayEvent = { t: number; kind: ReplayKind; lane: string; text: string; lines?: number };

export type Replay = {
  stats: { commits: number; lines: number; merges: number; sent: number; done: number; decisions: number; allows: number; bigCommits: number };
  lanes: string[];
  events: ReplayEvent[];
  /** 레인 → 시간 칸(5시=0 … 4시=23)별 커밋 수 */
  hours: Record<string, number[]>;
  busiest: { hour: number; count: number } | null;
  biggest: DayCommit[];
  decisions: { t: number; project: string; title: string; text: string }[];
  carryover: { t: number; project: string; title: string }[];
};

export function buildReplay(w: DayWindow, allCommits: DayCommit[], tasks: TaskEvent[], allow: AllowLog[]): Replay {
  const inWin = (t: number) => t >= w.start && t < w.end;
  const commits = allCommits.filter((c) => inWin(c.t));
  const work = commits.filter((c) => !c.merge);

  const byRepo = new Map<string, number>();
  for (const c of commits) byRepo.set(c.repo, (byRepo.get(c.repo) ?? 0) + 1);
  const ranked = [...byRepo].sort((a, b) => b[1] - a[1]).map(([r]) => r);
  const shown = new Set(ranked.slice(0, MAX_REPO_LANES));
  const laneOf = (repo: string) => (shown.has(repo) ? repo : OTHER_LANE);
  const lanes = [...ranked.slice(0, MAX_REPO_LANES), ...(ranked.length > MAX_REPO_LANES ? [OTHER_LANE] : []), TASK_LANE];

  const events: ReplayEvent[] = [];
  const hours: Record<string, number[]> = {};
  for (const c of commits) {
    const lane = laneOf(c.repo);
    events.push({ t: c.t, kind: c.merge ? 'merge' : c.lines > BIG ? 'big' : 'commit', lane, text: c.subject, lines: c.lines });
    if (c.merge) continue;
    const row = (hours[lane] ??= Array<number>(24).fill(0));
    const i = Math.floor((c.t - w.start) / HOUR);
    row[i] = (row[i] ?? 0) + 1;
  }

  const sends = new Map<string, { t: number; project: string; title: string }>();
  const doneIds = new Set<string>();
  const decisions: Replay['decisions'] = [];
  let sent = 0, done = 0;
  for (const e of tasks) {
    const t = Date.parse(e.ts);
    if (!Number.isFinite(t)) continue;
    if (e.type === 'send') sends.set(e.task, { t, project: e.target ?? '', title: e.title ?? '' });
    if (e.type === 'done') doneIds.add(e.task);
    if (!inWin(t)) continue;
    const s = sends.get(e.task);
    if (e.type === 'send') { sent++; events.push({ t, kind: 'send', lane: TASK_LANE, text: `${e.target ?? ''} · ${e.title ?? ''}` }); }
    else if (e.type === 'done') { done++; events.push({ t, kind: 'done', lane: TASK_LANE, text: `${s?.project ?? ''} · ${e.note ?? s?.title ?? ''}` }); }
    else if (e.type === 'ask') {
      decisions.push({ t, project: s?.project ?? '', title: s?.title ?? '', text: e.note ?? '' });
      events.push({ t, kind: 'ask', lane: TASK_LANE, text: e.note ?? '' });
    }
  }
  const allows = allow.filter((a) => inWin(Date.parse(a.ts)));
  for (const a of allows) {
    const project = a.where.split(' / ')[0] ?? a.where;
    events.push({ t: Date.parse(a.ts), kind: 'allow', lane: shown.has(project) ? project : TASK_LANE, text: `${a.where} · ${a.option ?? ''} → ${a.result}` });
  }
  events.sort((a, b) => a.t - b.t);

  const clock = Array<number>(24).fill(0);
  for (const c of work) {
    const i = Math.floor((c.t - w.start) / HOUR);
    clock[i] = (clock[i] ?? 0) + 1;
  }
  const top = clock.reduce((best, n, i) => (n > (clock[best] ?? 0) ? i : best), 0);
  const busiest = (clock[top] ?? 0) > 0 ? { hour: (DAY_START_HOUR + top) % 24, count: clock[top] ?? 0 } : null;

  const carryover = [...sends]
    .filter(([id, s]) => inWin(s.t) && !doneIds.has(id))
    .map(([, s]) => s)
    .sort((a, b) => a.t - b.t);

  return {
    stats: {
      commits: work.length,
      lines: work.reduce((n, c) => n + c.lines, 0),
      merges: commits.length - work.length,
      sent, done, decisions: decisions.length, allows: allows.length,
      bigCommits: work.filter((c) => c.lines > BIG).length,
    },
    lanes, events, hours, busiest,
    biggest: [...work].sort((a, b) => b.lines - a.lines).slice(0, 3),
    decisions, carryover,
  };
}
