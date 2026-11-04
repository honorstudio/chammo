// 보관함 '모든 프로젝트' 목록·프로젝트 화면(2026-11-01 사용자 시안 projects-view A) — 화면이 읽는 글 다듬기·묶기만. 파일 읽기는 화면(invoke)이
import type { TaskEvent } from './tasks';
import type { DotKind } from './dot';

/** 보관함 자리 l:<참모>#p:* — '모든 프로젝트' 목록(프로젝트 뿌리는 절대 경로라 겹치지 않는다) */
export const ALL_PROJECTS = '*';

/** 마크다운 꾸밈을 벗긴 한 줄 — **굵게**·`코드`·[글](주소)·![그림](주소)·줄머리 목록 표 */
const plain = (s: string) => s
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\*\*|__|`/g, '')
  .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
  .replace(/\s+/g, ' ')
  .trim();

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 템플릿 자리표·안내 문구는 설명이 아니다(새로 만든 프로젝트 — project.rs harness_project) */
const filler = (s: string) => !s || /\{\{.*\}\}/.test(s) || /^\(.*(적어 주세요|in a line or two).*\)$/.test(s);

/** 본문 줄인가 — 제목·인용·표·그림만 있는 줄·구분선은 아니다 */
const body = (l: string) => {
  const t = l.trim();
  return !!t && !/^(#|>|\||---|```|<)/.test(t) && plain(t) !== '';
};

/** 제목(##…)으로 나눈 절 — [제목, 줄들] */
function sections(md: string): [string, string[]][] {
  let cur: [string, string[]] = ['', []];
  const out = [cur];
  for (const l of md.split('\n')) {
    const h = l.match(/^#{1,6}\s+(.*)$/);
    if (h) out.push((cur = [h[1] ?? '', []]));
    else cur[1].push(l);
  }
  return out;
}

const firstBody = (lines: string[]) => plain(lines.find(body) ?? '');

/** 프로젝트 한 줄 설명 — starter '**한 줄**:' → CLAUDE.md '이 프로젝트'·'한 줄' 절 → CLAUDE.md 첫 본문 → README 첫 본문 */
export function projectBlurb(starter: string, claudeMd: string, readme: string): string {
  const one = starter.split('\n').map((l) => l.match(/^\s*\*\*(?:한 줄|One line)\*\*\s*[:：]\s*(.+)$/i)?.[1]).find(Boolean);
  const tries = [
    one ? plain(one) : '',
    firstBody(sections(claudeMd).find(([h]) => /한 줄|이 프로젝트|one.?line|this project|about/i.test(h))?.[1] ?? []),
    firstBody(claudeMd.split('\n')),
    firstBody(readme.split('\n')),
  ];
  return cut(tries.find((t) => !filler(t)) ?? '', 140);
}

/** starter 의 지금 단계(그 절 첫 본문 줄)와 다음 할 일 앞 세 개 */
export function starterNow(starter: string): { stage: string; next: string[] } {
  const ss = sections(starter);
  const stage = firstBody(ss.find(([h]) => /현재|지금|current|phase|now\b/i.test(h) && !/다음|next/i.test(h))?.[1] ?? []);
  const nextLines = ss.find(([h]) => /다음 할 일|next/i.test(h))?.[1] ?? [];
  const next = nextLines.filter((l) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(l)).slice(0, 3).map((l) => cut(plain(l), 80));
  return { stage: cut(stage, 120), next };
}

/** 목록 한 줄 재료 — at = 마지막 움직임(ms, 0 = 모름) */
export type ProjRowIn = { root: string; name: string; dot: DotKind; at: number };

const WEEK = 7 * 24 * 3600_000;
const norm = (p: string) => p.replace(/\/+$/, '');

/** 진행 중(일하는·답 기다리는) / 최근 7일 / 나머지 / 뺀 것 — 묶음 안은 최근 순. 돌고 있는 건 뺐어도 진행 중에 남는다 */
export function projectGroups<T extends ProjRowIn>(rows: T[], now: number, hidden: string[]) {
  const hid = new Set(hidden.map(norm));
  const byAt = (a: T, b: T) => b.at - a.at || a.name.localeCompare(b.name);
  const live = (r: T) => r.dot === 'run' || r.dot === 'ask';
  const active = rows.filter(live);
  const left = rows.filter((r) => !live(r));
  const shown = left.filter((r) => !hid.has(norm(r.root)));
  return {
    active,
    recent: shown.filter((r) => r.at > 0 && now - r.at <= WEEK).sort(byAt),
    rest: shown.filter((r) => !(r.at > 0 && now - r.at <= WEEK)).sort(byAt),
    hidden: left.filter((r) => hid.has(norm(r.root))).sort(byAt),
  };
}

/** done 메모의 증거 표 — PR 번호, 없으면 커밋 해시 앞 7자리 */
export function proofOf(note: string): string {
  const pr = note.match(/\bPR\s*#?(\d+)/i);
  if (pr) return `PR ${pr[1]}`;
  const h = note.match(/\b(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/);
  return h ? h[0].slice(0, 7) : '';
}

export type Commit = { hash: string; ts: number; subject: string };
export type DoneItem = { ts: number; text: string; proof: string };

/** 한 일 — 그 프로젝트(이름·세션 이름)에 시킨 일 중 끝난 것 + 커밋, 최근 순 */
export function projectDone(events: TaskEvent[], commits: Commit[], names: string[], limit = 20): DoneItem[] {
  const ns = new Set(names);
  const sends = new Map<string, TaskEvent>();
  const out: DoneItem[] = [];
  for (const e of events) {
    if (e.type === 'send' && ((e.project && ns.has(e.project)) || (e.target && ns.has(e.target)))) sends.set(e.task, e);
    else if (e.type === 'done' && sends.has(e.task)) {
      const s = sends.get(e.task)!;
      out.push({ ts: Date.parse(e.ts), text: s.title ?? '', proof: proofOf(e.note ?? '') });
    }
  }
  for (const c of commits) out.push({ ts: c.ts * 1000, text: c.subject, proof: c.hash.slice(0, 7) });
  return out.filter((d) => d.text && !Number.isNaN(d.ts)).sort((a, b) => b.ts - a.ts).slice(0, limit);
}

const abs = (p: string, home: string) => norm(p.replace(/^~(?=\/|$)/, home));
const tilde = (p: string, home: string) => (p === home || p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p);

/** 설정 hiddenProjects(~ 모양) → 화면이 견주는 절대 경로 */
export const hiddenRoots = (list: unknown, home: string): string[] =>
  (Array.isArray(list) ? list : []).filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => abs(x, home));

/** 목록에서 빼기·되돌리기 — 설정에 적을 새 목록(~ 모양, 같은 폴더는 한 줄) */
export function setHidden(list: string[], root: string, hide: boolean, home: string): string[] {
  const r = abs(root, home);
  const rest = list.filter((x) => abs(x, home) !== r);
  return hide ? [...rest, tilde(r, home)] : rest;
}
