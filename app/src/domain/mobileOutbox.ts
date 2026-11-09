// 폰 보낼 함·쓰던 글 — 참모를 바꾸면 채팅 화면이 새로 그려져(OrchSpace key) 컴포넌트 안에 두던 보내는 중 말풍선·쓰던 글이 날아갔다(2026-10-03 사용자).
// 그래서 저장소(localStorage)에 둔다. 화면·통신 없음 — 저장소는 받아서 쓰고, 막혀 있으면(개인 정보 보호 모드) 조용히 빈 값
import { tr } from '../i18n';
import { parseChat, pendingLeft, type ChatItem, type ChatRef } from './chat';
import { newPending } from './chatQueue';

export type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

/** sending = 서버에 보내는 중 · sent = 서버가 받았고 대화 기록에 뜨길 기다림 · failed = 못 보냄(다시 보내기) */
export type OutStatus = 'sending' | 'sent' | 'failed';
/** session = 보낸 세션 id(앱 세션 id — /api/send 에 넣는 값) */
/** checked = 기록에 안 떠서 맥에 마지막으로 물어본 때(send-status) */
/** since = 이 시각 뒤 기록하고만 맞춘다(newOut) */
/** lost = 맥은 쳤다는데 기록에 끝내 없음(입력칸에 남음) — 맥이 그 id 를 '쳤음'으로 기억해 다시 보낼 땐 새 id(retryOut) */
/** tried = 같은 id 로 다시 보낸 때 — at 은 기록 맞춤에 쓰여 그대로라, 기다린 시간은 이걸로 잰다 */
export type OutMsg = { id: string; session: string; text: string; at: number; since?: number; status: OutStatus; error?: string; checked?: number; lost?: true; tried?: number };

const OUTBOX_KEY = 'm.outbox';
/** 앱을 안 연 채 이만큼 지난 말은 맥도 잊었을 때라(하루) 다시 열면 바로 '전해지지 않았어요'로 — 조용히 버리면 말이 사라진다 */
export const OUTBOX_TTL = 20 * 60 * 60 * 1000;

const notDelivered = () => tr('전해지지 않았어요', 'Not delivered');
/** 마지막으로 보낸 때 */
const sentAt = (m: OutMsg) => m.tried ?? m.at;

const safeGet = (s: Store | null, k: string): string | null => { try { return s?.getItem(k) ?? null; } catch { return null; } };
const safeSet = (s: Store | null, k: string, v: string | null) => {
  try { if (v === null) s?.removeItem(k); else s?.setItem(k, v); } catch { /* 저장 막힘 — 이 화면 동안만 기억 */ }
};

function isOut(x: unknown): x is OutMsg {
  const o = x as OutMsg;
  return !!o && typeof o.id === 'string' && typeof o.session === 'string' && typeof o.text === 'string' && typeof o.at === 'number';
}

/** 다시 열 때 — 보내다 끊긴 것(sending)은 서버가 받았을 수 있어 실패로 안 바꾸고 기록을 기다린다(sent). 오래된 대기는 전해지지 않음으로(들어갔으면 settleOut·findEarlier 가 뺀다) */
export function readOutbox(s: Store | null, now: number): OutMsg[] {
  try {
    const list = JSON.parse(safeGet(s, OUTBOX_KEY) ?? '[]') as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter(isOut)
      .map((m) => (m.status === 'sending' ? { ...m, status: 'sent' as const } : m))
      .map((m) => (m.status !== 'failed' && now - sentAt(m) >= OUTBOX_TTL ? { ...m, status: 'failed' as const, lost: true as const, error: notDelivered() } : m));
  } catch {
    return [];
  }
}
export const writeOutbox = (s: Store | null, list: OutMsg[]) => safeSet(s, OUTBOX_KEY, list.length ? JSON.stringify(list) : null);

/** 새로 보낸 말 — 그 세션 기록에 방금 들어간 같은 글 뒤부터 맞춘다(데스크톱 newPending 과 같은 기준) */
export const newOut = (m: { id: string; session: string; text: string }, items: ChatItem[], now: number): Omit<OutMsg, 'status'> => {
  const { since } = newPending(m.text, items, now);
  return { ...m, at: now, since };
};

export const addOut = (list: OutMsg[], m: Omit<OutMsg, 'status'>): OutMsg[] => [...list, { ...m, status: 'sending' }];

/** 상태 바꾸기 — 다시 보내기(sending)면 보낸 때도 새로(at), 실패 글은 failed 일 때만 */
export function markOut(list: OutMsg[], id: string, status: OutStatus, error?: string, at?: number): OutMsg[] {
  return list.map((m) => {
    if (m.id !== id) return m;
    const { error: _old, ...rest } = m;
    return { ...rest, status, ...(at !== undefined ? { at } : {}), ...(status === 'failed' && error ? { error } : {}) };
  });
}

