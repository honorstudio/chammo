// 참모 대시보드의 할 일·최근 결정을 노션처럼 고치고, 고친 것만 모아 참모에게 지시로 보낸다(v11 X·M, 2026-09-30 사용자).
// 앱이 할 일 파일·starter 를 직접 바꾸지 않는다 — 참모가 이유를 알고 반영하게 말로 보낸다

export type NoteBase = { tasks: { id: string; text: string; done: boolean }[]; decisions: string[] };
export type NoteEditsT = {
  tasks: Record<string, { text?: string; done?: boolean; removed?: boolean }>;
  addedTasks: { id: string; text: string }[];
  /** 할 일 순서(끌어서 바꿨을 때만) — 할 일 id 들 */
  order?: string[];
  /** 결정은 자리(0,1,…) 기준 */
  decisions: Record<string, { text?: string; removed?: boolean }>;
  addedDecisions: string[];
};
export const emptyEdits = (): NoteEditsT => ({ tasks: {}, addedTasks: [], decisions: {}, addedDecisions: [] });

export type TaskRow = { id: string; text: string; done: boolean; state: 'same' | 'changed' | 'removed' | 'added' };
export type DecRow = { key: string; text: string; state: 'same' | 'changed' | 'removed' | 'added' };

export function applyNotes(base: NoteBase, e: NoteEditsT): { tasks: TaskRow[]; decisions: DecRow[] } {
  const rows: TaskRow[] = base.tasks.map((t) => {
    const x = e.tasks[t.id] ?? {};
    const text = x.text ?? t.text;
    const done = x.done ?? t.done;
    return { id: t.id, text, done, state: x.removed ? 'removed' : text !== t.text || done !== t.done ? 'changed' : 'same' };
  });
  for (const a of e.addedTasks) rows.push({ id: a.id, text: a.text, done: false, state: 'added' });
  const ordered = e.order ? [...e.order.map((id) => rows.find((r) => r.id === id)).filter((r): r is TaskRow => !!r), ...rows.filter((r) => !e.order!.includes(r.id))] : rows;
  const decs: DecRow[] = base.decisions.map((d, i) => {
    const x = e.decisions[String(i)] ?? {};
    const text = x.text ?? d;
    return { key: String(i), text, state: x.removed ? 'removed' : text !== d ? 'changed' : 'same' };
  });
  e.addedDecisions.forEach((d, i) => decs.push({ key: `n${i}`, text: d, state: 'added' }));
  return { tasks: ordered, decisions: decs };
}

/** 보낼 말 — 고친 게 없으면 '' */
export function composeNoteSend(base: NoteBase, e: NoteEditsT, memo: string): string {
  const task: string[] = [];
  for (const a of e.addedTasks) if (a.text.trim()) task.push(`+ ${a.text.trim()}`);
  // 더함 → 뺌 → 고침·끝남 순서로(읽기 쉽게)
  for (const t of base.tasks) if (e.tasks[t.id]?.removed) task.push(`- ${t.text} (빼)`);
  for (const t of base.tasks) {
    const x = e.tasks[t.id];
    if (!x || x.removed) continue;
    if (x.text !== undefined && x.text !== t.text) task.push(`~ ${t.text}`, `  → ${x.text}`);
    if (x.done !== undefined && x.done !== t.done) task.push(x.done ? `✓ ${x.text ?? t.text} (끝난 걸로)` : `○ ${x.text ?? t.text} (다시 열기)`);
  }
  if (e.order && e.order.join() !== base.tasks.map((t) => t.id).join()) {
    const name = (id: string) => base.tasks.find((t) => t.id === id)?.text ?? e.addedTasks.find((a) => a.id === id)?.text ?? id;
    task.push(`순서: ${e.order.map(name).join(' → ')}`);
  }
  const dec: string[] = [];
  for (const d of e.addedDecisions) if (d.trim()) dec.push(`+ ${d.trim()}`);
  base.decisions.forEach((d, i) => {
    const x = e.decisions[String(i)];
    if (!x) return;
    if (x.removed) dec.push(`- ${d} (빼)`);
    else if (x.text !== undefined && x.text !== d) dec.push(`~ ${d}`, `  → ${x.text}`);
  });
  if (!task.length && !dec.length) return '';
  const out = ['[할 일·결정] 사용자가 고친 것'];
  if (task.length) out.push('■ 할 일', ...task);
  if (dec.length) out.push('■ 최근 결정', ...dec);
  if (memo.trim()) out.push(`메모: ${memo.trim()}`);
  return out.join('\n');
}

/** 끌어 온 줄(from)을 놓은 줄(target) 위(after=false)·아래(after=true)로 옮긴 순서 */
export function moveId(ids: string[], from: string, target: string, after: boolean): string[] {
  if (from === target || !ids.includes(from) || !ids.includes(target)) return ids;
  const rest = ids.filter((id) => id !== from);
  rest.splice(rest.indexOf(target) + (after ? 1 : 0), 0, from);
  return rest;
}

/** 할 일·결정 판 접힘 — localStorage 값 '1' 이면 접힘. 저장소가 막혀 있으면(사파리 사생활 모드 등) 펼침 */
export function foldedFrom(read: () => string | null): boolean {
  try {
    return read() === '1';
  } catch {
    return false;
  }
}
