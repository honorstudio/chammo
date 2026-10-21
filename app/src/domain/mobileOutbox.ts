// 폰 보낼 함·쓰던 글 — 참모를 바꾸면 채팅 화면이 새로 그려져(OrchSpace key) 컴포넌트 안에 두던 보내는 중 말풍선·쓰던 글이 날아갔다(2026-10-03 사용자).
// 그래서 저장소(localStorage)에 둔다. 화면·통신 없음 — 저장소는 받아서 쓰고, 막혀 있으면(개인 정보 보호 모드) 조용히 빈 값
import { josa, machine } from '../i18n';
import { parseChat, pendingLeft, type ChatItem } from './chat';
import { newPending } from './chatQueue';

export type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

/** sending = 서버에 보내는 중 · sent = 서버가 받았고 대화 기록에 뜨길 기다림 · failed = 못 보냄(다시 보내기) */
export type OutStatus = 'sending' | 'sent' | 'failed';
/** session = 보낸 세션 id(앱 세션 id — /api/send 에 넣는 값) */
/** checked = 기록에 안 떠서 맥에 마지막으로 물어본 때(send-status) */
/** since = 이 시각 뒤 기록하고만 맞춘다(newOut) */
export type OutMsg = { id: string; session: string; text: string; at: number; since?: number; status: OutStatus; error?: string; checked?: number };

const OUTBOX_KEY = 'm.outbox';
/** 기록에 끝내 안 뜬 말은 이만큼 지나면 버린다 — 실패한 건 사용자가 지우거나 다시 보낼 때까지 남긴다 */
export const OUTBOX_TTL = 20 * 60 * 60 * 1000;

const safeGet = (s: Store | null, k: string): string | null => { try { return s?.getItem(k) ?? null; } catch { return null; } };
const safeSet = (s: Store | null, k: string, v: string | null) => {
  try { if (v === null) s?.removeItem(k); else s?.setItem(k, v); } catch { /* 저장 막힘 — 이 화면 동안만 기억 */ }
};

function isOut(x: unknown): x is OutMsg {
  const o = x as OutMsg;
  return !!o && typeof o.id === 'string' && typeof o.session === 'string' && typeof o.text === 'string' && typeof o.at === 'number';
}

/** 다시 열 때 — 보내다 끊긴 것(sending)은 서버가 받았을 수 있어 실패로 안 바꾸고 기록을 기다린다(sent). 오래된 대기는 버린다 */
export function readOutbox(s: Store | null, now: number): OutMsg[] {
  try {
    const list = JSON.parse(safeGet(s, OUTBOX_KEY) ?? '[]') as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter(isOut)
      .map((m) => (m.status === 'sending' ? { ...m, status: 'sent' as const } : m))
      .filter((m) => m.status === 'failed' || now - m.at < OUTBOX_TTL);
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

/** 쓰던 글 — 참모마다 따로. 붙인 파일은 맥에 이미 올라간 경로라 이름표와 같이 남긴다 */
export type DraftFile = { path: string; name: string; image: boolean; label: string };
export type Draft = { text: string; files: DraftFile[] };
const draftKey = (orch: string) => `m.draft.${orch}`;

export function readDraft(s: Store | null, orch: string): Draft {
  try {
    const d = JSON.parse(safeGet(s, draftKey(orch)) ?? 'null') as Draft | null;
    return d && typeof d.text === 'string' && Array.isArray(d.files) ? { text: d.text, files: d.files } : { text: '', files: [] };
  } catch {
    return { text: '', files: [] };
  }
}
export const writeDraft = (s: Store | null, orch: string, d: Draft) =>
  safeSet(s, draftKey(orch), d.text.trim() || d.files.length ? JSON.stringify(d) : null);

/** 되살린 파일 이름표의 마지막 번호 — 다음에 붙이는 건 그다음 번호부터. 지금 이름표는 #img1, 옛 초안은 @img1(전엔 @ 만 읽어 늘 0 — #img1 이 둘 생겼다) */
export function labelCounts(files: { label: string }[]): { img: number; file: number } {
  const max = (kind: string) => files.reduce((n, f) => Math.max(n, Number(new RegExp(`^[#@]${kind}(\\d+)$`).exec(f.label)?.[1] ?? 0)), 0);
  return { img: max('img'), file: max('file') };
}

/** 보낸 지 이만큼 지나도 기록에 없으면 맥에 물어본다 — 바쁜 참모는 끼어든 말을 늦게 적는다 */
export const CHECK_AFTER = 60_000;
const CHECK_GAP = 15_000;

/** 맥에 물어볼 때인가 — 서버가 받았다고 한(또는 응답을 못 받은) 말이 기록에 안 떴을 때만, 15초에 한 번 */
export const dueForCheck = (m: OutMsg, now: number) =>
  m.status === 'sent' && now - m.at >= CHECK_AFTER && (m.checked === undefined || now - m.checked >= CHECK_GAP);

/** 맥 답(send-status) — 쳤거나 치는 중이면 계속 기다리고, 실패면 다시 보내기로.
 *  모름(맥이 안 받음·치다 꺼짐)은 looked(그 말 보낸 때부터 대화 기록을 다 봤음 — 꼬리가 덮거나 꼬리 앞을 찾아봄)일 때만 실패로 — 아직이면 기다린다.
 *  기록을 안 보고 바로 실패로 바꾸니 들어간 말이 '못 받았어요'로 남았다(2026-10-11 사용자 폰) */
export function applyStatus(list: OutMsg[], id: string, state: string, error: string | undefined, now: number, looked: boolean): OutMsg[] {
  if (state === 'failed' || (state === 'unknown' && looked)) return markOut(list, id, 'failed', state === 'failed' ? error || '못 쳤어요' : `${josa(machine(), '이', '가')} 이 말을 못 받았어요`);
  return list.map((m) => (m.id === id ? { ...m, checked: now } : m));
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
