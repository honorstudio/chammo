// 스페이스 모드 채팅: 세션 대화 기록(~/.claude/projects/*/<sessionId>.jsonl)을 말풍선 항목으로.
// 터미널(TUI)은 뒤에 그대로 살아 있고, 이건 그 기록을 읽기 좋게 다시 그리는 보기일 뿐이다(원칙 1 — 2026-09-30 사용자).

import { toolTarget } from './activity';
import { quotePath } from './drop';

export type ChatTool = { name: string; target: string };
export type ChatItem =
  | { kind: 'user'; id: string; ts: string; text: string; /** 붙인 그림(data URL) — 말풍선 썸네일 */ images?: string[] }
  | { kind: 'assistant'; id: string; ts: string; text: string }
  | { kind: 'tools'; id: string; ts: string; tools: ChatTool[] }
  /** 슬래시 명령 — 말풍선 대신 작은 줄. out = 명령 결과(/context·/cost 등, 색 코드 뺀 글) */
  | { kind: 'note'; id: string; ts: string; text: string; out?: string }
  /** 다른 세션이 보낸 말·앱이 넘긴 줄 — 가운데 카드(from = 보낸 쪽). 사용자 말풍선처럼 보였다(2026-09-30) */
  | { kind: 'relay'; id: string; ts: string; from: string; text: string };

type Block = { type?: string; text?: string; name?: string; input?: Record<string, unknown>; source?: { type?: string; media_type?: string; data?: string } };
type Rec = { type?: string; subtype?: string; content?: unknown; uuid?: string; parentUuid?: string | null; timestamp?: string; isMeta?: boolean; isSidechain?: boolean; isCompactSummary?: boolean; message?: { content?: unknown };
  /** 일하는 중에 끼어든 메시지는 user 줄이 아니라 queued_command 첨부로 남는다(2026-09-30 실측) */
  attachment?: { type?: string; prompt?: unknown; origin?: { kind?: string } } };

const blocks = (content: unknown): Block[] =>
  typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content.filter((b): b is Block => !!b && typeof b === 'object') : [];

/** 붙인 그림 자리표시 — Claude 가 글 앞에 [Image #n] 을 붙인다. 화면엔 썸네일로 보이니 글에선 뺀다 */
const IMAGE_TOKEN = /\[Image #\d+\]/g;
const PASTED_TAG = /<\/?pasted_content[^>]*>/g;
/** 그림을 받으면 Claude 가 따로 남기는 "[Image: source: 경로]" 줄 — 사람 말처럼 한 번 더 보였다(2026-09-30) */
const IMAGE_SOURCE = /^(\s*\[Image: source: [^\]]*\]\s*)+$/;

/** 사람이 친 글 + 붙인 그림. 도구 결과만 있으면 둘 다 빈 것 */
function userParts(content: unknown): { text: string; images: string[] } {
  const bs = blocks(content);
  const text = bs
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
    .replace(IMAGE_TOKEN, '')
    .replace(PASTED_TAG, '') // 긴 글은 붙여넣기 태그로 감싸져 기록된다 — 사람 눈엔 태그 없이
    .trim();
  const images = bs
    .filter((b) => b.type === 'image' && b.source?.type === 'base64' && b.source.data)
    .map((b) => `data:${b.source!.media_type ?? 'image/png'};base64,${b.source!.data}`);
  return { text: IMAGE_SOURCE.test(text) ? '' : text, images };
}

/** 도구 결과의 사람 개입 꼬리표 → 첫 줄('사람이 브라우저를 3분 조작하고 돌려줬어'). 아직 조작 중 안내·다른 결과는 null */
const TAKEOVER = /\[사람 개입\] (사람이 [^\n]*조작하고 돌려줬어)/;
function takeoverNote(content: unknown): string | null {
  for (const b of blocks(content)) {
    if (b.type !== 'tool_result') continue;
    for (const c of blocks((b as { content?: unknown }).content)) {
      const m = c.type === 'text' && c.text?.match(TAKEOVER);
      if (m) return m[1]!;
    }
  }
  return null;
}

