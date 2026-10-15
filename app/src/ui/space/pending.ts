// 스페이스에서 고친 것 모아 두기 — 문서마다 기준(연 때 또는 지난번 보낸 때)과 지금. "참모에게 보내기"가 한 번에 차이를 보낸다.
// 이 컴퓨터에 기억(localStorage) — 앱을 껐다 켜도 안 보낸 고친 것이 남는다
import { useSyncExternalStore } from 'react';
import { mdDiff, type LineComment, type MdDiff } from '../../domain/space';
import { rebase } from '../../domain/docMerge';
import { addLog, countOf, EMPTY as SHEET_EMPTY, type SheetPending } from '../../domain/sheetPending';
import type { LogEntry } from '../../domain/sheetLog';

type Doc = { baseline: string; current: string };
const KEY = 'spacePending';
const dirty = (d: Doc) => d.baseline !== d.current;
// 안 고친 문서는 들이지 않는다 — 예전엔 열어 본 문서가 다 쌓여(실측 107개·180만 자) 아래 emit 이 키마다 전부를 다시 셌다
const load = (): Map<string, Doc> => { try { return new Map(Object.entries(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Doc>).filter(([, d]) => dirty(d))); } catch { return new Map(); } };
const docs = load();
/** 문서마다 줄 차이 — 바뀐 문서만 다시 센다(키 하나에 열어 본 문서 전부를 다시 세서 글자가 늦게 찍혔다, 2026-10-11 사용자) */
const diffs = new Map<string, MdDiff>();
const NONE: MdDiff = { added: [], removed: [] };
const put = (path: string, d: Doc) => { docs.set(path, d); diffs.set(path, dirty(d) ? mdDiff(d.baseline, d.current) : NONE); };
docs.forEach((d, p) => put(p, d));
// 줄 코멘트 — 편집기에서 커서 있던 줄에 단 말. 보내기에 같이 간다
const CKEY = 'spaceComments';
let comments: (LineComment & { id: string })[] = (() => { try { return JSON.parse(localStorage.getItem(CKEY) ?? '[]'); } catch { return []; } })();
// 엑셀 — 파일마다 저장한 고친 칸·행열 메모(domain/sheetPending)
const SKEY = 'spacePendingSheets';
const sheets: Map<string, SheetPending> = (() => { try { return new Map(Object.entries(JSON.parse(localStorage.getItem(SKEY) ?? '{}') as Record<string, SheetPending>).filter(([, x]) => countOf(x))); } catch { return new Map(); } })();
let state: { docs: { path: string; diff: MdDiff }[]; comments: (LineComment & { id: string })[]; sheets: { path: string; pending: SheetPending }[] } = { docs: [], comments, sheets: [] };
const listeners = new Set<() => void>();
/** 기억 쓰기 — 고친 문서만. 치는 동안은 1초에 한 번으로 모은다(키마다 문서 글 통째로 쓰지 않게), 창을 닫을 때·보낼 때·코멘트는 바로 */
const SAVE_MS = 1000;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const persist = () => {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries([...docs].filter(([, d]) => dirty(d)))));
    localStorage.setItem(CKEY, JSON.stringify(comments));
    localStorage.setItem(SKEY, JSON.stringify(Object.fromEntries(sheets)));
  } catch { /* 이번 실행 동안은 기억 */ }
};
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', persist);
  window.addEventListener('beforeunload', persist);
}
const emit = (now = false) => {
  state = { docs: [...docs.keys()].map((path) => ({ path, diff: diffs.get(path) ?? NONE })).filter((x) => x.diff.added.length || x.diff.removed.length), comments, sheets: [...sheets].map(([path, pending]) => ({ path, pending })) };
  if (now) persist();
  else saveTimer ??= setTimeout(persist, SAVE_MS);
  listeners.forEach((f) => f());
};
emit();

/** 편집기가 처음 읽었다 다시 쓴 모양 — 이 문서의 기준이 없거나 안 고친 채일 때만(안 보낸 고친 게 있으면 그 기준을 지킨다).
 *  안 고친 채면 지금 글이 새 기준 — 닫혀 있던 동안 밖(참모·세션)이 고친 줄을 사용자가 고친 것으로 세지 않게 */
export function setBaseline(path: string, md: string) {
  const d = docs.get(path);
  if (d && (dirty(d) || d.baseline === md)) return;
  put(path, { baseline: md, current: md });
  emit();
}
export function setCurrent(path: string, md: string) {
  const d = docs.get(path);
  if (!d || d.current === md) return;
  const next = { ...d, current: md };
  put(path, next);
  emit(!dirty(d) && dirty(next)); // 처음 고친 순간은 바로 기억 — 1초 안에 앱이 꺼져도 '보낼 것'에서 안 빠지게
}
export function addComment(c: LineComment) {
  comments = [...comments, { ...c, id: `${Date.now()}-${comments.length}` }];
  emit(true);
}
export function removeComment(id: string) {
  comments = comments.filter((c) => c.id !== id);
  emit(true);
}
/** 엑셀 페이지가 저장한 기록 — 고친 칸을 보낼 것에 더한다(저장된 것만 — 못 쓴 고침을 보냈다고 하지 않게) */
export function addSheetLog(path: string, log: LogEntry[]) {
  const next = addLog(sheets.get(path) ?? SHEET_EMPTY, log);
  const had = sheets.has(path);
  if (countOf(next)) sheets.set(path, next); else sheets.delete(path);
  emit(!had && sheets.has(path));
}
/** 보냈다 — 지금 모양이 새 기준, 코멘트는 비운다 */
export function markSent() {
  docs.forEach((d, p) => put(p, { baseline: d.current, current: d.current }));
  sheets.clear();
  comments = [];
  emit(true);
}
/** 지금 보낼 것(시험·훅이 같이 읽는다) */
export const pendingNow = () => state;
/** 보낼 것 — 고친 문서들 + 줄 코멘트 */
export function usePending() {
  return useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, pendingNow);
}
/** 밖(참모·세션)에서 들어온 변경(before → after) — '사용자가 고친 것'이 아니다. 기준에도 같은 바깥 변경을 옮겨서
 *  보낼 것엔 사용자가 고친 줄만 남게(줄 단위 3자 합치기 — 기준과 겹쳐 못 옮기면 지금 판만 바꾼다) */
export function absorbOutside(path: string, before: string, after: string) {
  const d = docs.get(path);
  if (!d) return;
  put(path, { baseline: rebase(d.baseline, before, after) ?? d.baseline, current: after });
  emit();
}
