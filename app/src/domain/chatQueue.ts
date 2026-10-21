// 채팅에서 보낸 말이 지금 어디 있나 — Claude 대기열·터미널 입력칸·사라짐.
// 일하는 중 보낸 말이 '보내는 중'으로 10분 남고 실제론 안 갔다(2026-10-06 사용자). Claude Code 2.1.291 실측:
// · 일하는 중 Enter = 줄 서기, 기록에 queue-operation enqueue(글) → dequeue(맨 앞, 글 없음)·remove(도중 흡수)·popAll(↑로 입력칸에 되돌림)
// · 쉴 때 입력칸에 글이 있는데 Esc 두 번 = 입력칸 지우기(기록 0) · 막 보낸 말을 Esc 로 끊으면 그 말이 입력칸으로 되돌아온다
import type { LinkState } from './attachExit';
import { alreadySent, chatNorm, humanBody, pendingLeft, promptInput, sentByMe, type ChatItem } from './chat';

export type QItem = { text: string; ts: number };
/** waiting = Claude 대기열, popped = ↑로 입력칸에 되돌아간 것(안 간 것), deq = 짝(뒤따르는 user 줄)을 아직 못 본 dequeue 수,
 *  absorbed = 일하는 도중 흡수된 것(remove, reason absorbed_mid_turn — 참모가 받았다. ts = 흡수된 때) */
export type QueueState = { waiting: QItem[]; popped: QItem[]; deq?: number; absorbed?: QItem[] };
export const emptyQueue: QueueState = { waiting: [], popped: [] };

/** 교차 세션 메시지는 user 줄에서 머리말이 붙고 hop-chain 이 빠지고 꼬리말이 붙어 온다 — 앞부분만 맞댄다 */
const PEER_HEAD = 'Another Claude session sent a message:\n';
const qkey = (t: string) => chatNorm((t.startsWith(PEER_HEAD) ? t.slice(PEER_HEAD.length) : t).replace(/ hop-chain="[^"]*"/, '')).slice(0, 300);
const sameItem = (item: string, got: string) => {
  const a = qkey(item), b = qkey(got);
  return !!a && !!b && (a === b || b.startsWith(a) || a.startsWith(b));
};
/** user 줄(사람 말·교차 세션) 또는 queued_command(작업 알림)의 글 — 도구 결과는 아니다 */
function turnText(r: { type?: string; message?: { content?: unknown }; attachment?: { type?: string; prompt?: unknown } }): string | null {
  const t = rawTurnText(r);
  return t === null ? null : humanBody(t); // 원격 사람 말 이름표(ADR 0011)는 대기열 글에서도 뗀다 — 보낸 글과 맞게
}
function rawTurnText(r: { type?: string; message?: { content?: unknown }; attachment?: { type?: string; prompt?: unknown } }): string | null {
  if (r.type === 'attachment') return r.attachment?.type === 'queued_command' && typeof r.attachment.prompt === 'string' ? r.attachment.prompt : null;
  if (r.type !== 'user') return null;
  const c = r.message?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c) || c.some((x) => x?.type === 'tool_result')) return null;
  return c.filter((x) => x?.type === 'text' && typeof x.text === 'string').map((x) => x.text as string).join('\n') || null;
}

/** 기록 조각의 줄 서기 줄을 대기열에 반영. dequeue 엔 글이 없어서(enqueue 에도 id 가 없다) 맨 앞을 빼지 않고, 바로 뒤에 오는
 *  user 줄(교차 세션은 감싼 꼴)·queued_command 줄의 글과 같은 것을 뺀다 — 맨 앞을 빼면 낡은 줄(1MB 창 밖 enqueue·흔적 없이 사라진 것)과
 *  먼저 빠지는 교차 세션 메시지 때문에 최근 기록 dequeue 2,320번 중 1,305번 엉뚱한 것을 뺐다(2026-10-10 실측, 글로 맞추면 2,264번 맞음).
 *  짝이 없으면 아무것도 안 뺀다. 줄 서기 줄도, 짝 기다리는 dequeue 도 없으면 q 그대로 */
