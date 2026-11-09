// 남긴 말 — 데스크톱·폰이 같이 쓴다. 파일 읽고 쓰는 길(io)만 다르다. 표시할 때마다 저장(시안 검토와 같은 curation/ 자리)
import { useCallback, useEffect, useRef, useState } from 'react';
import { addNote, editNote, parseRecord, removeNote, resultText, type VrFrom, type VrNote } from '../../domain/videoReview';

export type VrIo = { load: () => Promise<string>; save: (md: string, json: string) => Promise<unknown> };
export type VrMeta = { duration?: number; fps?: number; recordPath?: string };

const newId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function useVrNotes(path: string, from: VrFrom, io: VrIo, meta: VrMeta) {
  const [notes, setNotes] = useState<VrNote[]>([]);
  const [ready, setReady] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const ioRef = useRef(io);
  ioRef.current = io;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  /** 기록 머리 — 참모 필름이 적은 칸(filmSeen)까지 그대로 다시 쓴다 */
  const sourceRef = useRef<Record<string, unknown>>({});
  const notesRef = useRef(notes);
  notesRef.current = notes;

  useEffect(() => {
    let live = true;
    setReady(false);
    ioRef.current.load().then((j) => { if (live) { const r = parseRecord(j, path); sourceRef.current = r.source; setNotes(r.notes); setReady(true); } }, () => { if (live) setReady(true); });
    return () => { live = false; };
  }, [path]);

  const text = useCallback((list: VrNote[]) => resultText({ path, duration: metaRef.current.duration, notes: list, recordPath: metaRef.current.recordPath }), [path]);

  // 저장은 한 줄로 — 앞 저장이 늦게 끝나 옛 판이 새 판을 덮지 않게. 실패하면 말은 화면에 남고 다음 변경·다시 시도에 또 쓴다
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const persist = useCallback((list: VrNote[]) => {
    const m = metaRef.current;
    const json = JSON.stringify({ v: 1, source: { ...sourceRef.current, path, ...(m.duration ? { duration: m.duration } : {}), ...(m.fps ? { fps: m.fps } : {}) }, notes: list });
    queue.current = queue.current.then(() => ioRef.current.save(text(list), json)).then(() => setSaveFailed(false), () => setSaveFailed(true));
  }, [path, text]);

  const change = useCallback((next: VrNote[]) => {
    if (next === notesRef.current) return;
    notesRef.current = next;
    setNotes(next);
    persist(next);
  }, [persist]);

  const add = useCallback((t: number, body: string): string | null => {
    const id = newId();
    const next = addNote(notesRef.current, t, body, { id, at: new Date().toISOString(), from });
    if (next === notesRef.current) return null;
    change(next);
    return id;
  }, [change, from]);
  const edit = useCallback((id: string, body: string) => change(editNote(notesRef.current, id, body)), [change]);
  const remove = useCallback((id: string) => change(removeNote(notesRef.current, id)), [change]);
  // 저장 실패는 말을 들고 있다가 5초 뒤 다시 — 사람이 할 일 없다
  useEffect(() => {
    if (!saveFailed) return;
    const t = window.setTimeout(() => persist(notesRef.current), 5000);
    return () => window.clearTimeout(t);
  }, [saveFailed, persist]);

  return { notes, ready, saveFailed, add, edit, remove, text: () => text(notesRef.current) };
}
export type VrNotes = ReturnType<typeof useVrNotes>;