/** 그 세션 대화 기록에 실제로 들어온 말은 뺀다(pendingLeft 와 같은 맞춤). 바뀐 게 없으면 같은 배열 */
export function settleOut(list: OutMsg[], session: string, items: ChatItem[], now: number): OutMsg[] {
  const mine = list.filter((m) => m.session === session);
  if (!mine.length) return list;
  const left = new Set(pendingLeft(mine, items, now));
  if (left.size === mine.length) return list;
  return list.filter((m) => m.session !== session || left.has(m));
}

/** 쓰던 글 — 참모마다 따로. 붙인 파일은 맥에 이미 올라간 경로라 이름표와 같이 남긴다. refs = 말풍선·일·목표 참조(#chat1·#task1·#goal1) */
export type DraftFile = { path: string; name: string; image: boolean; label: string };
export type Draft = { text: string; files: DraftFile[]; refs?: ChatRef[] };
const draftKey = (orch: string) => `m.draft.${orch}`;

export function readDraft(s: Store | null, orch: string): Draft {
  try {
    const d = JSON.parse(safeGet(s, draftKey(orch)) ?? 'null') as Draft | null;
    if (!d || typeof d.text !== 'string' || !Array.isArray(d.files)) return { text: '', files: [] };
    return Array.isArray(d.refs) && d.refs.length ? { text: d.text, files: d.files, refs: d.refs } : { text: d.text, files: d.files };
  } catch {
    return { text: '', files: [] };
  }
}
export const writeDraft = (s: Store | null, orch: string, d: Draft) =>
  safeSet(s, draftKey(orch), d.text.trim() || d.files.length || d.refs?.length ? JSON.stringify(d) : null);

/** 되살린 파일 이름표의 마지막 번호 — 다음에 붙이는 건 그다음 번호부터. 지금 이름표는 #img1, 옛 초안은 @img1(전엔 @ 만 읽어 늘 0 — #img1 이 둘 생겼다) */
export function labelCounts(files: { label: string }[]): { img: number; file: number } {
  const max = (kind: string) => files.reduce((n, f) => Math.max(n, Number(new RegExp(`^[#@]${kind}(\\d+)$`).exec(f.label)?.[1] ?? 0)), 0);
  return { img: max('img'), file: max('file') };
}

/** 보낸 지 이만큼 지나도 기록에 없으면 '모름'·'쉬는데 없음'을 못 간 것으로 본다 — 바쁜 참모는 끼어든 말을 늦게 적는다 */
export const CHECK_AFTER = 60_000;
/** 처음 물어보는 때 — 맥은 친 뒤 그 말이 입력칸에서 빠졌나까지 보고 '못 들어감'을 안다(그림 읽기까지 길어야 20초쯤).
 *  60초를 기다리면 그동안 폰은 '보내는 중'이라 사라진 줄 몰랐다(2026-11-06 12:12 그림 4장 말) */
export const FIRST_CHECK = 15_000;
const CHECK_GAP = 15_000;
/** 일하는 세션도 이만큼 기록에 없으면 전해지지 않은 것 — 끼어든 말은 95% 가 51초 안에 들어가고 10~30분 걸린 건 1,901건 중 2건(11-07 실측).
 *  드물게 늦게 들어와도 말풍선이 빠질 뿐이고, 다시 보내기는 사람이 누른다 */
export const LOST_AFTER = 10 * 60_000;

/** '생각 중'에 셀 말인가 — 실패·오래된 말은 안 센다(맥에 안 닿아 답을 못 받는 동안에도 몇 시간씩 돌지 않게) */
export const outPending = (m: OutMsg, now: number) => m.status !== 'failed' && now - sentAt(m) < LOST_AFTER;

/** 맥에 물어볼 때인가 — 서버가 받았다고 한(또는 응답을 못 받은) 말이 기록에 안 떴을 때만, 15초에 한 번.
 *  보내는 중(sending)은 1분 넘게 답이 없을 때도 — 날던 요청이 매달리면(홈 화면 앱) 앱을 다시 열 때까지 안 물었다 */
export const dueForCheck = (m: OutMsg, now: number) =>
  (m.status === 'sent' ? now - sentAt(m) >= FIRST_CHECK : m.status === 'sending' && now - sentAt(m) >= CHECK_AFTER) && (m.checked === undefined || now - m.checked >= CHECK_GAP);