export function applyQueueOps(q: QueueState, chunk: string): QueueState {
  if (!chunk.includes('"queue-operation"') && !q.deq) return q;
  const waiting = [...q.waiting];
  const popped = [...q.popped];
  const absorbed = [...(q.absorbed ?? [])];
  let deq = q.deq ?? 0;
  const take = (text: string) => { const i = waiting.findIndex((w) => w.text === text); return i < 0 ? null : waiting.splice(i, 1)[0]!; };
  for (const line of chunk.split('\n')) {
    const isOp = line.includes('"queue-operation"');
    if (!isOp && !(deq > 0 && (line.includes('"type":"user"') || line.includes('"queued_command"')))) continue;
    let r: { type?: string; operation?: string; reason?: string; timestamp?: string; content?: unknown; message?: { content?: unknown }; attachment?: { type?: string; prompt?: unknown } };
    try { r = JSON.parse(line); } catch { continue; }
    if (r.type !== 'queue-operation') {
      const got = turnText(r);
      if (got === null) continue;
      deq -= 1;
      const i = waiting.findIndex((w) => sameItem(w.text, got));
      if (i >= 0) waiting.splice(i, 1);
      continue;
    }
    const text = typeof r.content === 'string' ? humanBody(r.content) : '';
    const ts = Date.parse(r.timestamp ?? '') || 0;
    if (r.operation === 'enqueue' && text) waiting.push({ text, ts });
    else if (r.operation === 'dequeue') deq += 1;
    // 흡수(참모가 받음)는 reason absorbed_mid_turn 만 — 그 밖의 remove(취소·비우기·하위 에이전트로 간 작업 알림)는 간 말이 아니다(0.3.6 리뷰)
    else if (r.operation === 'remove' && text) { take(text); if (r.reason === 'absorbed_mid_turn') absorbed.push({ text, ts }); }
    else if (r.operation === 'popAll' && text) { take(text); popped.push({ text, ts }); }
  }
  // 되돌린 기록은 최근 것만, 짝 못 찾은 낡은 줄도 끝없이 쌓이지 않게
  return { waiting: waiting.slice(-50), popped: popped.slice(-50), deq: Math.min(Math.max(deq, 0), 20), absorbed: absorbed.slice(-50) };
}

export type PendingMsg = { text: string; at: number };
/** sending = 막 보냄 · queued = Claude 대기열에서 차례 기다림 · input = 터미널 입력칸에 걸림 · lost = 어디에도 없음
 *  · wait = 터미널 보기가 끊겨 다시 붙는 중 — 붙으면 앱이 친다(ui/SessionGrid typeAndSend, domain/paneLinks) */
export type PendingState = 'sending' | 'queued' | 'input' | 'lost' | 'wait';
/** 어디에도 안 보이면 이만큼 지나서 '안 갔음'으로 — 기록 읽기(1초)·대기열 기록이 늦게 와도 넘지 않게.
 *  user 줄·enqueue 줄은 UserPromptSubmit 훅이 끝난 뒤에 붙는다 — 부하 높던 날 훅이 18~21초 걸려 10초 땐 간 말이 '안 갔어요'로 떠 다시 보냈다(2026-10-10).
 *  45초는 너무 길어 '보내는 중'이 끝없이 남는 것처럼 보였다 — 30초(2026-10-21 사용자, 훅 21초보다 넉넉히) */
export const LOST_AFTER = 30_000;
/** Enter 를 넣은 뒤 이만큼은 입력칸에 보여도 '치는 중'으로 본다 */
const SETTLE = 1000;
/** 같은 말에 Enter 를 다시 넣는 최대 횟수 */
export const AUTO_ENTER_MAX = 3;

/** 줄이 접혀 온 입력칸과 맞대려고 공백을 다 뺀다(stuckInInput 와 같은 방식) */
const sq = (t: string) => chatNorm(t).replace(/\s+/g, '');
/** 보낸 말과 같은 글이 보낸 뒤(10초 여유) 들어왔나 */
const after = (items: QItem[], p: PendingMsg) => items.some((q) => q.ts >= p.at - 10_000 && chatNorm(q.text) === chatNorm(p.text));

/** 일하는 도중 흡수된 때 — 이 말을 친 뒤 흡수됐으면 그 시각, 아니면 null. 흡수는 Enter 뒤라 보낸 시각(1초 여유)보다 늦다 —
 *  since(10초 여유)로 보면 몇 초 전 간 같은 말의 흡수에 짝지어 이번 말이 안 가도 사라졌다(시험 장면).
 *  흡수 글 앞엔 붙인 그림 [Image #n]·입력칸에 남아 있던 글이 붙어 오니 '끝이 같다'로 본다. 다른 세션 말·작업 알림(<…>)은 내 말이 아니다.
 *  긴 도구(72초 Bash) 중에 보낸 말은 도구가 끝나야 흡수되는데(2026-10-21 사용자 캡처, 최근 닷새 사람 말 505번 중 104번이 30초 넘게 줄 섬),
 *  흡수 줄만 먼저 읽히면 대기열에도 기록에도 없어 '전달 안 됨 + 다시 보내기'로 튀었다 */