/** 짝지은 기기 앱 화면에서 사람이 직접 친 말(ADR 0011) — 받는 폰 서버가 붙인 이름표를 떼면 사람 말 그대로(꼬리표 human#cid 째) */
const HUMAN_REMOTE = /^\[(?:사람 말 · 원격 · [^\]\n]+?에서 직접|Person · remote · typed on [^\]\n]+?) · human#[A-Za-z0-9_-]+\]\n?/;
export const humanBody = (t: string) => (HUMAN_REMOTE.test(t) ? t.replace(HUMAN_REMOTE, '').replace(/^› (?=[[<［＜])/gm, '') : t);

/** 다른 세션이 보낸 말(<cross-session-message from-name=…>)·앱이 넘긴 줄([앱] …) → 보낸 쪽과 본문 */
function relayOf(t: string): { from: string; text: string } | null {
  if (t.startsWith('[앱] ')) return { from: '앱', text: t.replace(/^\[앱\]\s*/, '').trim() };
  // 다른 기기 참모(ADR 0007) — 받는 폰 서버가 붙인 이름표. 꼬리표(peer#cid)는 답 찾기용이라 안 보인다
  const p = t.match(/^\[((?:다른 기기 참모|Assistant on another device) · [^\]\n]+?) · peer#[A-Za-z0-9_-]+\]\n?([\s\S]*)$/);
  if (p) return { from: p[1]!, text: p[2]!.trim() };
  // 팀 메신저(team_relay_inbox) — 받는 Chammo 가 붙인 이름표. 사람 말이어도 남의 말이라 내 말풍선이 아니다(보안 검토 1-C)
  const tm = t.match(/^\[((?:팀 참모|팀 사람 말|Team assistant|Team human) · [^\]\n]+?) · team#\d+\]\n?([\s\S]*)$/);
  if (tm) return { from: tm[1]!, text: tm[2]!.trim() };
  // 내 기기끼리 방(서버 ADR 0004) — 내 다른 기기에서 온 말도 이 채팅에선 보낸 쪽이 붙은 줄
  const sm = t.match(/^\[((?:내 다른 기기 참모|내 다른 기기 사람 말|My device assistant|My device human) · [^\]\n]+?) · self#\d+\]\n?([\s\S]*)$/);
  if (sm) return { from: sm[1]!, text: sm[2]!.trim() };
  const m = t.match(/<cross-session-message\b[^>]*?from-name="([^"]*)"[^>]*>([\s\S]*?)<\/cross-session-message>/);
  return m ? { from: m[1]!, text: m[2]!.trim() } : null;
}

/** 터미널 색·굵기 코드(ESC[…m) — 채팅에선 뺀다 */
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
/** 명령 결과 줄(<local-command-stdout>·stderr) → 결과 글(빈 글 가능), 아니면 null */
function commandOut(t: string): string | null {
  const m = t.match(/^<local-command-(?:stdout|stderr)>([\s\S]*)<\/local-command-(?:stdout|stderr)>\s*$/);
  return m ? m[1]!.replace(ANSI, '').replace(/[ \t]+$/gm, '').replace(/^\n+|\s+$/g, '').replace(/^ (?=\S)/, '') : null;
}
/** 명령 결과 — push 가 앞 명령 줄에 붙인다(합치기 전 잠깐 쓰는 모양) */
type Out = { kind: 'out'; id: string; ts: string; out: string };

/** 사람이 친 게 아닌 user 줄 — 슬래시 명령·다른 세션 메시지는 알림 줄, 나머지 주입(<system-reminder> 등)은 숨김 */
function injected(t: string): { note: string } | 'hide' | null {
  const cmd = t.match(/^<command-name>(\/[^<]*)<\/command-name>/);
  if (cmd) return { note: cmd[1]!.trim() };
  // 멈추기 뒤 Claude 가 남기는 표시 — 말풍선은 군더더기(2026-09-30)라 알림 한 줄로. 채팅 Esc 로 멈춘 게 보여야 한다(2026-10-15 사용자)
  if (/^\[Request interrupted by user[^\]]*\]$/.test(t)) return { note: '멈췄어' };
  if (t.startsWith('<') && !t.startsWith('<pasted_content')) return 'hide';
  return null;
}

/** 채팅에선 명령 앞부분(cd /Users/…)보다 설명 한 줄이 읽기 좋다 — 설명이 있으면 설명(자르기는 화면 CSS 가) */
const chatTarget = (input: Record<string, unknown> | undefined) =>
  typeof input?.description === 'string' && input.description.trim() ? input.description.trim() : toolTarget(input);

/** 한 줄 → 새 항목들(합치기 전) */
function itemsOf(r: Rec): (ChatItem | Out)[] {
  // 기록은 Claude Code 가 쓰는 바깥 글 — 객체가 아닌 줄(null·숫자)은 건너뛴다(렌더 중 TypeError 면 창이 통째로 멈췄다, 2026-10-11)
  if (!r || typeof r !== 'object' || Array.isArray(r)) return [];
  if (r.isSidechain) return [];
  const id = r.uuid ?? '';
  const ts = r.timestamp ?? '';
  // 백그라운드 세션의 슬래시 명령·결과는 system(local_command) 줄로 남는다(2.1.289 실측)
  if (r.type === 'system' && r.subtype === 'local_command' && typeof r.content === 'string') {
    const out = commandOut(r.content);
    if (out !== null) return [{ kind: 'out', id, ts, out }];
    const inj = injected(r.content);
    return inj && inj !== 'hide' ? [{ kind: 'note', id, ts, text: inj.note }] : [];
  }
  if (r.type === 'user') {
    if (r.isMeta) return [];
    // 사람이 세션 브라우저에 개입했다 돌려줌 — 도구 결과의 꼬리표([사람 개입], tools/chammo-browser src/takeover.js)를 한 줄로
    const take = takeoverNote(r.message?.content);
    if (take) return [{ kind: 'note', id, ts, text: take }];
    // 컨텍스트가 차서 앞부분을 요약해 넣은 글 — 사용자가 친 말이 아니다
    if (r.isCompactSummary) return [{ kind: 'note', id, ts, text: '대화가 길어서 앞부분을 요약했어' }];
    const { text: said, images } = userParts(r.message?.content);
    const text = humanBody(said);
    if (!text && !images.length) return [];
    const rel = text ? relayOf(text) : null;
    if (rel) return [{ kind: 'relay', id, ts, ...rel }];
    const out = commandOut(text);
    if (out !== null) return [{ kind: 'out', id, ts, out }];
    if (text.startsWith('Another Claude session sent a message')) return [{ kind: 'relay', id, ts, from: '다른 세션', text: text.replace(/^Another Claude session sent a message:?\s*/, '') }];
    const inj = text ? injected(text) : null;
    if (inj === 'hide') return [];
    if (inj) return [{ kind: 'note', id, ts, text: inj.note }];
    return [images.length ? { kind: 'user', id, ts, text, images } : { kind: 'user', id, ts, text }];
  }
  if (r.type === 'attachment') {
    const a = r.attachment;
    if (a?.type !== 'queued_command') return [];
    // 120초 넘게 붙잡혀 배경으로 넘어간 브라우저 도구 — 돌려준 꼬리표가 끝 알림(task-notification)으로 온다(2026-10-06 실측)
    const take = typeof a.prompt === 'string' && a.prompt.startsWith('<task-notification>') ? a.prompt.match(TAKEOVER) : null;
    if (take) return [{ kind: 'note', id, ts, text: take[1]! }];
    // 그림을 붙여 보낸 말은 prompt 가 글+그림 블록 배열이다(2.1.305 실측) — 보통 사람 말처럼 썸네일도
    const { text: said, images } = userParts(a.prompt);
    const text = humanBody(said);
    const rel = text ? relayOf(text) : null;
    if (rel) return [{ kind: 'relay', id, ts, ...rel }]; // 일하는 중에 들어온 다른 세션 말
    if (a.origin?.kind !== 'human' || (!text && !images.length)) return [];
    return [images.length ? { kind: 'user', id, ts, text, images } : { kind: 'user', id, ts, text }];
  }
  if (r.type === 'assistant') {
    const out: ChatItem[] = [];
    for (const b of blocks(r.message?.content)) {
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) out.push({ kind: 'assistant', id, ts, text: b.text.trim() });
      else if (b.type === 'tool_use' && b.name) out.push({ kind: 'tools', id, ts, tools: [{ name: b.name, target: chatTarget(b.input) }] });
    }
    return out;
  }
  return [];
}

/** 끝 항목과 이어지면 합친다 — 도구끼리는 한 묶음, 답 조각끼리는 한 말풍선, 명령 결과는 앞 명령 줄 밑에. list 를 제자리에서 바꾼다 */
function push(list: ChatItem[], it: ChatItem | Out) {
  const last = list[list.length - 1];
  if (it.kind === 'out') {
    if (!it.out) return; // 빈 결과 — 명령 줄만
    if (last?.kind === 'note' && last.out === undefined && last.text.startsWith('/')) list[list.length - 1] = { ...last, out: it.out };
    else list.push({ kind: 'note', id: it.id, ts: it.ts, text: '', out: it.out });
    return;
  }
  if (last?.kind === 'tools' && it.kind === 'tools') list[list.length - 1] = { ...last, tools: [...last.tools, ...it.tools] };
  else if (last?.kind === 'assistant' && it.kind === 'assistant') list[list.length - 1] = { ...last, text: `${last.text}\n\n${it.text}` };
  else list.push(it);
}

/** 보낸 말(사람 말·앱 줄·다른 세션 말) — 새 턴을 연다 */
const isPrompt = (i: ChatItem | undefined) => i?.kind === 'user' || i?.kind === 'relay';
/** 보낸 말의 부모 줄 — 같은 부모의 다음 말이 오면 앞 말은 거둬들여진(버려진 갈래) 것. 항목 모양은 그대로 두려고 따로 든다 */
const parentOf = new WeakMap<ChatItem, string>();
/** 참모가 무엇이든(생각 줄 하나라도) 낸 뒤의 보낸 말 — 그 뒤 Esc 는 멈춤이다 */
const answered = new WeakSet<ChatItem>();

function feed(list: ChatItem[], chunk: string): boolean {
  let added = false;
  for (const raw of chunk.split('\n')) {
    if (!raw.trim()) continue;
    let r: Rec;
    try {
      r = JSON.parse(raw);
    } catch {
      continue; // 꼬리를 잘라 읽어 첫 줄은 깨져 있을 수 있다
    }
    if (r?.type === 'assistant' && !r.isSidechain && isPrompt(list[list.length - 1])) answered.add(list[list.length - 1]!);
    for (const it of itemsOf(r)) {
      const parent = r.type === 'user' && isPrompt(it as ChatItem) ? r.parentUuid : null;
      // 보낸 말에 답이 나오기 전 Esc 가 가면 Claude Code 는 그 말을 입력칸에 되돌리고 다음 말을 같은 부모에 단다 —
      // 앞 말(과 그 갈래)은 참모가 못 받은 말이라 보통 말풍선으로 남기지 않는다(2026-10-16 사용자 '안 갔어요' 두 번)
      if (parent) {
        const i = list.findIndex((x) => parentOf.get(x) === parent);
        if (i >= 0) { list.splice(i); added = true; }
      }
      push(list, it);
      added = true;
      if (parent) parentOf.set(it as ChatItem, parent);
      else if (r.type === 'attachment' && isPrompt(it as ChatItem)) answered.add(it as ChatItem); // 일하는 중 흡수된 말 — 턴은 이미 돌고 있다
    }
  }
  return added;
}

/** 지금 Esc 를 넘기면 방금 보낸 말을 거둬들이나 — 보낸 말에 참모가 아직 아무 기록(생각·도구·글)도 안 냈거나,
 *  턴이 끝난 뒤 보낸 말이 아직 기록 전(inFlight — 훅 도는 중)일 때. 그땐 Claude Code 가 Esc 를 멈춤이 아니라 '보낸 말 취소'로 받는다
 *  (2.1.301 시험 세션 실측: 7초 생각 중에도 거둬들였다, 2026-10-16) */
export function escUnsends(items: ChatItem[], inFlight: boolean): boolean {
  const last = items[items.length - 1];
  if (isPrompt(last)) return !answered.has(last!);
  return inFlight && (!last || last.kind === 'assistant' || last.kind === 'note');
}

export function parseChat(jsonl: string): ChatItem[] {
  const list: ChatItem[] = [];
  feed(list, jsonl);
  return list;
}

/** 새로 붙은 기록만 이어 붙인다. 바뀐 게 없으면 prev 그대로(React 가 다시 그리지 않게), 있으면 새 배열 */
export function appendChat(prev: ChatItem[], chunk: string): ChatItem[] {
  const list = [...prev];
  return feed(list, chunk) ? list : prev;
}

/** 입력칸에서 보낸 글 중 아직 기록에 안 뜬 것 — 세션이 바쁘면 줄 서 있다가 나중에 뜬다 */
/** 입력칸에 그려지는 표시 글자 — 음성 받아 적기 표시(▬·▁▂▃)·도형·블록·자리표시(U+FFFC/FFFD)·사설 영역 글리프. 말이 아니다 */
const MARKS = /[\u2580-\u259F\u25A0-\u25FF\uFFFC\uFFFD\uE000-\uF8FF]/g;
export const stripMarks = (t: string) => t.replace(MARKS, '');

/** 보낸 글과 기록·큐의 글을 맞댈 모양 — 역슬래시는 빼고(줄 끝 \ 는 Claude 입력칸이 '줄 이어 쓰기'로 먹는다),
 *  표시 글자(▬ 등)도 빼고(음성으로 받아 적은 글을 입력칸에서 읽으면 끝에 붙어 와 영영 안 맞았다, 2026-10-01 사용자) */
export const chatNorm = (t: string) => stripMarks(t).replace(IMAGE_TOKEN, '').replace(/\\/g, '').replace(/\s+/g, ' ').trim();

/** 내가 보낸 말 — 사람 말 + 앱이 이 세션 입력칸에 친 줄([앱] …, 기록엔 relay 로 잡힌다). 앱 줄은 머리말을 붙여 친 글 그대로.
 *  사람 말만 보니 실제로 간 앱 줄이 '안 갔어요'로 남아 다시 보내기로 같은 줄이 다섯 번 갔다(2026-10-10 사용자) */
export function sentByMe(items: ChatItem[]): { text: string; ts: string }[] {
  return items.flatMap((i) => (i.kind === 'user' ? [{ text: i.text, ts: i.ts }] : i.kind === 'relay' && i.from === '앱' ? [{ text: `[앱] ${i.text}`, ts: i.ts }] : []));
}

/** 이 글이 since 뒤 기록에 벌써 들어갔나(내 말로) */
export const alreadySent = (text: string, items: ChatItem[], since: number): boolean =>
  !!chatNorm(text) && stillPending([text], items.filter((i) => Date.parse(i.ts) >= since)).length === 0;

export function stillPending(pending: string[], items: ChatItem[]): string[] {
  const left = matchSent(pending.map((p) => ({ n: chatNorm(p), ok: () => true })), sentByMe(items));
  return pending.filter((_, k) => left[k]);
}

/** 기록에 든 내 말 하나 — 줄마다 맞춤 모양, 어느 줄을 이미 다른 말에 짝지었나 */
type SentRec = { ts: number; lines: string[]; used: boolean[] };

/** 기록 줄 하나가 보낸 말 n 을 담았나 — 담았으면 그 자리를 써 버린다(한 자리는 한 말만).
 *  같다 · 끝이 같다(앞에 그림·경로 칩이나 입력칸에 남아 있던 글) · 줄 몇 개가 통째로 같다(일하는 중 줄 선 말 여럿이 한 기록으로 합쳐 들어감).
 *  글 일부만 같은 건 아니다 — 늦게 붙은 "네 진행해" 기록이 3초 뒤 보낸 "네" 말풍선까지 지워, "네"가 안 갔어도 몰랐다(2026-10-21 리뷰 ②-3) */
function takeSent(r: SentRec, n: string): boolean {
  if (!r.used.some(Boolean)) {
    const all = chatNorm(r.lines.join('\n'));
    if (all === n || all.endsWith(` ${n}`)) {
      r.used.fill(true);
      return true;
    }
  }
  const norms = r.lines.map(chatNorm);
  for (let i = 0; i < norms.length; i++) {
    if (r.used[i] || !n.startsWith(norms[i]!)) continue;
    for (let j = i; j < norms.length && !r.used[j]; j++) {
      const b = chatNorm(r.lines.slice(i, j + 1).join('\n'));
      if (b === n) {
        for (let k = i; k <= j; k++) r.used[k] = true;
        return true;
      }
      if (b.length > n.length) break;
    }
  }
  return false;
}

/** 보낸 말마다 아직 기록에 없나 — 앞에 있는 말(오래된 것)부터 짝짓고, 기록 자리 하나는 말 하나만 지운다.
 *  예전엔 기록 하나가 그 글을 품은 말풍선을 다 지웠다(같은 말을 두 번 보내도 기록 하나로 둘 다 사라짐) */
function matchSent(pend: { n: string; ok: (ts: number) => boolean }[], sent: { text: string; ts: string }[]): boolean[] {
  const recs: SentRec[] = sent.map((i) => { const lines = i.text.split('\n'); return { ts: Date.parse(i.ts), lines, used: lines.map(() => false) }; });
  return pend.map(({ n, ok }) => !!n && !recs.some((r) => ok(r.ts) && takeSent(r, n)));
}

/** 보내는 중 말풍선 중 아직 기록에 안 들어온 것 — 보낸 뒤(몇 초 여유)에 들어온 내 말하고만 맞춘다.
 *  기록 전체와 맞추니 예전 말에 같은 글("한국말로")이 있으면 방금 보낸 말이 바로 사라졌다(2026-09-30 사용자) */
export function pendingLeft<T extends { text: string; at: number; since?: number }>(pending: T[], items: ChatItem[], now = Date.now()): T[] {
  // 짝짓기는 보낸 순서대로 — 먼저 보낸 말이 먼저 기록 자리를 가져간다
  const order = pending.map((_, k) => k).sort((x, y) => pending[x]!.at - pending[y]!.at);
  // since = 이 시각 뒤 기록만 — 끊겨서 입력칸에 되돌아온 말은 방금 전 기록이 있어도 안 간 말이다(2026-10-06)
  const left = matchSent(order.map((k) => { const p = pending[k]!; const from = p.since ?? p.at - 10_000; return { n: chatNorm(p.text), ok: (ts: number) => ts >= from }; }), sentByMe(items));
  const stays = new Set(order.filter((_, i) => left[i]));
  return pending.filter((p, k) => {
    // / 명령(/rc·/model 등)은 보통 말처럼 기록에 안 남을 때가 있다 — 4초 지나면 보낸 걸로 친다(2026-10-01 사용자)
    if (p.text.trimStart().startsWith('/') && now - p.at > SLASH_PENDING_MS) return false;
    return stays.has(k);
  });
}
const SLASH_PENDING_MS = 4000;

/** 채팅에 붙여넣은 것 — 그림이면 터미널 그림 붙이기(Ctrl+V), 그림 아닌 파일은 그림 길로 안 보낸다(파인더에서 ⌘C 한 PDF 가
 *  #img 이름표를 달고 파일 아이콘 그림으로 갔다, 2026-10-21 리뷰 ②-10). 웹뷰가 그림을 파일로 안 넘기고 글도 없으면 그림으로 본다(2026-09-30) */
export function pasteKind(items: { kind: string; type: string }[], hasText: boolean): 'image' | 'file' | 'text' {
  if (items.some((i) => i.type.startsWith('image/'))) return 'image';
  if (items.some((i) => i.kind === 'file')) return 'file';
  return hasText ? 'text' : 'image';
}

/** 보내는 중인 말이 Enter 없이 터미널 입력칸에 그대로 있으면 그 말 — 쉬는데 남아 있으면 Enter 를 다시 넣는다 */
export function stuckInInput(pending: string[], input: string): string | null {
  const sq = (t: string) => t.replace(/\s+/g, '');
  const n = sq(input);
  if (!n) return null;
  // / 명령은 빼고 — 고르는 창이 열려 있으면 그 Enter 가 창에서 골라 버린다
  return pending.find((p) => !p.trimStart().startsWith('/') && sq(p) === n) ?? null;
}

/** 작업 중 = 세션이 working 이고 마지막이 답이 아님. 백그라운드 job 참모는 쉬어도 working 으로 나와서 마지막 항목으로 가른다 */
/** 채팅 칸에서 누른 Esc 가 참모의 지금 턴을 멈추나 — CLI 처럼 한 번(2026-10-15 사용자). 일하는 중일 때만: 쉴 때 Esc 두 번은 Claude 의 되감기 창·입력칸 지우기다.
 *  한글 조합 중·채팅 위에 뜬 것(멘션·/ 목록·메모리·모델 칩·선택지 창·미리보기 모달)·이미 다른 데서 받은 Esc 는 그쪽이 먼저.
 *  시안 검토 탭이 떠 있으면 입력칸 밖 Esc 는 검토 닫기다(domain/curation reviewEscCloses) — 입력칸 Esc 는 검토가 안 받는다 */
export function chatEscStops(o: { key: string; composing: boolean; prevented: boolean; working: boolean; overlay: boolean; inInput: boolean; review: boolean; unsends?: boolean }): boolean {
  // 보낸 말에 아직 답이 없으면 넘기지 않는다 — 멈출 일은 없고 방금 보낸 말만 거둬들여져 참모에게 안 간다(escUnsends)
  if (o.key !== 'Escape' || o.composing || o.prevented || o.overlay || !o.working || o.unsends) return false;
  return o.inInput || !o.review;
}

export const chatBusy = (state: string, items: ChatItem[]) => state === 'working' && items[items.length - 1]?.kind !== 'assistant';

/** 입력칸 오른쪽 버튼 — 보내기는 쓴 글(또는 터미널 입력칸 글)이 있을 때만 칠하고, 일하는 중에 칸이 비면 옆에 '멈춤'.
 *  일하는 중에 글이 있으면 보내기만(Enter 는 줄 섰다가 중간에 들어간다) — 2026-10-02 보내기 버튼 시안 방향 2 */
export const sendControls = (busy: boolean, draft: string, termText: string) => ({
  canSend: !!draft.trim() || !!termText,
  stop: busy && !draft.trim(),
});

/**
 * 터미널 화면(보이는 줄들)에서 Claude 입력칸 글. 입력칸 = 마지막 구분선 두 개 사이, 첫 줄은 `>`/`❯` 로 시작.
 * cursor = [칸, 줄](보이는 줄 기준). 커서가 프롬프트 바로 뒤면 빈 칸 — 흐린 안내 문구는 글자만으론 구분이 안 돼서.
 * 입력칸 모양이 아니면 null(선택지 창 등). 지구본 키로 받아 적은 말을 채팅 화면에 보여 주는 데 쓴다(2026-09-30 사용자)
 */
const PLACEHOLDERS = [/^Press (up|↑) to edit queued messages?$/i];

export function promptInput(lines: string[], cursor: [number, number]): string | null {
  const rules: number[] = [];
  lines.forEach((l, i) => { if (/^\s*─{4,}/.test(l)) rules.push(i); });
  if (rules.length < 2) return null;
  const a = rules[rules.length - 2]!, b = rules[rules.length - 1]!;
  const body = lines.slice(a + 1, b);
  const m = body[0]?.match(/^(\s*[>❯]\s?)(.*)$/);
  if (!m) return null;
  const [cx, cy] = cursor;
  if (cy === a + 1 && cx <= m[1]!.length && body.length === 1) return '';
  const text = [m[2]!, ...body.slice(1).map((l) => l.replace(/^ {2}/, ''))].map((l) => stripMarks(l).trimEnd()).join('\n').trim();
  // Claude 가 빈 입력칸에 흐리게 띄우는 안내 — 커서 자리로 못 가를 때가 있다. 그대로 두면 앱이 보낸 말로 알고 Enter 를 넣었다(2026-10-01 사용자)
  return PLACEHOLDERS.some((r) => r.test(text)) ? '' : text;
}

/** 할 일 칸 머리줄 — 터미널의 "N tasks (1 done, 1 in progress, 0 open)" */
export function taskCounts(tasks: { status: string }[]): { done: number; doing: number; open: number } {
  const n = (st: string) => tasks.filter((t) => t.status === st).length;
  return { done: n('completed'), doing: n('in_progress'), open: tasks.length - n('completed') - n('in_progress') };
}

/** 마크다운 손질 — 물결표 하나는 범위(700~900)라 취소선이 되면 안 된다. 두 개(~~)만 취소선(2026-09-30 캡처) */
export const mdSafe = (text: string) =>
  text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/) // 코드 칸(~/.claude 경로)은 건드리지 않는다
    .map((part, i) => (i % 2 ? part : part.replace(/(?<!~)~(?!~)/g, '\\~')))
    .join('');


