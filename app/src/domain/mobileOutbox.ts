// 폰 보낼 함·쓰던 글 — 참모를 바꾸면 채팅 화면이 새로 그려져(OrchSpace key) 컴포넌트 안에 두던 보내는 중 말풍선·쓰던 글이 날아갔다(2026-10-03 사용자).
// 그래서 저장소(localStorage)에 둔다. 화면·통신 없음 — 저장소는 받아서 쓰고, 막혀 있으면(개인 정보 보호 모드) 조용히 빈 값
import { pendingLeft, type ChatItem } from './chat';

export type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

/** sending = 서버에 보내는 중 · sent = 서버가 받았고 대화 기록에 뜨길 기다림 · failed = 못 보냄(다시 보내기) */
export type OutStatus = 'sending' | 'sent' | 'failed';
/** session = 보낸 세션 id(앱 세션 id — /api/send 에 넣는 값) */
/** checked = 기록에 안 떠서 맥에 마지막으로 물어본 때(send-status) */
export type OutMsg = { id: string; session: string; text: string; at: number; status: OutStatus; error?: string; checked?: number };

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

/** 되살린 파일 이름표의 마지막 번호 — 다음에 붙이는 건 그다음 번호부터 */
export function labelCounts(files: { label: string }[]): { img: number; file: number } {
  const max = (kind: string) => files.reduce((n, f) => Math.max(n, Number(new RegExp(`^@${kind}(\\d+)$`).exec(f.label)?.[1] ?? 0)), 0);
  return { img: max('img'), file: max('file') };
}

/** 보낸 지 이만큼 지나도 기록에 없으면 맥에 물어본다 — 바쁜 참모는 끼어든 말을 늦게 적는다 */
export const CHECK_AFTER = 60_000;
const CHECK_GAP = 15_000;

/** 맥에 물어볼 때인가 — 서버가 받았다고 한(또는 응답을 못 받은) 말이 기록에 안 떴을 때만, 15초에 한 번 */
export const dueForCheck = (m: OutMsg, now: number) =>
  m.status === 'sent' && now - m.at >= CHECK_AFTER && (m.checked === undefined || now - m.checked >= CHECK_GAP);

/** 맥 답(send-status) — 쳤거나 치는 중이면 계속 기다리고, 실패·모름(맥이 안 받음·다시 켜짐)이면 다시 보내기로 */
export function applyStatus(list: OutMsg[], id: string, state: string, error: string | undefined, now: number): OutMsg[] {
  if (state === 'failed' || state === 'unknown') return markOut(list, id, 'failed', state === 'failed' ? error || '못 쳤어요' : '맥이 이 말을 못 받았어요');
  return list.map((m) => (m.id === id ? { ...m, checked: now } : m));
}
