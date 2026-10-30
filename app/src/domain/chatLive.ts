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
  // 도는 표시 밑에 붙는 줄(⎿ Tip·할 일 목록·꺾인 줄)은 도는 표시와 한 덩어리 — 그 위부터 본다. 안 건너뛰면 Tip 이 뜬 동안 글을 통째로 못 읽었다(2026-10-29)
  for (let j = i; j >= 0 && j >= top - 20 && !/^[⏺❯]/.test(lines[j]!); j--) if (SPIN.test(lines[j]!)) { i = j - 1; break; }
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

/** 쓰는 중 글 붙잡기 — 화면에서 읽은 글(블록마다 하나, 오래된 것부터)·마지막으로 읽은 때·그때 기록의 마지막 사람 말(턴) */
export type LiveHold = { blocks: string[]; seen: number; turn: string };
export const NO_LIVE: LiveHold = { blocks: [], seen: 0, turn: '' };
/** 턴이 끝났는데 기록에 안 들어온 글을 남겨 두는 시간 — 마지막으로 화면에서 읽은 때부터 */
export const LIVE_GRACE = 5000;
const MAX_BLOCKS = 3;

/** 같은 블록이 자란 것인가 — 앞 글자(최대 20)가 같으면 */
function sameBlock(a: string, b: string): boolean {
  const x = letters(a), y = letters(b);
  const n = Math.min(20, x.length, y.length);
  return n > 0 && x.slice(0, n) === y.slice(0, n);
}

/**
 * 화면 읽기 한 번(0.4초마다). 글은 그 글이 기록에 들어올 때까지 붙잡는다 — 화면에서 잠깐 안 읽혀도(도구 시작·다시 그림·Tip)
 * 지우지 않는다(2026-10-29 사용자 "되다가 갑자기 사라지고 갑자기 나타난다"). 같은 블록이 자라면 바꾸고, 도구 뒤 새 블록은 아래에 더한다.
 * 답을 기다리지 않는데(턴 끝) 기록이 안 오면 LIVE_GRACE 뒤 정리. 글이 그대로면 blocks 도 같은 배열(다시 그리지 않게)
 */
export function liveStep(h: LiveHold, o: { now: number; answering: boolean; text: string | null; items: ChatItem[] }): LiveHold {
  let turn = '';
  for (let i = o.items.length - 1; i >= 0 && !turn; i--) if (o.items[i]!.kind === 'user') turn = o.items[i]!.id;
  // 새 턴이면 앞 턴 글은 버린다 — 기록과 글자가 끝내 안 맞는 글(링크 주소 등)이 다음 턴 내내 흐린 사본으로 남지 않게
  let blocks = turn === h.turn ? h.blocks.filter((b) => !liveShown(b, o.items)) : [];
  let seen = h.seen;
  if (!o.answering && o.now - seen > LIVE_GRACE) blocks = [];
  else if (o.answering && o.text && !liveShown(o.text, o.items)) {
    const last = blocks[blocks.length - 1];
    // 같은 블록은 자라기만 한다 — 짧게 읽히면 반쯤 다시 그린 화면이라 앞 글을 지킨다(턴 끝 다시 그림에서 한 줄이 잘려 말풍선이 출렁였다)
    if (last === o.text) { /* 그대로 */ } else if (last != null && sameBlock(last, o.text)) { if (letters(o.text).length >= letters(last).length) blocks = [...blocks.slice(0, -1), o.text]; }
    else blocks = [...blocks, o.text].slice(-MAX_BLOCKS);
    seen = o.now;
  }
  const same = blocks.length === h.blocks.length && blocks.every((b, i) => b === h.blocks[i]);
  return { blocks: same ? h.blocks : blocks, seen, turn };
}

/** 지금 그릴 쓰는 중 글 — 기록(0.25초마다)이 화면 읽기보다 먼저 오면 그 그림에서 바로 빠져 기록 말풍선과 같은 자리에서 바뀐다 */
export function liveView(h: Pick<LiveHold, 'blocks'>, items: ChatItem[]): string[] {
  return h.blocks.filter((b) => !liveShown(b, items));
}
