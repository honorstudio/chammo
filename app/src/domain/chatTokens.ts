// 채팅 입력칸 이름표 두 갈래(2026-10-12 사용자) — @ = 참모 멘션, # = 그림·파일·말풍선 참조(#img1·#file1·#chat1).
// 예전엔 그림 참조가 @img1 이었다 — 지난 대화 기록이 깨지지 않게 읽기는 @img1 도 받는다.
// 멘션은 입력칸 글 그대로(@가나 담당)가 칩이고, 보낼 때 진짜 SendMessage 이름 @[참모-3 · 가나 담당] 으로 풀린다 —
// 화면 이름은 띄어쓰기가 있고 별명만이라, 참모가 누구에게 전할지 헷갈리지 않게 대괄호로 묶는다
import { splitOrchName } from './orchLabel';

/** 새로 쓰는 참조 이름표 머리 — #img1·#file1·#chat1 */
export const REF_PREFIX = '#';
/** 참조 이름표(새 # + 옛 @) */
export const REF_TOKEN = /[#@](?:img|file|chat)\d+/;

/** @ 목록에 뜨는 참모 — name 은 진짜 세션 이름(SendMessage 주소), label 은 화면 이름 */
export type MentionWho = { id: string; name: string; label: string; role?: string; off?: boolean };

/** @ 목록 — 살아 있는 참모 먼저(띠 순서 그대로), 쉬는 참모는 뒤에 off, 지금 채팅 주인(self)은 뺀다 */
export function mentionRoster<R extends { id: string; name: string; off?: boolean }>(roster: R[], self: string | undefined, label: (r: R) => string, role: (name: string) => string | undefined): MentionWho[] {
  const mk = (r: R): MentionWho => ({ id: r.id, name: r.name, label: label(r), role: role(r.name), off: !!r.off });
  const mine = roster.filter((r) => r.id !== self);
  return [...mine.filter((r) => !r.off).map(mk), ...mine.filter((r) => r.off).map(mk)];
}

const MAX_Q = 24;
/** 이름표 머리 앞 — 줄 처음·띄어쓰기·여는 괄호만(메일 a@b·색 #fff 는 아니다) */
const headOk = (text: string, i: number) => i === 0 || /[\s(]/.test(text[i - 1]!);

/** 커서 앞 @ 뒤 글 — 목록을 띄울 때. 이름에 띄어쓰기가 있어 띄어 써도 이어 거르고, 줄바꿈·긴 글이면 null */
export function mentionQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const i = before.lastIndexOf('@');
  if (i < 0 || !headOk(before, i)) return null;
  const q = before.slice(i + 1);
  if (q.includes('\n') || [...q].length > MAX_Q) return null;
  return q;
}

/** 걸러진 목록 — 띠 순서 그대로, 화면 이름·진짜 이름에 든 것 */
export function matchMentions(who: MentionWho[], q: string): MentionWho[] {
  const k = q.toLowerCase();
  return who.filter((w) => w.label.toLowerCase().includes(k) || w.name.toLowerCase().includes(k));
}

/** 고르면 친 @글자를 @이름 으로(뒤가 띄어쓰기가 아니면 하나 붙인다), 커서는 그 뒤. # 이름표도 같은 셈(mark = '#', label 에 # 포함) */
export function mentionPick(text: string, caret: number, label: string, mark: '@' | '#' = '@'): { text: string; caret: number } {
  const i = text.slice(0, caret).lastIndexOf(mark);
  const head = `${text.slice(0, i)}${mark === '@' ? '@' : ''}${label}`;
  const rest = text.slice(caret);
  const gap = /^\s/.test(rest) ? '' : ' ';
  return { text: `${head}${gap}${rest}`, caret: head.length + 1 };
}

/** 입력칸 글 속 멘션 자리 — 긴 이름부터(가나 담당이 가나보다 먼저). 조사가 붙어도 되고, 영문·숫자가 이어지면 다른 낱말 */
export function mentionSpans(text: string, who: MentionWho[]): { who: MentionWho; at: number; len: number }[] {
  const byLen = [...who].filter((w) => w.label).sort((a, b) => b.label.length - a.label.length);
  const out: { who: MentionWho; at: number; len: number }[] = [];
  for (let i = text.indexOf('@'); i >= 0; i = text.indexOf('@', i + 1)) {
    if (!headOk(text, i)) continue;
    const w = byLen.find((x) => text.startsWith(x.label, i + 1) && !/[A-Za-z0-9_-]/.test(text[i + 1 + x.label.length] ?? ''));
    if (!w) continue;
    out.push({ who: w, at: i, len: w.label.length + 1 });
    i += w.label.length;
  }
  return out;
}

/** 보낼 글 — 멘션을 @[진짜 이름] 으로 */
export function expandMentions(text: string, who: MentionWho[]): string {
  let out = '';
  let from = 0;
  for (const s of mentionSpans(text, who)) {
    out += `${text.slice(from, s.at)}@[${s.who.name}]`;
    from = s.at + s.len;
  }
  return out + text.slice(from);
}

/** 보낸 말 속 @[진짜 이름] → 말풍선 칩 글(별명이 있으면 별명) */
export const sentMentionLabel = (name: string) => splitOrchName(name).nick ?? name;

export type Token = string | { ref: string } | { mention: string } | { live: string };
const SPLIT = /([#@](?:img|file|chat)\d+(?![\w])|@\[[^\]\n]{1,80}\])/;

/** 글 → 글 조각과 이름표 — 참조(#img1·옛 @img1), 보낸 멘션 @[이름]. who 를 주면 지금 로스터 멘션(입력칸)도 */
export function splitTokens(text: string, who?: MentionWho[]): Token[] {
  const out: Token[] = [];
  const push = (t: string) => { if (t) out.push(t); };
  const parts = text.split(SPLIT);
  parts.forEach((p, i) => {
    if (i % 2) { out.push(p.startsWith('@[') ? { mention: p.slice(2, -1) } : { ref: p }); return; }
    if (!who?.length) { push(p); return; }
    let from = 0;
    for (const s of mentionSpans(p, who)) {
      push(p.slice(from, s.at));
      out.push({ live: p.slice(s.at, s.at + s.len) });
      from = s.at + s.len;
    }
    push(p.slice(from));
  });
  return out;
}

/** 커서 앞 # 뒤 글 — 그림·파일·보관함 고르기를 띄울 때. 파일 이름 찾기라 띄어쓰기에서 끝 */
export function refQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const i = before.lastIndexOf('#');
  if (i < 0 || !headOk(before, i)) return null;
  const q = before.slice(i + 1);
  return /\s/.test(q) || [...q].length > MAX_Q ? null : q;
}

type LockerEntry = { rel: string; name: string; dir: boolean; gone: boolean; link?: string | null; mtime?: number | null };
/** # 고르기의 보관함 파일 — 파일만(없어진 것 빼고), 최근 것부터, 친 글자가 이름에 든 것. 바로가기는 원본 경로로 붙인다 */
export function lockerChoices(tree: { dir: string; entries: LockerEntry[] }, q: string, max = 6): { path: string; name: string; folder: string }[] {
  const k = q.toLowerCase();
  return tree.entries
    .filter((e) => !e.dir && !e.gone && e.name.toLowerCase().includes(k))
    .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
    .slice(0, max)
    .map((e) => ({ path: e.link || `${tree.dir}/${e.rel}`, name: e.name, folder: e.rel.includes('/') ? e.rel.slice(0, e.rel.lastIndexOf('/')) : '' }));
}
