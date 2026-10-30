import { invoke } from '@tauri-apps/api/core';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useShownRef } from './docKeep';
import { joinEol, outsideStep, splitEol } from '../../domain/textDoc';
import { tr } from '../../i18n';
import './editorTone.css'; // 바깥 변경·충돌 띠(.cv-doc-sync) 모양
import { lastSaved, newSession, readOutside, saveNow, saveSoon, setBase } from './docSave';
import { absorbOutside, setBaseline } from './pending';
import type { SyncState } from './docSync';

const EVERY = 1500;

/**
 * 글 파일(.txt) 편집 — 노션식 블록 없이 고정폭 글 그대로 고친다(2026-10-12 사용자: 보관함 탭에서 .txt 가 읽기 전용 미리보기라 못 고쳤다).
 * 저장·바깥 변경은 md 편집기(docSave·docSync)와 같은 길: 마지막으로 본 파일 글(expected)과 지금 파일이 맞을 때만 쓰고,
 * 1.5초마다(창에 돌아올 때도) 파일 도장을 봐서 바깥이 고쳤으면 — 내가 안 고쳤으면 그대로 받고, 둘 다 고쳤으면 저장을 멈춰 고르게 한다
 */
export default function TextEditor({ text, path }: { text: string; path: string }) {
  const eol = useRef(splitEol(text));
  const [value, setValue] = useState(eol.current.text);
  const mine = useRef(value);
  const ses = useRef(newSession(path, text));
  const theirs = useRef<{ text: string; stamp: string } | null>(null);
  const busy = useRef(false);
  const gone = useRef(false);
  const [state, setState] = useState<SyncState>('ok');
  const area = useRef<HTMLTextAreaElement>(null);
  /** 편집칸 글 → 파일에 쓸 글 */
  const file = (v: string) => joinEol(v, eol.current.crlf);

  // 내용만큼 키운다 — 스크롤은 md 문서처럼 바깥 칸(.cv-doc-scroll)이 맡는다
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const tickRef = useRef<() => void>(() => {});
  const shownRef = useShownRef(() => tickRef.current()); // 다시 보이면 바로 한 번(ui/space/docKeep)
  useEffect(() => {
    lastSaved.set(path, text);
    setBaseline(path, text);
    const s = ses.current;
    /** 바깥 판을 편집칸에 받는다 */
    const take = (t: string, stamp: string) => {
      const before = file(mine.current);
      eol.current = splitEol(t);
      mine.current = eol.current.text;
      setValue(mine.current);
      setBase(s, t, stamp);
      lastSaved.set(path, t);
      absorbOutside(path, before, t);
      setState('ok');
    };
    const tick = async () => {
      if (busy.current || s.writing || !shownRef.current) return; // 살려 둔(숨은) 글 칸은 바깥 고침을 안 읽는다
      busy.current = true;
      try {
        const ver = s.base.ver;
        let stamp: string;
        try { stamp = await invoke<string>('doc_stamp', { path }); } catch { gone.current = true; setState((x) => (x === 'conflict' ? x : 'gone')); return; }
        if (gone.current) {
          // 파일이 돌아왔다 — 없던 동안 못 쓴 내 판을 다시 저장한다
          gone.current = false;
          setState((x) => (x === 'gone' ? 'ok' : x));
          if (lastSaved.get(path) !== file(mine.current)) { saveSoon(s, file(mine.current)); return; }
        }
        if (s.blocked ? stamp === theirs.current?.stamp : stamp === s.base.stamp) return;
        const got = await readOutside(path);
        if (got && 'unreadable' in got) { setState((x) => (x === 'conflict' ? x : 'unreadable')); return; }
        if (!got) return; // 다른 실패 — 다음 감시에서 다시
        setState((x) => (x === 'unreadable' ? 'ok' : x));
        if (s.base.ver !== ver || s.writing) return;
        if (s.blocked) { theirs.current = { text: got.text, stamp }; return; } // 충돌 중 — 고를 때 최신 바깥 판으로
        const step = outsideStep(s.base.text, file(mine.current), got.text);
        if (step === 'same' || step === 'adopt') { setBase(s, got.text, stamp); return; }
        if (step === 'take') { take(got.text, stamp); return; }
        s.blocked = true; // 둘 다 고쳤다 — 저장을 멈추고 사람이 고른다
        theirs.current = { text: got.text, stamp };
        setState('conflict');
      } finally {
        busy.current = false;
      }
    };
    s.onOutside = () => void tick();
    s.onGone = () => { gone.current = true; setState('gone'); };
    tickRef.current = () => void tick();
    const t = window.setInterval(() => void tick(), EVERY);
    const focus = () => void tick();
    window.addEventListener('focus', focus);
    void tick();
    return () => { s.onOutside = undefined; s.onGone = undefined; window.clearInterval(t); window.removeEventListener('focus', focus); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const keepMine = async () => {
    const s = ses.current, t = theirs.current;
    if (!t) return;
    await invoke('keep_doc_version', { path, text: t.text, tag: 'outside' }).catch(() => {}); // 덮일 바깥 판을 먼저 남긴다
    s.blocked = false;
    setBase(s, t.text, t.stamp);
    theirs.current = null;
    setState('ok');
    await saveNow(s, file(mine.current));
  };
  const takeTheirs = async () => {
    const s = ses.current, t = theirs.current;
    if (!t) return;
    const before = file(mine.current);
    await invoke('keep_doc_version', { path, text: before }).catch(() => {}); // 내가 친 판도 남긴다
    eol.current = splitEol(t.text);
    mine.current = eol.current.text;
    setValue(mine.current);
    setBase(s, t.text, t.stamp);
    lastSaved.set(path, t.text);
    absorbOutside(path, before, t.text);
    s.blocked = false;
    theirs.current = null;
    setState('ok');
  };

  return (
    <div className="space-editor cv-text-edit">
      {state === 'conflict' && (
        <div className="cv-doc-sync" role="alert">
          <span>{tr('다른 곳에서도 이 문서를 고쳤어요. 같은 부분이 겹쳐서 저장을 멈췄어요. 고르지 않은 쪽은 기록에 남아요.', 'This document was also changed elsewhere. Both sides edited the same part, so saving is paused. The version you do not pick is kept in history.')}</span>
          <button onClick={() => void takeTheirs()}>{tr('바깥 판 불러오기', 'Load the outside version')}</button>
          <button className="solid" onClick={() => void keepMine()}>{tr('내 판으로 저장', 'Save my version')}</button>
        </div>
      )}
      {state === 'gone' && (
        <div className="cv-doc-sync" role="alert">
          <span>{tr('파일이 지워졌거나 이름이 바뀌었어요. 여기서 고친 내용은 저장되지 않아요(마지막 내용은 기록에 남아요).', 'This file was deleted or renamed. Edits here are not saved (the last version is kept in history).')}</span>
        </div>
      )}
      {state === 'unreadable' && (
        <div className="cv-doc-sync" role="alert">
          <span>{tr('다른 곳에서 이 파일을 UTF-8이 아닌 형식(EUC-KR 등)으로 저장해서 읽을 수 없어요. UTF-8로 다시 저장되기 전까지 여기서 고친 내용은 저장되지 않아요.', 'This file was saved elsewhere in a non-UTF-8 encoding and cannot be read. Edits here are not saved until it is saved as UTF-8 again.')}</span>
        </div>
      )}
      <textarea ref={area} className="cv-text-area" value={value} spellCheck={false} aria-label={tr('글 파일', 'Text file')}
        onChange={(e) => { mine.current = e.target.value; setValue(e.target.value); saveSoon(ses.current, file(e.target.value)); }} />
    </div>
  );
}