export function absorbedAt(q: QueueState, p: PendingMsg & { since?: number }): number | null {
  const n = chatNorm(p.text);
  if (!n) return null;
  const from = Math.max(p.at - 1000, p.since ?? -Infinity);
  const hit = (q.absorbed ?? []).filter((a) => { const t = chatNorm(a.text); return a.ts >= from && !t.startsWith('<') && (t === n || t.endsWith(` ${n}`)); });
  return hit.length ? Math.max(...hit.map((a) => a.ts)) : null;
}
/** 흡수된 뒤 사람 말 기록(queued_command)이 이만큼 안 읽혀도 간 말로 — 보통은 같은 조각에 온다. 모양이 바뀌어 못 읽어도 말풍선이 남지 않게 */
export const ABSORB_GRACE = 5000;

/** 다시 보낸 말 — 보낸 시각은 새로, 맞출 기록은 처음 보낸 때(10초 여유) 뒤부터. 처음 말의 기록이 훅 때문에 늦게(옛 시각으로) 붙어도 지워진다.
 *  입력칸에 되돌아온 말(since)은 since 그대로 */
export const resent = (p: PendingMsg & { since?: number }, now: number) => ({ text: p.text, at: now, since: p.since ?? p.at - 10_000 });

/** 새로 보낸 말 — 맞출 기록은 보낸 때(10초 여유) 뒤, 그 사이 이미 들어온 같은 글 뒤부터. 방금 간 같은 말을 몇 초 뒤 또 보내면
 *  앞 말 기록에 짝지어져 이번 말이 안 가도 '보내는 중'도 '안 갔어요'도 없이 사라졌다(2026-10-11 bug-hunt 하네스).
 *  now = 치기 시작한 때. 그 뒤 기록은 이번 말이다 — 앱 줄은 다 친 뒤에 알려서 그 사이 읽힌 제 기록을 '앞 말'로 건너뛰어 '안 갔어요'로 남았다(2026-10-21 qa-036) */
export function newPending(text: string, items: ChatItem[], now: number): PendingMsg & { since: number } {
  const from = now - 10_000;
  const n = chatNorm(text);
  const last = n ? Math.max(-Infinity, ...sentByMe(items).filter((i) => { const t = chatNorm(i.text), at = Date.parse(i.ts); return (t === n || t.includes(n)) && at >= from && at < now; }).map((i) => Date.parse(i.ts))) : -Infinity;
  return { text, at: now, since: Math.max(from, last + 1) };
}

/** link = 그 세션 터미널 보기(domain/attachExit) — 끊긴 동안엔 화면 글(termText)이 죽은 화면이라 입력칸은 안 본다.
 *  다시 붙는 중이면 wait(단추 없음 — 붙으면 앱이 친다), 끊김이 굳었으면(gone) 30초를 안 기다리고 바로 lost. 대기열에 이미 들어간 말은 그대로 queued */
export function pendingState(p: PendingMsg & { since?: number }, c: { queue: QueueState; termText: string; now: number; enterWait: number; link?: LinkState }): PendingState {
  // 참모가 이미 받았다 — 기록 줄이 따라올 때까지 보내는 중(단추 없음)
  if (absorbedAt(c.queue, p) !== null) return 'sending';
  if (c.link && c.link !== 'live') return after(c.queue.waiting, p) ? 'queued' : c.link === 'gone' ? 'lost' : 'wait';
  const typed = p.at + c.enterWait;
  if (c.now < typed + SETTLE) return 'sending';
  const n = sq(p.text);
  if (n && sq(c.termText).includes(n)) return 'input';
  if (after(c.queue.waiting, p)) return 'queued';
  return c.now < typed + LOST_AFTER ? 'sending' : 'lost';
}

