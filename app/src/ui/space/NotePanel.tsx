import { useEffect, useRef, useState } from 'react';
import { applyNotes, composeNoteSend, emptyEdits, moveId, type NoteBase, type NoteEditsT } from '../../domain/noteEdits';
import { tr } from '../../i18n';
import { IconClose, IconPlus, IconSend } from '../Icons';

const load = (k: string): NoteEditsT => { try { return { ...emptyEdits(), ...(JSON.parse(localStorage.getItem(k) ?? 'null') ?? {}) }; } catch { return emptyEdits(); } };

/** 한 줄 고치기 — 누르면 바로 글, Enter·밖을 누르면 적용, Esc 는 취소 */
function Line({ text, onDone, className }: { text: string; onDone: (t: string) => void; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (ref.current && ref.current.textContent !== text && document.activeElement !== ref.current) ref.current.textContent = text; }, [text]);
  return (
    <span ref={ref} className={`np-text ${className ?? ''}`} contentEditable suppressContentEditableWarning spellCheck={false}
      onBlur={(e) => { const t = (e.currentTarget.textContent ?? '').replace(/\s+/g, ' ').trim(); if (t && t !== text) onDone(t); else e.currentTarget.textContent = text; }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { e.currentTarget.textContent = text; e.currentTarget.blur(); }
      }}>{text}</span>
  );
}

/**
 * 참모 대시보드 제목 옆 — 할 일(참모 할 일 목록)·최근 결정(HQ starter)을 노션처럼 고친다(v11 X·M, 2026-09-30 사용자).
 * 고친 건 초록(더함)·빨강(뺌)·주황 줄(고침)로 남았다가 "보내기"로 참모에게 한 번에. 파일 칸을 밀지 않게 높이를 묶는다
 */
