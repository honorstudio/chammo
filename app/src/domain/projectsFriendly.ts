// 보관함 '모든 프로젝트' 쉬운 화면(2026-11-01 사용자 시안 projects-friendly B + A 표지) — 내 차례 / 일하는 중 / 쉬는 중으로 가르고,
// 폴더 이름 대신 사람 말 이름·표지를 고른다. 새로 기록하는 건 없다: 세션 점·결정 카드·보여 준 파일 기록(show log)·작업 기록을 읽기만
import { cardLook } from './locker';
import type { ProjRowIn } from './projectsView';
import { workDayStart, type TaskEvent } from './tasks';

const norm = (p: string) => p.replace(/\/+$/, '');
const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

/** 내 차례(세션이 묻는 중·결정 카드가 있음) / 일하는 중 / 쉬는 중 / 뺀 것 — 묶음 안은 최근 순. 뺀 건 쉬는 중에서만 빠진다 */
export function projectBuckets<T extends ProjRowIn>(rows: T[], turnRoots: ReadonlySet<string>, hidden: string[]) {
  const hid = new Set(hidden.map(norm));
  const byAt = (a: T, b: T) => b.at - a.at || a.name.localeCompare(b.name);
  const turn = rows.filter((r) => r.dot === 'ask' || turnRoots.has(norm(r.root)));
  const working = rows.filter((r) => !turn.includes(r) && r.dot === 'run');
  const left = rows.filter((r) => !turn.includes(r) && !working.includes(r));
  return {
    turn: turn.sort(byAt),
    working: working.sort(byAt),
    resting: left.filter((r) => !hid.has(norm(r.root))).sort(byAt),
    hidden: left.filter((r) => hid.has(norm(r.root))).sort(byAt),
  };
}

/** 처음 쓰는 사람 — 프로젝트가 하나도 없으면 목록 대신 큰 입력칸 */
export const isFirstRun = (all: readonly unknown[]) => all.length === 0;

const TITLE_MAX = 24;

/** 사람 말 이름 — 한 줄 설명의 앞마디('이름 — ' 머리는 떼고, 괄호·마침표·쉼표 앞까지). 없거나 길면 폴더 이름 */
export function projectTitle(blurb: string, name: string): string {
  let s = blurb.trim();
  const head = s.match(/^(\S+)\s+[—–-]\s+(.+)$/);
  if (head && head[1]!.toLowerCase() === name.toLowerCase()) s = head[2]!;
  s = s.split(/\s+\(|\.\s|,\s|\s[—–]\s/)[0]!.replace(/[.。]$/, '').trim();
  return s && s.length <= TITLE_MAX ? s : name;
}

/** 표지 색 번호(0~5) — 이름마다 늘 같은 색 */
export function coverTone(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 6;
}

/** 표지 — 프로젝트 폴더 안에서 마지막으로 보여 준(scripts/show) 그림·문서 한 장. 글(md 등)은 표지가 안 된다 */
export function projectCovers(showLog: string, roots: string[]): Record<string, string> {
  const rs = roots.map(norm);
  const best = new Map<string, { path: string; ts: string }>();
  for (const line of showLog.split('\n')) {
    let r: { path?: string; ts?: string; gone?: boolean };
    try { r = JSON.parse(line); } catch { continue; }
    if (!r.path || r.gone || cardLook(r.path).look === 'doc') continue;
    const root = rs.find((x) => under(r.path!, x));
    if (!root) continue;
    const had = best.get(root);
    if (!had || (r.ts ?? '') >= had.ts) best.set(root, { path: r.path, ts: r.ts ?? '' });
  }
  return Object.fromEntries([...best].map(([k, v]) => [k, v.path]));
}

/** 오늘(새벽 5시부터) 이 프로젝트(이름·세션 이름)에 맡긴 일 중 끝난 수 — 일하는 중 막대 */
export function projectProgress(events: TaskEvent[], names: string[], now: number): { done: number; total: number } {
  const ns = new Set(names);
  const from = workDayStart(now);
  const mine = new Set<string>();
  const done = new Set<string>();
  for (const e of events) {
    if (e.type === 'send' && Date.parse(e.ts) >= from && ((e.project && ns.has(e.project)) || (e.target && ns.has(e.target)))) mine.add(e.task);
    else if (e.type === 'done' && mine.has(e.task)) done.add(e.task);
  }
  return { done: done.size, total: mine.size };
}

/** 결정 카드(결정 대기함 물음·직접 답하기 카드)가 이 프로젝트 것인가 — 프로젝트 이름이 같거나 카드가 뜬 폴더가 그 안 */
export const askMatches = (a: { project?: string; cwd?: string }, p: { root: string; name: string }) =>
  (!!a.project && a.project === p.name) || (!!a.cwd && under(norm(a.cwd), norm(p.root)));