/**
 * 채팅에서 보낼 글을 사람이 치듯 나눈 조각들. 붙여넣기 표시(bracketed paste)로 감싸면 긴 글은 Claude 가 "붙여넣은 글"로 받아
 * 사용자 지시로 덜 믿는다 — 감싸지 않고 치되 줄바꿈은 Option+Enter(ESC CR), 탭은 띄어쓰기(탭은 자동완성이 된다).
 * 마지막 Enter 는 보내는 쪽이 조금 쉬었다가 따로 넣는다(바로 넣으면 줄바꿈으로 먹힌다). 2026-09-30 시험 세션 실측
 */
/** 글을 다 친 뒤 Enter 까지 기다릴 시간(ms). 윈도우는 가짜 콘솔(ConPTY)이 글을 늦게 넘겨 긴 지시의 Enter 가 줄바꿈으로 들어갔다 — 글 길이만큼 더(최대 +3초) */
export const enterDelay = (len: number, win: boolean): number => (win ? 400 + Math.min(len, 3000) : 400);

export function typedChunks(text: string, size = 200): string[] {
  const out: string[] = [];
  text.replace(/\t/g, '  ').split('\n').forEach((line, i) => {
    if (i > 0) out.push('\x1b\r');
    const cs = [...line];
    for (let k = 0; k < cs.length; k += size) out.push(cs.slice(k, k + size).join(''));
  });
  return out;
}

