// 리뷰 화면의 요약 3줄 · 세션 찾기 · 작업 패널 나누기. 요약은 PR 본문·커밋에서 뽑기만 한다(AI 호출 없음) — 없으면 빈칸
import { GATE_LABEL, type Gate, type OpenPr } from './review';
import type { TaskEvent } from './tasks';

export type Summary = { what: string; ops: string; unverified: string };
export const MAX_LINE = 180;

type Section = { title: string; lines: string[] };

function sections(body: string): Section[] {
  const out: Section[] = [{ title: '', lines: [] }];
  for (const line of body.split('\n')) {
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) out.push({ title: h[1]!.trim(), lines: [] });
    else out.at(-1)!.lines.push(line);
  }
  return out;
}

const NOISE = /^(\||```|---|🤖|https?:\/\/claude\.ai|Co-Authored|Claude-Session)/;

/** 마크다운 치장을 벗긴 한 줄. 표·코드 울타리·서명은 버린다('') */
function clean(line: string): string {
  const t = line.trim();
  if (!t || NOISE.test(t)) return '';
  const s = t
    .replace(/^([-*+]|\d+[.)])\s+/, '')
    .replace(/^>\s*/, '')
    .replace(/⚠️?/g, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > MAX_LINE ? `${s.slice(0, MAX_LINE - 1)}…` : s;
}

const firstLine = (lines: string[]) => lines.map(clean).find(Boolean) ?? '';
const sectionLine = (secs: Section[], title: RegExp) => firstLine(secs.find((s) => title.test(s.title))?.lines ?? []);

const WHAT = /^(무엇|what|summary|요약|변경|바뀐|개요)/i;
// '운영' 은 뺀다 — "운영 DB 확인"(#390) 같은 검증 칸이 걸렸다
const DEPLOY = /배포|deploy|출시|release/i;
const LEFT = /남은|todo|할 일|후속/i;
const NOT_YET = /아직|못\s?(했|함|눌러|봤|봄|해|본)|미확인|확인 (못|필요|전)|안 해 ?봄/;

export function summarize(pr: OpenPr, gates: Gate[]): Summary {
  const secs = sections(pr.body);
  const all = secs.flatMap((s) => s.lines);
  const what =
    sectionLine(secs, WHAT) || firstLine(secs[0]!.lines) || (pr.commits[0] ? clean(pr.commits[0]) : '') || firstLine(secs.slice(1).flatMap((s) => s.lines));
  const ops = [gates.map((g) => `${GATE_LABEL[g.kind]}(${g.why})`).join(' · '), sectionLine(secs, DEPLOY)].filter(Boolean).join(' · ');
  // ⚠️ 줄이 제일 뚜렷하다 — "아직" 은 "아직 라이트 전용" 처럼 딴 뜻으로도 나와서 그다음
  const unverified = firstLine(all.filter((l) => l.includes('⚠'))) || firstLine(all.filter((l) => NOT_YET.test(l))) || sectionLine(secs, LEFT);
  return { what, ops, unverified };
}

/**
 * 이 PR 을 만든 세션 이름 — 작업 기록에서 '#번호' 가 나온 일의 대상 세션. 최근 기록 먼저.
 * projectOf 로 세션의 프로젝트를 알면 폴더가 같아야 하고(#48 은 여러 저장소에 있다), 모르면(꺼진 세션) 다른 후보가 없을 때만 쓴다
 */
export function sessionOf(folder: string, number: number, events: TaskEvent[], projectOf: (target: string) => string | undefined): string | undefined {
  const targetOf = new Map(events.filter((e) => e.type === 'send' && e.target).map((e) => [e.task, e.target!]));
  const re = new RegExp(`#${number}(?!\\d)`);
  let unknown: string | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (!re.test(`${e.title ?? ''} ${e.note ?? ''}`)) continue;
    const t = targetOf.get(e.task);
    if (!t) continue;
    const p = projectOf(t);
    if (p === undefined) unknown ??= t;
    else if (p.toLowerCase() === folder.toLowerCase()) return t;
  }
  return unknown;
}

export type Reviewed = OpenPr & { gates: Gate[] };
export const OLD_MS = 14 * 24 * 3600_000;

/**
 * 작업 패널용 나누기. 나중에(later: key → 미룬 때의 updatedAt)는 새 커밋이 오면(updatedAt 바뀜) 풀린다.
 * 2주 넘게 안 움직인 건 조건에 걸려도 '오래 열림'으로 — 2월 PR 이 매일 맨 위에 서 있지 않게
 */
export function splitOpen<T extends Reviewed>(prs: T[], later: Record<string, string>, now: number) {
  const out = { confirm: [] as T[], rest: [] as T[], later: [] as T[], old: [] as T[] };
  const sorted = [...prs].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  for (const p of sorted) {
    if (later[p.key] === p.updatedAt) out.later.push(p);
    else if (now - Date.parse(p.updatedAt) > OLD_MS) out.old.push(p);
    else if (p.gates.length) out.confirm.push(p);
    else out.rest.push(p);
  }
  return out;
}

/** start(ms) 뒤에 머지된 것 */
export const mergedSince = <T extends { mergedAt: string }>(list: T[], start: number) => list.filter((m) => Date.parse(m.mergedAt) >= start);

/** 수정 요청 받을 세션 — 기록에 나온 세션이 살아 있으면 그것, 아니면 그 프로젝트에 살아 있는 세션이 하나뿐일 때 그것 */
export function pickSession<S extends { id: string; name: string; project: string }>(name: string | undefined, folder: string, live: S[]): S | undefined {
  const named = name ? live.find((s) => s.id === name || s.name === name) : undefined;
  if (named) return named;
  const same = live.filter((s) => s.project.toLowerCase() === folder.toLowerCase());
  return same.length === 1 ? same[0] : undefined;
}

/** domain/usage dayStart 의 "YYYY-MM-DD HH:MM"(로컬) → gh 검색에 넣을 UTC ISO(초까지) */
export const sinceIso = (local: string) => new Date(local.replace(' ', 'T')).toISOString().replace(/\.\d{3}Z$/, 'Z');

const pad = (n: number) => String(n).padStart(2, '0');
/** 작업 기록(tasks.jsonl) 일 id — scripts/task 와 같은 모양 */
export const taskId = (d: Date, rand = Math.random) =>
  `${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${Math.floor(rand() * 0x10000).toString(16).padStart(4, '0')}`;
