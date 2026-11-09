// 내 메모 따로 창(notes.html?n=<메모>) — 메모 한 장 = 창 하나(시안 v2 W, 맥 스티커 메모처럼). 카드가 창을 꽉 채우고 머리가 창 머리다.
// 빨간 신호등 = 내리기(Rust notes_window 가 메타에 적는다), 패널로 되돌리기·항상 위는 머리 아이콘. 창 자리·크기는 Rust 가 기억한다
import { useEffect, useRef, useState } from 'react';
import { notesList, notesPaste, notesShare, notesWindowClose, notesWindowPin } from '../../data/tauri';
import type { NoteRow } from '../../domain/notes';
import { tr } from '../../i18n';
import { IconDockIn, IconPin, IconPinOff } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { NoteCard } from './NoteCard';
import './notes.css';

const NAME = new URLSearchParams(location.search).get('n') ?? '';
const TOP_KEY = `myNotes.top:${NAME}`;
/** 맥은 창 머리가 웹 안이라(신호등만 위에) 왼쪽에 신호등 자리를 비운다 */
const MAC = /Mac/.test(navigator.userAgent);
const savedTop = () => { try { return localStorage.getItem(TOP_KEY) === '1'; } catch { return false; } };

type W = { __notesShareDone?: (ok: boolean) => void };

/** 메인 창 입력칸에 넣고 답을 기다린다 — 메인 창이 답을 못 하면(다시 읽는 중 등) 못 넣은 걸로 */
function ask(send: () => Promise<void>): Promise<boolean> {
  return new Promise((done) => {
    const w = window as unknown as W;
    const t = window.setTimeout(() => done(false), 2000);
    w.__notesShareDone = (ok) => { window.clearTimeout(t); delete w.__notesShareDone; done(ok); };
    void send().catch(() => w.__notesShareDone?.(false));
  });
}
/** ⋯ 보여 주기 — 파일 참조 */
const share = (path: string) => ask(() => notesShare(path.slice(path.lastIndexOf('/') + 1)));
/** 보내기 아이콘 — 메모 글 통째 */
const paste = (text: string) => ask(() => notesPaste(text));

export function NotesWin() {
  const [row, setRow] = useState<NoteRow | null>(null);
  const [top, setTop] = useState(savedTop);
  const [say, setSay] = useState('');
  const hush = useRef(0);
  const tell = (m: string) => { setSay(m); window.clearTimeout(hush.current); hush.current = window.setTimeout(() => setSay(''), 3000); };
  useEffect(() => {
    void notesList().then((rows) => {
      const r = rows.find((x) => x.name === NAME);
      if (r) setRow(r); else void notesWindowClose(false); // 휴지통으로 갔거나 없는 메모 — 창만 닫는다
    }).catch(() => {});
  }, []);
  useEffect(() => {
    void notesWindowPin(top).catch(() => {});
    try { localStorage.setItem(TOP_KEY, top ? '1' : '0'); } catch { /* 이번 실행만 */ }
  }, [top]);
  useEffect(() => { document.title = row?.title || tr('내 메모', 'My notes'); }, [row?.title]);
  if (!row) return <div className="cv nt-win" />;
  return (
    <div className={`cv nt-win nt-sk sk-${row.skin}${MAC ? ' nt-mac' : ''}`}>
      <NoteCard full row={row} onShare={share} onPaste={paste} tell={tell}
        onRow={(r) => { if (r) setRow(r); else void notesWindowClose(false); }}
        head={<>
          <IconButton label={top ? tr('항상 위 풀기', 'Stop keeping on top') : tr('항상 위에 두기', 'Keep on top')} pressed={top} onClick={() => setTop(!top)}>{top ? <IconPinOff /> : <IconPin />}</IconButton>
          <IconButton label={tr('패널로 되돌리기', 'Back to panel')} onClick={() => void notesWindowClose(true)}><IconDockIn /></IconButton>
        </>} />
      {say && <div className="nt-say" role="status">{say}</div>}
    </div>
  );
}
