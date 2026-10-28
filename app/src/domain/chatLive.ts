import type { ChatItem } from './chat';

// 채팅 보기가 터미널만큼 빨리 보이게(2026-10-28 사용자 "터미널이 더 빠르다") — 기록 읽는 주기와 '쓰는 중' 말풍선.
// 대화 기록(jsonl)은 문단·도구 블록이 끝나야 써져서(실측: 짧은 답도 터미널보다 ~1.2초, 300단어 답은 ~4초 늦다) 기록만 읽으면 답이 늦게 뜬다

/** 기록 읽는 주기 — 답을 기다리는 동안엔 0.25초, 쉴 때는 1초. 세션 상태(working)는 앱이 3초마다 읽어 늦게 오니 보낸 말·마지막 사람 말도 본다 */
export function chatPollMs(o: { working: boolean; waiting: boolean; lastKind?: string }): number {
  return o.working || o.waiting || o.lastKind === 'user' ? 250 : 1000;
}

const RULE = /^\s*─{4,}/;
/** 일하는 동안 도는 표시(✻ Orbiting… · ✻ Worked for 5s) */
const SPIN = /^[✻✢✳✶✽✺·*]\s/;
/** 도구 머리(⏺ Bash(…)·⏺ mcp__x__y(…)) */
const TOOL_HEAD = /^[\w.:-]+\(/;
const LIST = /^([-*•]|\d+[.)])(\s|$)/;

/**
 * 터미널 화면(위로 밀린 줄 몇백 개 포함)에서 지금 쓰고 있는 답 — 입력칸 바로 위 마지막 '⏺ ' 글 블록.
 * Claude Code 화면은 글이 흘러나오며 그려진다(2026-10-28 실측: 기록보다 짧은 답 ~1.2초, 300단어 답 ~4초 먼저).
 * 도구 블록(⎿)·머리가 안 보이는 글(지난 턴인지 못 가름)·입력칸 없는 화면은 null. 칸 폭에서 꺾인 줄은 이어 붙이고 문단·목록은 줄로
 */
export function liveReply(lines: string[]): string | null {
  const rules: number[] = [];
  lines.forEach((l, i) => { if (RULE.test(l)) rules.push(i); });
  if (rules.length < 2) return null;
  const top = rules[rules.length - 2]!;
  if (!/^\s*[>❯]/.test(lines[top + 1] ?? '')) return null;
  let i = top - 1;
  // 입력칸 위 군더더기 — 빈 줄·오른쪽에 붙은 안내(Image in clipboard…)·도는 표시
  while (i >= 0 && (!lines[i]!.trim() || /^ {6,}/.test(lines[i]!) || SPIN.test(lines[i]!))) i--;
  const block: string[] = [];
  let head = false;
  for (; i >= 0; i--) {
    const l = lines[i]!;
    if (l.startsWith('⏺')) { block.unshift(l.slice(1).trimStart()); head = true; break; }
    if (l.trim() && !l.startsWith('  ')) return null; // 사람 말(❯)·도는 표시 — 머리 없이 끊김
    block.unshift(l.slice(2));
  }
  if (!head || block.some((l) => l.trimStart().startsWith('⎿'))) return null;
  const first = block[0]!;
  if (TOOL_HEAD.test(first) || (block.length === 1 && first.endsWith('…'))) return null;
  const rows: string[] = [];
  let gap = true;
  for (const raw of block) {
    const l = raw.trim();
    if (!l) { if (!gap) rows.push(''); gap = true; continue; }
    if (gap || LIST.test(l)) rows.push(l);
    else rows[rows.length - 1] += ` ${l}`;
    gap = false;
  }
  const text = rows.join('\n').trim();
  return text || null;
}

/** 글자·숫자만 — 터미널 그림(굵게·코드 표시가 빠짐)과 기록 마크다운을 대 보려고 */
const letters = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '');

/** 그 글이 이미 기록(마지막 답 몇 개)에 있나 — 있으면 '쓰는 중' 말풍선을 거둔다(기록 말풍선으로 바꿔 끼움). 글자가 거의 없으면 띄우지 않는다 */
export function liveShown(live: string, items: ChatItem[]): boolean {
  const key = letters(live).slice(0, 40);
  if (key.length < 2) return true;
  return items.filter((x) => x.kind === 'assistant').slice(-3).some((x) => letters(x.text).includes(key));
}