/** 보낸 글 말풍선을 들고 있는 최대 시간 — 줄 선 말은 긴 일이 끝날 때까지 기다린다. 안 간 말은 사람이 빼거나 다시 보낼 때까지 남긴다 */
export const PENDING_MS = 3_600_000;
/** 채팅에 남길 보낸 말 — 아직 기록에 안 들어온 것 중 한 시간 안, 흡수된 지 ABSORB_GRACE 안 지난 것. ChatView 와 보내기 흐름 시험(chatSendFlow.test)이 같이 쓴다 */
export const waitingOf = <T extends PendingMsg & { since?: number }>(pending: T[], items: ChatItem[], now: number, queue: QueueState = emptyQueue): T[] =>
  pendingLeft(pending, items, now).filter((p) => { const a = absorbedAt(queue, p); return now - p.at < PENDING_MS && (a === null || now - a < ABSORB_GRACE); });
/** 흡수된 말이 기록 없이 사라질 때까지 남은 시간 — ChatView 가 그때 한 번 더 센다(기록이 안 바뀌면 다시 셀 일이 없다). 없으면 null */
export const absorbedLeft = (pending: (PendingMsg & { since?: number })[], queue: QueueState, now: number): number | null => {
  const left = pending.map((p) => absorbedAt(queue, p)).filter((a): a is number => a !== null).map((a) => a + ABSORB_GRACE - now);
  return left.length ? Math.max(0, Math.min(...left)) : null;
};
/** 말풍선 단추 — 보내는 중엔 없음, 안 갔어요면 다시 보내기, 대기 중·입력칸이면 지금 보내기(빼기는 대기열·입력칸 모양을 더 봐서 따로) */
export const pendAct = (st: PendingState): 'again' | 'now' | null => (st === 'sending' || st === 'wait' ? null : st === 'lost' ? 'again' : 'now');

/** Enter 를 다시 넣을 말(tries 는 보낸 시각별 누른 횟수 — 같은 말을 나중에 또 보내도 새로 센다) — 입력칸이 그 말 하나뿐이고, 사람이 ↑로 되돌린 게 아니고, / 명령이 아니고, 덜 눌렀고, 친 지 2초 넘었을 때.
 *  일하는 중이어도 고른다 — 일하는 중 Enter 는 줄 서기라 안전하다(예전엔 쉴 때 한 번만 눌러서 일하는 중 걸린 말이 남았다) */
export function autoEnterTarget(pending: PendingMsg[], c: { queue: QueueState; termText: string; now: number; enterWait: number; tries: Record<number, number> }): string | null {
  const t = sq(c.termText);
  if (!t) return null;
  const hit = pending.find((p) => !p.text.trimStart().startsWith('/') && sq(p.text) === t);
  if (!hit || c.now < hit.at + c.enterWait + 2000) return null;
  if ((c.tries[hit.at] ?? 0) >= AUTO_ENTER_MAX || after(c.queue.popped, hit)) return null;
  return hit.text;
}

/** 채팅이 세션에 넘기는 Esc 사이 최소 간격 — Claude 는 쉴 때 Esc 두 번을 '입력칸 지우기'·'되감기'로 받는다(0.6초는 두 번, 1초는 따로 — 2026-10-06 실측) */
export const ESC_GAP = 1500;
/** Esc 를 지금 넘길까. 바로 앞 Esc 와 가깝거나, 앱이 글을 치는 중(Enter 전)이면 버린다 — 미루면 쉬는 세션에선 방금 보낸 말을 끊어 입력칸으로 되돌린다 */
export const escPlan = (now: number, lastEsc: number, typingUntil: number): boolean => now - lastEsc >= ESC_GAP && now >= typingUntil;

/** 입력칸이 내가 보낸 말들로만 채워져 있으면 그 말들(입력칸 순서), 모르는 글이 섞였으면 null.
 *  새 말을 치기 전에 이걸 비워 두 말이 한 말로 붙어 가지 않게 한다. 모르는 글(받아 적은 말·붙인 그림)은 원래대로 같이 간다 */
