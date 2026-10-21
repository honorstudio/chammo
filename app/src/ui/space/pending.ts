// 스페이스에서 고친 것 모아 두기 — 문서마다 기준(연 때 또는 지난번 보낸 때)과 지금. "참모에게 보내기"가 한 번에 차이를 보낸다.
// 이 컴퓨터에 기억(localStorage) — 앱을 껐다 켜도 안 보낸 고친 것이 남는다
import { useSyncExternalStore } from 'react';
import { mdDiff, type LineComment, type MdDiff } from '../../domain/space';
import { rebase } from '../../domain/docMerge';
import { addLog, countOf, EMPTY as SHEET_EMPTY, type SheetPending } from '../../domain/sheetPending';
import type { LogEntry } from '../../domain/sheetLog';

type Doc = { baseline: string; current: string };
type Comment = LineComment & { id: string };
const KEY = 'spacePending';
const CKEY = 'spaceComments'; // 줄 코멘트 — 편집기에서 커서 있던 줄에 단 말. 보내기에 같이 간다
const SKEY = 'spacePendingSheets'; // 엑셀 — 파일마다 저장한 고친 칸·행열 메모(domain/sheetPending)
const dirty = (d: Doc) => d.baseline !== d.current;
const read = <T>(k: string, empty: T): T => { try { return (JSON.parse(localStorage.getItem(k) ?? 'null') as T | null) ?? empty; } catch { return empty; } };
// 안 고친 문서는 들이지 않는다 — 예전엔 열어 본 문서가 다 쌓여(실측 107개·180만 자) 아래 emit 이 키마다 전부를 다시 셌다
const storedDocs = () => Object.fromEntries(Object.entries(read<Record<string, Doc>>(KEY, {})).filter(([, d]) => dirty(d)));
const storedSheets = () => Object.fromEntries(Object.entries(read<Record<string, SheetPending>>(SKEY, {})).filter(([, x]) => countOf(x)));
const docs = new Map<string, Doc>(Object.entries(storedDocs()));
// 예전에 쌓인 안 고친 문서는 켤 때 한 번 정리 — 고친 것만 다시 쓴다(지우기만 하니 다른 창 것을 잃지 않는다)
try { if (Object.keys(read<Record<string, Doc>>(KEY, {})).length > docs.size) localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(docs))); } catch { /* 다음에 */ }
/** 문서마다 줄 차이 — 바뀐 문서만 다시 센다(키 하나에 열어 본 문서 전부를 다시 세서 글자가 늦게 찍혔다, 2026-10-11 사용자) */
const diffs = new Map<string, MdDiff>();
const NONE: MdDiff = { added: [], removed: [] };
const put = (path: string, d: Doc) => { docs.set(path, d); diffs.set(path, dirty(d) ? mdDiff(d.baseline, d.current) : NONE); };
docs.forEach((d, p) => put(p, d));
let comments: Comment[] = read<Comment[]>(CKEY, []);
const sheets = new Map<string, SheetPending>(Object.entries(storedSheets()));
let state: { docs: { path: string; diff: MdDiff }[]; comments: Comment[]; sheets: { path: string; pending: SheetPending }[] } = { docs: [], comments, sheets: [] };
const listeners = new Set<() => void>();
// 메인 창과 리더 창이 같은 기억을 나눠 쓴다 — 예전엔 창마다 통째로 덮어써서 리더에서 코멘트를 달면 메인 창의 아직 안 쓴 고친 것이 빠졌다(fix/md-lag 남은 것).
// 쓸 때는 기억을 다시 읽어 이 창이 바꾼 것(touched)만 얹고, 다른 창이 쓰면 storage 사건으로 받아 합친다(이 창이 아직 안 쓴 것은 지킨다)
const touched = { docs: new Set<string>(), sheets: new Set<string>(), added: new Set<string>(), removed: new Set<string>() };
const touchedAny = () => touched.docs.size + touched.sheets.size + touched.added.size + touched.removed.size > 0;
/** 기억 쓰기 — 고친 문서만. 치는 동안은 1초에 한 번으로 모은다(키마다 문서 글 통째로 쓰지 않게), 창을 닫을 때·보낼 때·코멘트는 바로 */
const SAVE_MS = 1000;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const persist = () => {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!touchedAny()) return;
  try {
    const d = storedDocs();
    for (const p of touched.docs) { const x = docs.get(p); if (x && dirty(x)) d[p] = x; else delete d[p]; }
    const sh = storedSheets();
    for (const p of touched.sheets) { const x = sheets.get(p); if (x) sh[p] = x; else delete sh[p]; }
    const c = read<Comment[]>(CKEY, []).filter((x) => !touched.removed.has(x.id));
    for (const x of comments) if (touched.added.has(x.id) && !c.some((y) => y.id === x.id)) c.push(x);
    localStorage.setItem(KEY, JSON.stringify(d));
    localStorage.setItem(CKEY, JSON.stringify(c));
    localStorage.setItem(SKEY, JSON.stringify(sh));
    const more = c.length !== comments.length; // 다른 창 코멘트를 사건보다 먼저 만났다 — 화면에도
    comments = c;
    touched.docs.clear(); touched.sheets.clear(); touched.added.clear(); touched.removed.clear();
    if (more) emit('none');
  } catch { /* 이번 실행 동안은 기억 — touched 를 남겨 다음에 다시 쓴다 */ }
};
/** 다른 창이 기억에 썼다 — 이 창이 아직 안 쓴 것(touched)은 지키고 나머지는 기억대로. 기억에 없어진 고친 문서는 다른 창이 보낸 것 */
const sync = () => {
  const d = storedDocs();
  for (const [p, x] of Object.entries(d)) { const cur = docs.get(p); if (!touched.docs.has(p) && (!cur || cur.baseline !== x.baseline || cur.current !== x.current)) put(p, x); }
  for (const [p, x] of docs) if (dirty(x) && !touched.docs.has(p) && !(p in d)) put(p, { baseline: x.current, current: x.current });
  const sh = storedSheets();
  for (const p of [...sheets.keys()]) if (!touched.sheets.has(p) && !(p in sh)) sheets.delete(p);
  for (const [p, x] of Object.entries(sh)) if (!touched.sheets.has(p)) sheets.set(p, x);
  const c = read<Comment[]>(CKEY, []).filter((x) => !touched.removed.has(x.id));
  for (const x of comments) if (touched.added.has(x.id) && !c.some((y) => y.id === x.id)) c.push(x);
  comments = c;
  emit('none');
};
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', persist);
  window.addEventListener('beforeunload', persist);
  window.addEventListener('storage', (e: StorageEvent) => { if (e.key === null || e.key === KEY || e.key === CKEY || e.key === SKEY) sync(); });
}
const emit = (save: 'now' | 'later' | 'none' = 'later') => {
  state = { docs: [...docs.keys()].map((path) => ({ path, diff: diffs.get(path) ?? NONE })).filter((x) => x.diff.added.length || x.diff.removed.length), comments, sheets: [...sheets].map(([path, pending]) => ({ path, pending })) };
  if (save === 'now') persist();
  else if (save === 'later') saveTimer ??= setTimeout(persist, SAVE_MS);
  listeners.forEach((f) => f());
};
emit('none');