/** 파일 경로 — 채팅 칩은 큰따옴표 안이 통째로 경로(drop quotePath, 안의 " 는 \"), 끌어 놓은 그림·옛 기록은 셸 이스케이프(띄어쓰기는 "\ ").
 *  /… 또는 ~/… 로 시작. 1 = 따옴표 경로, 2 = 이스케이프 경로 */
const PATH_RE = /(?:^|(?<=\s))(?:"((?:\/|~\/)(?:\\.|[^"\\\n])*)"|((?:\/|~\/)(?:\\ |[^\s])+))/g;
const unquote = (q: string) => q.replace(/\\(x[0-9a-f]{2}|.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c.length === 3 ? String.fromCharCode(parseInt(c.slice(1), 16)) : c));
export type Seg = { text: string } | { path: string; name: string };
/** 사람 말 속 파일 경로를 이름 칸으로 떼어 낸다 — 말풍선이 긴 경로로 지저분했다(2026-09-30 사용자) */
export function splitPaths(text: string): Seg[] {
  const out: Seg[] = [];
  let last = 0;
  for (const m of text.matchAll(PATH_RE)) {
    const raw = m[1] ?? m[2]!;
    if (!raw.slice(1).includes('/')) continue; // /compact 같은 슬래시 명령은 경로가 아니다
    const len = m[1] !== undefined ? raw.length + 2 : raw.length;
    const at = m.index! + (m[0].length - len);
    if (at > last) out.push({ text: text.slice(last, at) });
    const path = m[1] !== undefined ? unquote(raw) : raw.replace(/\\ /g, ' ');
    out.push({ path, name: path.split('/').pop() || path });
    last = at + len;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

/**
 * 첨부 줄(채팅 입력칸 위)에 남길 터미널 입력칸 글 — 붙인 그림 표시 [Image #n] 과 붙인 파일 경로는 이름표로 보이니 뺀다.
 * 터미널 입력칸이 좁아 긴 경로가 두 줄로 접혀 조각이 남았다(2026-09-30 캡처) → 줄을 이어 붙인 뒤 알고 있는 경로를 통째로 뺀다
 */
export function termRest(termText: string, paths: string[]): string {
  if (!paths.length && !/\[Image #\d+\]/.test(termText)) return termText;
  let s = termText.split('\n').map((l) => l.trim()).join('');
  for (const p of paths) s = s.split(quotePath(p)).join(' ').split(p.replace(/ /g, '\\ ')).join(' ').split(p).join(' ');
  // 칩 경로 앞 이름표(#file1 "…")도 — 첨부 줄엔 칩이 따로 보인다
  s = s.replace(/\[Image #\d+\]/g, ' ').replace(/(?:^|(?<=\s))[#@](?:img|file)\d+(?!\d)/g, ' ');
  return splitPaths(s).map((x) => ('text' in x ? x.text : ' ')).join('').replace(/\s+/g, ' ').trim();
}

/** 말풍선 참조 — 앞 말풍선을 #chat1 로 입력칸에 끌어온 것(2026-09-30 사용자, 10-12 @ → # — 옛 @chat1 기록도 읽는다) */
export type ChatRef = { label: string; who: string; text: string };
const REF_MAX = 600;
const REF_HEAD = /^\[참조 ([#@]chat\d+) · ([^\]]*)\]$/;

/** 보낼 글 = 쓴 글 + 글에 남아 있는 이름표의 인용 블록. 빈 줄은 빼고 600자에서 자른다 */
export function withRefs(text: string, refs: ChatRef[]): string {
  const used = refs.filter((r) => new RegExp(`${r.label}(?!\\d)`).test(text));
  if (!used.length) return text;
  const quote = (t: string) => {
    const flat = t.split('\n').filter((l) => l.trim()).join('\n');
    const cut = [...flat].length > REF_MAX ? `${[...flat].slice(0, REF_MAX).join('')}…` : flat;
    return cut.split('\n').map((l) => `> ${l}`).join('\n');
  };
  return [text, ...used.map((r) => `[참조 ${r.label} · ${r.who}]\n${quote(r.text)}`)].join('\n\n');
}

/** 보낸 말풍선에서 본문과 참조 블록을 가른다 — withRefs 의 반대 */
export function splitRefs(text: string): { body: string; refs: ChatRef[] } {
  const at = text.search(/\n\n\[참조 [#@]chat\d+ · [^\]]*\]\n/);
  if (at < 0) return { body: text, refs: [] };
  const refs: ChatRef[] = [];
  for (const block of text.slice(at + 2).split('\n\n')) {
    const [head = '', ...lines] = block.split('\n');
    const m = head.match(REF_HEAD);
    if (m) refs.push({ label: m[1]!, who: m[2]!, text: lines.map((l) => l.replace(/^> ?/, '')).join('\n') });
  }
  return { body: text.slice(0, at), refs };
}

/** 채팅 창을 누른 뒤 입력칸으로 커서를 옮길지 — 버튼·링크·입력칸이 아니고, 글을 끌어 고르는 중이 아니면(2026-09-30 사용자) */
export const clickFocusesInput = (c: { interactive: boolean; selected: string }) => !c.interactive && !c.selected.trim();
