// 채팅에서 보낸 말이 지금 어디 있나 — Claude 대기열·터미널 입력칸·사라짐.
// 일하는 중 보낸 말이 '보내는 중'으로 10분 남고 실제론 안 갔다(2026-10-06 사용자). Claude Code 2.1.291 실측:
// · 일하는 중 Enter = 줄 서기, 기록에 queue-operation enqueue(글) → dequeue(맨 앞, 글 없음)·remove(도중 흡수)·popAll(↑로 입력칸에 되돌림)
// · 쉴 때 입력칸에 글이 있는데 Esc 두 번 = 입력칸 지우기(기록 0) · 막 보낸 말을 Esc 로 끊으면 그 말이 입력칸으로 되돌아온다
import { chatNorm } from './chat';

export type QItem = { text: string; ts: number };
/** waiting = Claude 대기열, popped = ↑로 입력칸에 되돌아간 것(안 간 것) */
export type QueueState = { waiting: QItem[]; popped: QItem[] };
export const emptyQueue: QueueState = { waiting: [], popped: [] };

/** 기록 조각의 줄 서기 줄을 대기열에 반영. 줄 서기 줄이 없으면 q 그대로 */
export function applyQueueOps(q: QueueState, chunk: string): QueueState {
  if (!chunk.includes('"queue-operation"')) return q;
  const waiting = [...q.waiting];
  const popped = [...q.popped];
  const take = (text: string) => { const i = waiting.findIndex((w) => w.text === text); return i < 0 ? null : waiting.splice(i, 1)[0]!; };
  for (const line of chunk.split('\n')) {
    if (!line.includes('"queue-operation"')) continue;
    let r: { type?: string; operation?: string; timestamp?: string; content?: unknown };
    try { r = JSON.parse(line); } catch { continue; }
    if (r.type !== 'queue-operation') continue;
    const text = typeof r.content === 'string' ? r.content : '';
    const ts = Date.parse(r.timestamp ?? '') || 0;
    if (r.operation === 'enqueue' && text) waiting.push({ text, ts });
    else if (r.operation === 'dequeue') waiting.shift();
    else if (r.operation === 'remove' && text) take(text);
    else if (r.operation === 'popAll' && text) { take(text); popped.push({ text, ts }); }
  }
  return { waiting, popped: popped.slice(-50) }; // 되돌린 기록은 최근 것만 쓴다
}

export type PendingMsg = { text: string; at: number };
/** sending = 막 보냄 · queued = Claude 대기열에서 차례 기다림 · input = 터미널 입력칸에 걸림 · lost = 어디에도 없음 */
export type PendingState = 'sending' | 'queued' | 'input' | 'lost';
/** 어디에도 안 보이면 이만큼 지나서 '안 갔음'으로 — 기록 읽기(1초)·대기열 기록이 늦게 와도 넘지 않게 */
export const LOST_AFTER = 10_000;
/** Enter 를 넣은 뒤 이만큼은 입력칸에 보여도 '치는 중'으로 본다 */
const SETTLE = 1000;
/** 같은 말에 Enter 를 다시 넣는 최대 횟수 */
export const AUTO_ENTER_MAX = 3;

/** 줄이 접혀 온 입력칸과 맞대려고 공백을 다 뺀다(stuckInInput 와 같은 방식) */
const sq = (t: string) => chatNorm(t).replace(/\s+/g, '');
/** 보낸 말과 같은 글이 보낸 뒤(10초 여유) 들어왔나 */
const after = (items: QItem[], p: PendingMsg) => items.some((q) => q.ts >= p.at - 10_000 && chatNorm(q.text) === chatNorm(p.text));

export function pendingState(p: PendingMsg, c: { queue: QueueState; termText: string; now: number; enterWait: number }): PendingState {
  const typed = p.at + c.enterWait;
  if (c.now < typed + SETTLE) return 'sending';
  const n = sq(p.text);
  if (n && sq(c.termText).includes(n)) return 'input';
  if (after(c.queue.waiting, p)) return 'queued';
  return c.now < typed + LOST_AFTER ? 'sending' : 'lost';
}

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

/** 줄 선 말 하나를 빼고 다시 줄 세울 것 — 같은 말이 둘이면 하나만 */
export function keepAfterRemove(texts: string[], target: string): string[] {
  const i = texts.indexOf(target);
  return i < 0 ? texts : [...texts.slice(0, i), ...texts.slice(i + 1)];
}