export function NotePanel({ base, storeKey, send, sendTo, onOpenStarter }: {
  base: NoteBase | null;
  storeKey: string;
  send: (text: string) => Promise<void>;
  sendTo: string;
  onOpenStarter?: () => void;
}) {
  const [tab, setTab] = useState<'tasks' | 'decisions'>('tasks');
  const [e, setE] = useState<NoteEditsT>(() => load(storeKey));
  useEffect(() => { setE(load(storeKey)); }, [storeKey]);
  const save = (next: NoteEditsT) => { setE(next); try { localStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* 이번 실행만 */ } };
  const [memo, setMemo] = useState('');
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  // 순서 바꾸기 — 웹 끌기(HTML5)는 앱 창이 가로채서 안 됐다(2026-09-30 사용자). 점 손잡이를 잡고 마우스를 따라간다
  const [dragId, setDragId] = useState<string | null>(null);
  const [hint, setHint] = useState<{ id: string; after: boolean } | null>(null);
  if (!base) return <div className="np np-empty">{tr('할 일·결정 읽는 중', 'Loading tasks and decisions')}</div>;
  const v = applyNotes(base, e);
  const text = composeNoteSend(base, e, memo);
  const changes = text ? text.split('\n').filter((l) => /^[+\-~✓○]|^순서/.test(l)).length : 0;
  const upTask = (id: string, x: { text?: string; done?: boolean; removed?: boolean }) => {
    if (id.startsWith('n')) {
      save({ ...e, addedTasks: x.removed ? e.addedTasks.filter((a) => a.id !== id) : e.addedTasks.map((a) => (a.id === id && x.text ? { ...a, text: x.text } : a)) });
      return;
    }
    save({ ...e, tasks: { ...e.tasks, [id]: { ...e.tasks[id], ...x } } });
  };
  const upDec = (key: string, x: { text?: string; removed?: boolean }) => {
    if (key.startsWith('n')) {
      const i = Number(key.slice(1));
      save({ ...e, addedDecisions: x.removed ? e.addedDecisions.filter((_, j) => j !== i) : e.addedDecisions.map((d, j) => (j === i && x.text ? x.text : d)) });
      return;
    }
    save({ ...e, decisions: { ...e.decisions, [key]: { ...e.decisions[key], ...x } } });
  };
  const add = () => {
    const t = adding.trim();
    if (!t) return;
    if (tab === 'tasks') save({ ...e, addedTasks: [...e.addedTasks, { id: `n${Date.now()}`, text: t }] });
    else save({ ...e, addedDecisions: [...e.addedDecisions, t] });
    setAdding('');
  };
  const grab = (ev: React.PointerEvent, id: string) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    setDragId(id);
    let at: { id: string; after: boolean } | null = null;
    const move = (m: PointerEvent) => {
      const row = (document.elementFromPoint(m.clientX, m.clientY) as HTMLElement | null)?.closest<HTMLElement>('.np-row[data-id]');
      const r = row?.getBoundingClientRect();
      at = row && r ? { id: row.dataset.id!, after: m.clientY > r.top + r.height / 2 } : null;
      setHint(at);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragId(null); setHint(null);
      if (at) save({ ...e, order: moveId(v.tasks.map((r) => r.id), id, at.id, at.after) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const sendAll = async () => {
    if (!text) return;
    setBusy(true);
    try {
      await send(text);
      save(emptyEdits()); setMemo(''); setSent(true);
      window.setTimeout(() => setSent(false), 1600);
    } finally { setBusy(false); }
  };
  const counts = { tasks: v.tasks.filter((t) => t.state !== 'removed' && !t.done).length, decisions: v.decisions.filter((d) => d.state !== 'removed').length };
  return (
    <div className={`np ${changes ? 'dirty' : ''}`}>
      <div className="np-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'tasks'} className={tab === 'tasks' ? 'on' : ''} onClick={() => setTab('tasks')}>{tr('할 일', 'Tasks')}<span>{counts.tasks}</span></button>
        <button role="tab" aria-selected={tab === 'decisions'} className={tab === 'decisions' ? 'on' : ''} onClick={() => setTab('decisions')}>{tr('최근 결정', 'Decisions')}<span>{counts.decisions}</span></button>
        <span className="np-sp" />
        {tab === 'decisions' && onOpenStarter && <button className="np-link" onClick={onOpenStarter}>{tr('starter', 'starter')}</button>}
      </div>
      <ul className="np-list">
        {tab === 'tasks' ? v.tasks.map((t) => (
          <li key={t.id} data-id={t.id} className={`np-row ${t.state} ${t.done ? 'done' : ''} ${dragId === t.id ? 'lifted' : ''} ${hint?.id === t.id && dragId !== t.id ? (hint.after ? 'drop-after' : 'drop-before') : ''}`}>
            <span className="np-grip" aria-hidden onPointerDown={(ev) => grab(ev, t.id)} title={tr('끌어서 순서 바꾸기', 'Drag to reorder')} />
            <button className={`np-check ${t.done ? 'on' : ''}`} onClick={() => upTask(t.id, { done: !t.done })} aria-label={t.done ? tr('다시 열기', 'Reopen') : tr('끝', 'Done')} />
            <Line text={t.text} onDone={(x) => upTask(t.id, { text: x })} />
            <button className="np-x" onClick={() => upTask(t.id, { removed: t.state !== 'removed' })} title={t.state === 'removed' ? tr('빼기 취소', 'Undo remove') : tr('빼기', 'Remove')}><IconClose /></button>
          </li>
        )) : v.decisions.map((d) => (
          <li key={d.key} className={`np-row ${d.state}`}>
            <span className="np-dot" />
            <Line text={d.text} onDone={(x) => upDec(d.key, { text: x })} />
            <button className="np-x" onClick={() => upDec(d.key, { removed: d.state !== 'removed' })} title={d.state === 'removed' ? tr('빼기 취소', 'Undo remove') : tr('빼기', 'Remove')}><IconClose /></button>
          </li>
        ))}
        <li className="np-add">
          <IconPlus />
          <input value={adding} onChange={(ev) => setAdding(ev.target.value)} placeholder={tab === 'tasks' ? tr('할 일 더하기', 'Add a task') : tr('결정 더하기', 'Add a decision')}
            onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.nativeEvent.isComposing) add(); }} />
        </li>
      </ul>
      {(changes > 0 || sent) && (
        <div className="np-foot">
          {sent ? <span className="np-sent">{tr(`${sendTo}에게 보냈어`, `Sent to ${sendTo}`)}</span> : (
            <>
              <input value={memo} onChange={(ev) => setMemo(ev.target.value)} placeholder={tr('한 줄 메모(없어도 돼요)', 'One-line note (optional)')}
                onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.nativeEvent.isComposing) void sendAll(); }} />
              <button className="np-undo" onClick={() => { save(emptyEdits()); setMemo(''); }}>{tr('되돌리기', 'Discard')}</button>
              <button className="np-send" disabled={busy} onClick={() => void sendAll()} title={text}><IconSend />{tr(`보내기 ${changes}`, `Send ${changes}`)}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