export function inputLeftover(termText: string, known: string[]): string[] | null {
  let rest = sq(termText);
  if (!rest || /\[Image #\d+\]/.test(termText)) return null;
  const found: { text: string; at: number }[] = [];
  const order = [...new Set(known)].filter((k) => sq(k)).sort((a, b) => sq(b).length - sq(a).length);
  const full = rest;
  for (const k of order) {
    const i = rest.indexOf(sq(k));
    if (i < 0) continue;
    found.push({ text: k, at: full.indexOf(sq(k)) });
    rest = rest.slice(0, i) + rest.slice(i + sq(k).length);
  }
  return !rest && found.length ? found.sort((a, b) => a.at - b.at).map((f) => f.text) : null;
}

/** 입력칸 남은 글을 알아볼 '내가 보낸 말' 몇 개까지 */
export const MINE_KEEP = 30;
/** 입력칸에 되돌아온 말을 알아볼 목록 — 시각이 아니라 최근 보낸 말 몇 개. 10분 창이었을 땐 오래된 말이 ↑·Esc 로 되돌아오면
 *  '모르는 글'로 보고 새 말과 한 말로 붙어 갔다(roadmap 채팅 유령 ⑤) */
export const mineForLeftover = (users: { text: string; ts: string }[]): string[] => users.slice(-MINE_KEEP).map((u) => u.text);

/** 이만큼 안에 이미 간 글을 또 보내려 하면 한 번 막는다 */
export const DUP_WINDOW = 10 * 60_000;
/** 막은 뒤 이만큼 안에 또 누르면 정말 또 보내려는 것 */
export const DUP_CONFIRM = 8000;
/** 다시 보내기·입력칸 글 보내기를 눌렀을 때 — 최근에 같은 글이 이미 갔으면 처음 한 번은 막는다(warn).
 *  간 줄이 화면에 남아 보여 사용자가 보내기를 계속 눌러 같은 줄이 다섯 번 갔다(2026-10-10) */
export function againPlan(text: string, items: ChatItem[], now: number, warned: { text: string; at: number } | null): 'send' | 'warn' {
  if (!alreadySent(text, items, now - DUP_WINDOW)) return 'send';
  return warned && chatNorm(warned.text) === chatNorm(text) && now - warned.at <= DUP_CONFIRM ? 'send' : 'warn';
}

/** 줄 선 말 하나를 빼고 다시 줄 세울 것 — 같은 말이 둘이면 하나만 */
export function keepAfterRemove(texts: string[], target: string): string[] {
  const i = texts.indexOf(target);
  return i < 0 ? texts : [...texts.slice(0, i), ...texts.slice(i + 1)];
}

/** 세션별 앱 치기 줄 — 앞 것이 다 들어간(Enter 까지) 뒤에 다음 것. 실제 치기는 Rust pty_type 이 TYPE_LOCK 을 잡고 해서
 *  스페이스·카드 답장·폰이 치는 글과 한 입력칸에 섞이지 않는다(2026-10-06 fix/chat-ghost 남은 것).
 *  busyUntil = escPlan 의 typingUntil — 치는 중이면 무한, 끝났으면 끝난 때 + 100 */
/** 채팅이 터미널 입력칸에 넣는 Enter 한 번 — 앱 치기 줄(typeQueue)에 올려 Rust 자물쇠(pty_type)로 친다.
 *  예전엔 pty 에 '\r' 을 바로 써서 카드 답·[앱] 줄·새 말을 치는 중간에 박혀 반만 보내졌다(2026-10-21 리뷰 ②-8).
 *  expect = 그 말이 입력칸에 그대로일 때만(칠 때 화면을 다시 본다 — 타이머가 본 화면은 0.4초 전 것이다). 입력칸 모양이 아니면(선택 창) 안 친다 */
export function enterTask(api: { type: (keys: string[]) => Promise<void>; screen: () => { lines: string[]; cursor: [number, number] } }, expect?: string): () => Promise<void> {
  return async () => {
    if (expect !== undefined) {
      const { lines, cursor } = api.screen();
      const now = promptInput(lines, cursor);
      const sq = (t: string) => t.replace(/\s+/g, '');
      if (now === null || sq(now) !== sq(expect)) return;
    }
    await api.type(['\r']);
  };
}

export function typeQueue(now: () => number = Date.now) {
  const qs = new Map<string, { tail: Promise<void>; left: number; doneAt: number }>();
  return {
    push(id: string, run: () => Promise<void>): Promise<void> {
      const q = qs.get(id) ?? { tail: Promise.resolve(), left: 0, doneAt: 0 };
      q.left += 1;
      q.tail = q.tail.then(run).catch(() => { /* 창이 닫혔다 — 다음 것은 친다 */ }).then(() => { q.left -= 1; q.doneAt = now(); });
      qs.set(id, q);
      return q.tail;
    },
    busyUntil(id: string): number {
      const q = qs.get(id);
      return !q ? 0 : q.left > 0 ? Infinity : q.doneAt + 100;
    },
  };
}