/** 편집기가 처음 읽었다 다시 쓴 모양 — 이 문서의 기준이 없거나 안 고친 채일 때만(안 보낸 고친 게 있으면 그 기준을 지킨다).
 *  안 고친 채면 지금 글이 새 기준 — 닫혀 있던 동안 밖(참모·세션)이 고친 줄을 사용자가 고친 것으로 세지 않게 */
export function setBaseline(path: string, md: string) {
  const d = docs.get(path);
  if (d && (dirty(d) || d.baseline === md)) return;
  put(path, { baseline: md, current: md });
  emit('none'); // 안 고친 문서는 기억에 안 쓴다
}
export function setCurrent(path: string, md: string) {
  const d = docs.get(path);
  if (!d || d.current === md) return;
  const next = { ...d, current: md };
  put(path, next);
  touched.docs.add(path);
  emit(!dirty(d) && dirty(next) ? 'now' : 'later'); // 처음 고친 순간은 바로 기억 — 1초 안에 앱이 꺼져도 '보낼 것'에서 안 빠지게
}
export function addComment(c: LineComment) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; // 창이 둘이라 개수로는 겹친다
  comments = [...comments, { ...c, id }];
  touched.added.add(id);
  emit('now');
}
export function removeComment(id: string) {
  comments = comments.filter((c) => c.id !== id);
  touched.added.delete(id);
  touched.removed.add(id);
  emit('now');
}
/** 엑셀 페이지가 저장한 기록 — 고친 칸을 보낼 것에 더한다(저장된 것만 — 못 쓴 고침을 보냈다고 하지 않게) */
export function addSheetLog(path: string, log: LogEntry[]) {
  const next = addLog(sheets.get(path) ?? SHEET_EMPTY, log);
  const had = sheets.has(path);
  if (countOf(next)) sheets.set(path, next); else sheets.delete(path);
  touched.sheets.add(path);
  emit(!had && sheets.has(path) ? 'now' : 'later');
}
/** 보냈다 — 보낸 문서(paths)만 지금 모양이 새 기준, 그 문서 코멘트만 비운다. 다른 문서(다른 채팅·참모 스페이스)의 고친 것은 그대로 */
export function markSent(paths: string[]) {
  const sent = new Set(paths);
  docs.forEach((d, p) => { if (!sent.has(p)) return; if (dirty(d)) touched.docs.add(p); put(p, { baseline: d.current, current: d.current }); });
  for (const p of sent) if (sheets.delete(p)) touched.sheets.add(p);
  comments.filter((c) => sent.has(c.path)).forEach((c) => { touched.added.delete(c.id); touched.removed.add(c.id); });
  comments = comments.filter((c) => !sent.has(c.path));
  emit('now');
}
type Pending = typeof state;
/** 지금 보는 문서 몫만 — 보내기는 그 문서의 고친 것·코멘트만 싣는다(2026-10-21: 모음이 앱 전체에 하나라 다른 참모 문서 4개가 같이 갔다) */
export const scopeTo = (p: Pending, path: string | null | undefined): Pending =>
  ({ docs: p.docs.filter((d) => d.path === path), comments: p.comments.filter((c) => c.path === path), sheets: p.sheets.filter((x) => x.path === path) });
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
  touched.docs.add(path);
  emit();
}
