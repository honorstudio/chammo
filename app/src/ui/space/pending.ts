// 스페이스에서 고친 것 모아 두기 — 문서마다 기준(연 때 또는 지난번 보낸 때)과 지금. "참모에게 보내기"가 한 번에 차이를 보낸다.
// 이 컴퓨터에 기억(localStorage) — 앱을 껐다 켜도 안 보낸 고친 것이 남는다
import { useSyncExternalStore } from 'react';
import { mdDiff, type LineComment, type MdDiff } from '../../domain/space';
import { rebase } from '../../domain/docMerge';

type Doc = { baseline: string; current: string };
const KEY = 'spacePending';
const load = (): Map<string, Doc> => { try { return new Map(Object.entries(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Doc>)); } catch { return new Map(); } };
let docs = load();
let snap: { path: string; diff: MdDiff }[] = [];
// 줄 코멘트 — 편집기에서 커서 있던 줄에 단 말. 보내기에 같이 간다
const CKEY = 'spaceComments';
let comments: (LineComment & { id: string })[] = (() => { try { return JSON.parse(localStorage.getItem(CKEY) ?? '[]'); } catch { return []; } })();
let state: { docs: { path: string; diff: MdDiff }[]; comments: (LineComment & { id: string })[] } = { docs: [], comments };
const listeners = new Set<() => void>();
const emit = () => {
  snap = [...docs].map(([path, d]) => ({ path, diff: mdDiff(d.baseline, d.current) })).filter((x) => x.diff.added.length || x.diff.removed.length);
  state = { docs: snap, comments };
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(docs))); localStorage.setItem(CKEY, JSON.stringify(comments)); } catch { /* 이번 실행 동안은 기억 */ }
  listeners.forEach((f) => f());
};
emit();

/** 편집기가 처음 읽었다 다시 쓴 모양 — 이 문서의 기준이 없을 때만(안 보낸 고친 게 있으면 그 기준을 지킨다) */
export function setBaseline(path: string, md: string) {
  if (docs.has(path)) return;
  docs.set(path, { baseline: md, current: md });
  emit();
}
export function setCurrent(path: string, md: string) {
  const d = docs.get(path);
  if (!d || d.current === md) return;
  docs.set(path, { ...d, current: md });
  emit();
}
export function addComment(c: LineComment) {
  comments = [...comments, { ...c, id: `${Date.now()}-${comments.length}` }];
  emit();
}
export function removeComment(id: string) {
  comments = comments.filter((c) => c.id !== id);
  emit();
}
/** 보냈다 — 지금 모양이 새 기준, 코멘트는 비운다 */
export function markSent() {
  docs = new Map([...docs].map(([p, d]) => [p, { baseline: d.current, current: d.current }]));
  comments = [];
  emit();
}
/** 보낼 것 — 고친 문서들 + 줄 코멘트 */
export function usePending() {
  return useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => state);
}
/** 밖(참모·세션)에서 들어온 변경(before → after) — '사용자가 고친 것'이 아니다. 기준에도 같은 바깥 변경을 옮겨서
 *  보낼 것엔 사용자가 고친 줄만 남게(줄 단위 3자 합치기 — 기준과 겹쳐 못 옮기면 지금 판만 바꾼다) */
export function absorbOutside(path: string, before: string, after: string) {
  const d = docs.get(path);
  if (!d) return;
  docs.set(path, { baseline: rebase(d.baseline, before, after) ?? d.baseline, current: after });
  emit();
}