/** 맥 답(send-status) — 쳤거나 치는 중이면 계속 기다리고, 실패면 다시 보내기로.
 *  모름(맥이 안 받음·치다 꺼짐)은 looked(그 말 보낸 때부터 대화 기록을 다 봤음 — 꼬리가 덮거나 꼬리 앞을 찾아봄)일 때만 실패로 — 아직이면 기다린다.
 *  기록을 안 보고 바로 실패로 바꾸니 들어간 말이 '못 받았어요'로 남았다(2026-10-11 사용자 폰).
 *  쳤음(done)이어도 세션이 쉬는 채로(idleSince) 1분 넘게 기록에 없으면 입력칸에 남은 말이다 — Enter 가 안 먹으면 맥은 쳤다고 하루를 기억해
 *  폰이 20시간 '생각 중'으로 기다렸다(2026-11-04 사용자). 일하는 중이면 줄 서 있는 것일 수 있어 기다리되 LOST_AFTER 까지 —
 *  폰을 볼 때마다 세션이 일하는 중이면 7시간 넘게 붙어 있었다(2026-11-07 사용자, 맥은 쳤다는데 Claude 입력 기록에 없던 말). 맥이 치는 중(typing)이라고만 해도 같다 */
export function applyStatus(list: OutMsg[], id: string, state: string, error: string | undefined, now: number, looked: boolean, idleSince?: number): OutMsg[] {
  const m = list.find((x) => x.id === id);
  if (m && looked && (state === 'done' || state === 'typing')) {
    const idleLong = state === 'done' && idleSince !== undefined && now - Math.max(idleSince, sentAt(m)) >= CHECK_AFTER;
    if (idleLong || now - sentAt(m) >= LOST_AFTER) return list.map((x) => (x.id === id ? { ...x, status: 'failed' as const, lost: true as const, error: notDelivered() } : x));
  }
  if (state === 'failed' || (state === 'unknown' && looked && m && now - sentAt(m) >= CHECK_AFTER)) return markOut(list, id, 'failed', state === 'failed' ? error || tr('대화창에 들어가지 못했어요', "Didn't make it into the chat") : notDelivered());
  return list.map((m) => (m.id === id ? { ...m, checked: now } : m));
}

/** 다시 보내기 — 보통은 같은 id(맥이 이미 쳤으면 두 번 안 친다), 보낸 때(at)도 그대로 두고 기다린 시간만 새로(tried). 입력칸에 남은 말(lost)은 맥이 '쳤음'으로 기억해 같은 id 면 안 치니 새 id·새 보낸 때로 */
export function retryOut(list: OutMsg[], id: string, newId: string, now: number): { list: OutMsg[]; id: string } {
  const m = list.find((x) => x.id === id);
  if (!m?.lost) return { list: markOut(list, id, 'sending').map((x) => { if (x.id !== id) return x; const { checked: _c, ...r } = x; return { ...r, tried: now }; }), id };
  const { lost: _l, error: _e, checked: _c, tried: _t, ...rest } = m;
  return { list: list.map((x) => (x.id === id ? { ...rest, id: newId, status: 'sending' as const, at: now } : x)), id: newId };
}

/** 그 말을 맞출 기록의 시작(pendingLeft 와 같은 기준) */
const sinceOf = (m: OutMsg) => m.since ?? m.at - 10_000;
const firstTs = (items: ChatItem[]): number | undefined => {
  for (const i of items) { const t = Date.parse(i.ts); if (Number.isFinite(t)) return t; }
  return undefined;
};

/** 꼬리 밖일 수 있는 말 — 폰은 기록 끝(256KB~)만 읽어서, 밤새 일한 뒤 열면 그 말 기록이 꼬리 앞에 있다(2026-10-11 사용자 폰).
 *  start = 꼬리 첫 줄의 파일 자리(undefined = 아직 못 읽음, 0 = 처음부터 다 읽음 — 둘 다 거슬러 볼 것 없음) */
export function beforeTail(mine: OutMsg[], items: ChatItem[], start: number | undefined): OutMsg[] {
  if (!start || start <= 0) return [];
  const first = firstTs(items);
  return mine.filter((m) => first === undefined || first > sinceOf(m));
}

/** 거슬러 읽는 최대 묶음 — 512KB 씩이라 꼬리 앞 4MB(밤새 일한 기록이 1MB 남짓) */
export const LOOKBACK_PAGES = 8;

/** 꼬리 앞을 거슬러 읽으며 그 말들이 기록에 들어갔나 본다 — 찾은 말 id. 그 말을 보낸 때보다 앞까지 읽었거나 파일 처음이면 그 말은 그만 찾는다.
 *  read = 그 자리 앞 묶음(/api/transcript?before) — 맞춤은 settleOut 과 같은 pendingLeft(since 뒤 내 말) */
export async function findEarlier(msgs: OutMsg[], start: number, read: (before: number) => Promise<{ text: string; start: number }>, now: number): Promise<string[]> {
  const found: string[] = [];
  let left = msgs;
  let from = start;
  for (let n = 0; n < LOOKBACK_PAGES && from > 0 && left.length; n++) {
    const page = await read(from);
    const older = parseChat(page.text);
    const still = new Set(pendingLeft(left, older, now));
    found.push(...left.filter((m) => !still.has(m)).map((m) => m.id));
    const first = firstTs(older);
    left = left.filter((m) => still.has(m) && (first === undefined || first > sinceOf(m)));
    if (page.start >= from) break;
    from = page.start;
  }
  return found;
}
