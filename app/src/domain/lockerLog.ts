// 보관함 기록(홈·모드 v2 B·C·E, 사용자 10/11) — 프로젝트는 폴더가 아니라 '주고받은 기록'. 보관함 뿌리 = 위 내 폴더 + 아래 이 기록.
// 기록 = 참모·맡긴 세션이 보여 준 파일(scripts/show) + 보관함 맨 위 낱 파일(내가 넣은 것·채팅 첨부). 내 폴더로 끌면 바로가기만 생기고
// 기록엔 '→ 폴더'로 남는다(옮겨지지 않음 — 정리는 내 폴더에서만)
import { tr } from '../i18n';
import { isWebPath } from './locker';
import type { LkEntry } from './lockerTree';

type Shown = { path: string; ts: string; by: string };
type Project = { name: string; root: string };

export type LogItem = {
  path: string;
  ts: string;
  /** 'me' 또는 보여 준 세션·참모 id */
  by: string;
  /** shown = 참모·세션이 보여 줌 · kept = 보관함 맨 위에 들어옴(나·채팅 첨부) */
  act: 'shown' | 'kept';
  /** 어느 프로젝트 것인가(경로가 그 뿌리 안) — 없으면 null */
  project: string | null;
  /** 이 파일을 가리키는 바로가기가 있는 내 폴더들(자리 rel) */
  filed: string[];
};

const under = (p: string, root: string) => p.startsWith(`${root.replace(/\/$/, '')}/`);
const ms = (ts: string) => { const t = Date.parse(ts); return Number.isNaN(t) ? 0 : t; };
const iso = (t: number | null | undefined) => new Date(t ?? 0).toISOString();

/** 그 경로의 프로젝트 이름 — 가장 긴 뿌리 */
export function projectOf(path: string, projects: Project[]): string | null {
  return projects.filter((p) => under(path, p.root)).sort((a, b) => b.root.length - a.root.length)[0]?.name ?? null;
}

export function lockerLog(shown: Shown[], entries: LkEntry[], dir: string, projects: Project[]): LogItem[] {
  // 내 폴더 안 바로가기 — 가리키는 곳 → 그 폴더 자리
  const filedBy = new Map<string, string[]>();
  for (const e of entries) {
    if (e.dir || !e.link || !e.rel.includes('/')) continue;
    const at = e.rel.slice(0, e.rel.lastIndexOf('/'));
    filedBy.set(e.link, [...(filedBy.get(e.link) ?? []), at]);
  }
  const out = new Map<string, LogItem>();
  for (const s of shown) {
    if (isWebPath(s.path) || s.path.startsWith('data:') || (dir && under(s.path, dir) && s.path.slice(dir.length + 1).includes('/'))) continue;
    const had = out.get(s.path);
    if (had && ms(had.ts) >= ms(s.ts)) continue;
    out.set(s.path, { path: s.path, ts: s.ts, by: s.by, act: 'shown', project: projectOf(s.path, projects), filed: [] });
  }
  for (const e of entries) {
    if (e.dir || e.rel.includes('/') || e.name.startsWith('.')) continue;
    const path = `${dir}/${e.rel}`;
    if (out.has(path)) continue;
    out.set(path, { path, ts: iso(e.mtime), by: 'me', act: 'kept', project: projectOf(e.link ?? path, projects), filed: [] });
  }
  for (const it of out.values()) it.filed = filedBy.get(it.path) ?? [];
  return [...out.values()].sort((a, b) => ms(b.ts) - ms(a.ts));
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** 날짜 머리 — 오늘 · 10월 11일 / 어제 · 10월 10일 / 10월 2일 / (다른 해) 2025년 12월 30일 */
export function dayLabel(d: Date, now: Date): string {
  const md = tr(`${d.getMonth() + 1}월 ${d.getDate()}일`, d.toLocaleDateString('en', { month: 'short', day: 'numeric' }));
  if (d.getFullYear() !== now.getFullYear()) return tr(`${d.getFullYear()}년 ${md}`, `${md}, ${d.getFullYear()}`);
  if (sameDay(d, now)) return tr(`오늘 · ${md}`, `Today · ${md}`);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return tr(`어제 · ${md}`, `Yesterday · ${md}`);
  return md;
}

/** 기록을 날짜로 묶는다(이미 최근 순) */
export function logDays(items: LogItem[], now = new Date()): { label: string; items: LogItem[] }[] {
  const out: { label: string; items: LogItem[] }[] = [];
  for (const it of items) {
    const label = dayLabel(new Date(it.ts), now);
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(it);
    else out.push({ label, items: [it] });
  }
  return out;
}

export type LockerViewMode = 'card' | 'list';

/** 보기(⑨) — 사람이 고른 것(폴더마다 기억)이 있으면 그것, 없으면 폴더는 카드·기록은 목록 */
export function defaultView(stored: string | null, where: 'dir' | 'log'): LockerViewMode {
  if (stored === 'card' || stored === 'list') return stored;
  return where === 'log' ? 'list' : 'card';
}
