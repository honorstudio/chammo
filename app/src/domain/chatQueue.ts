// 채팅에서 보낸 말이 지금 어디 있나 — Claude 대기열·터미널 입력칸·사라짐.
// 일하는 중 보낸 말이 '보내는 중'으로 10분 남고 실제론 안 갔다(2026-10-06 사용자). Claude Code 2.1.291 실측:
// · 일하는 중 Enter = 줄 서기, 기록에 queue-operation enqueue(글) → dequeue(맨 앞, 글 없음)·remove(도중 흡수)·popAll(↑로 입력칸에 되돌림)
// · 쉴 때 입력칸에 글이 있는데 Esc 두 번 = 입력칸 지우기(기록 0) · 막 보낸 말을 Esc 로 끊으면 그 말이 입력칸으로 되돌아온다
import { alreadySent, chatNorm, type ChatItem } from './chat';

export type QItem = { text: string; ts: number };
/** waiting = Claude 대기열, popped = ↑로 입력칸에 되돌아간 것(안 간 것), deq = 짝(뒤따르는 user 줄)을 아직 못 본 dequeue 수 */
export type QueueState = { waiting: QItem[]; popped: QItem[]; deq?: number };
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
  let deq = q.deq ?? 0;
  const take = (text: string) => { const i = waiting.findIndex((w) => w.text === text); return i < 0 ? null : waiting.splice(i, 1)[0]!; };
  for (const line of chunk.split('\n')) {
    const isOp = line.includes('"queue-operation"');
    if (!isOp && !(deq > 0 && (line.includes('"type":"user"') || line.includes('"queued_command"')))) continue;
    let r: { type?: string; operation?: string; timestamp?: string; content?: unknown; message?: { content?: unknown }; attachment?: { type?: string; prompt?: unknown } };
    try { r = JSON.parse(line); } catch { continue; }
    if (r.type !== 'queue-operation') {
      const got = turnText(r);
      if (got === null) continue;
      deq -= 1;
      const i = waiting.findIndex((w) => sameItem(w.text, got));
      if (i >= 0) waiting.splice(i, 1);
      continue;
    }
    const text = typeof r.content === 'string' ? r.content : '';
    const ts = Date.parse(r.timestamp ?? '') || 0;
    if (r.operation === 'enqueue' && text) waiting.push({ text, ts });
    else if (r.operation === 'dequeue') deq += 1;
    else if (r.operation === 'remove' && text) take(text);
    else if (r.operation === 'popAll' && text) { take(text); popped.push({ text, ts }); }
  }
  // 되돌린 기록은 최근 것만, 짝 못 찾은 낡은 줄도 끝없이 쌓이지 않게
  return { waiting: waiting.slice(-50), popped: popped.slice(-50), deq: Math.min(Math.max(deq, 0), 20) };
}

export type PendingMsg = { text: string; at: number };
/** sending = 막 보냄 · queued = Claude 대기열에서 차례 기다림 · input = 터미널 입력칸에 걸림 · lost = 어디에도 없음 */
export type PendingState = 'sending' | 'queued' | 'input' | 'lost';
/** 어디에도 안 보이면 이만큼 지나서 '안 갔음'으로 — 기록 읽기(1초)·대기열 기록이 늦게 와도 넘지 않게.
 *  user 줄·enqueue 줄은 UserPromptSubmit 훅이 끝난 뒤에 붙는다 — 부하 높던 날 훅이 18~21초 걸려 10초 땐 간 말이 '안 갔어요'로 떠 다시 보냈다(2026-10-10) */
export const LOST_AFTER = 45_000;
/** Enter 를 넣은 뒤 이만큼은 입력칸에 보여도 '치는 중'으로 본다 */
const SETTLE = 1000;
/** 같은 말에 Enter 를 다시 넣는 최대 횟수 */
export const AUTO_ENTER_MAX = 3;

/** 줄이 접혀 온 입력칸과 맞대려고 공백을 다 뺀다(stuckInInput 와 같은 방식) */
const sq = (t: string) => chatNorm(t).replace(/\s+/g, '');
/** 보낸 말과 같은 글이 보낸 뒤(10초 여유) 들어왔나 */
const after = (items: QItem[], p: PendingMsg) => items.some((q) => q.ts >= p.at - 10_000 && chatNorm(q.text) === chatNorm(p.text));

/** 다시 보낸 말 — 보낸 시각은 새로, 맞출 기록은 처음 보낸 때(10초 여유) 뒤부터. 처음 말의 기록이 훅 때문에 늦게(옛 시각으로) 붙어도 지워진다.
 *  입력칸에 되돌아온 말(since)은 since 그대로 */
export const resent = (p: PendingMsg & { since?: number }, now: number) => ({ text: p.text, at: now, since: p.since ?? p.at - 10_000 });

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
