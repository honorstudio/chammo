// 내 메모 패널(시안 v2 P 나 안) — 띄운 메모를 카드로 위아래로 쌓아 스크롤한다. 목록은 '띄운 / 안 띄운' 두 칸.
// 따로 창에 뜬 메모는 패널에 안 쌓는다(같은 메모가 두 곳에 안 뜨게). 참모에게 가는 길은 카드의 보내기 아이콘·⋯ '보여 주기'뿐
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { notesList, notesMeta, notesNew, notesWindowOpen } from '../../data/tauri';
import { NOTE_W_MAX, NOTE_W_MIN, NOTES_CHANGED, noteOverlay, noteTitle, noteW, noteWhen, splitNotes, type NoteRow } from '../../domain/notes';
import { tr } from '../../i18n';
import { IconChevronDown, IconClose, IconPlus, IconWindowOut } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { closeOnOutside } from '../outsideClose';
import { Grip } from '../TaskPanel';
import { HideButton, NoteCard } from './NoteCard';
import './notes.css';

type Give = (x: string) => boolean | Promise<boolean>;

/** head = 머리 오른쪽 끝(패널: 닫기). onShare = 파일 참조, onPaste = 글 통째 — 받을 채팅이 없으면 false */
export function NotesPanel({ head, onShare, onPaste, onAllToWindow }: { head: ReactNode; onShare: Give; onPaste: Give; onAllToWindow: () => void }) {
  const [rows, setRows] = useState<NoteRow[]>([]);
  const [pop, setPop] = useState(false);
  const [say, setSay] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const stackEl = useRef<HTMLDivElement>(null);
  const hush = useRef(0);
  const tell = (m: string) => {
    setSay(m);
    window.clearTimeout(hush.current);
    hush.current = window.setTimeout(() => setSay(''), 3000);
  };
  useEffect(() => () => window.clearTimeout(hush.current), []);
  /** 목록을 다시 읽는다 — 메모가 하나도 없으면 첫 메모를 만든다 */
  const load = async () => {
    const list = await notesList();
    setRows(list.length ? list : [await notesNew()]);
  };
  useEffect(() => {
    void load().catch((e) => tell(`${tr('메모를 못 불러왔어요:', "Couldn't load notes:")} ${String(e)}`));
    const again = () => void load().catch(() => {});
    window.addEventListener(NOTES_CHANGED, again);
    return () => window.removeEventListener(NOTES_CHANGED, again);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 목록 닫기 — 바깥 누름·Esc
  useEffect(() => {
    if (!pop) return;
    const off = closeOnOutside(window, (t) => !!box.current?.contains(t as Node), () => setPop(false));
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setPop(false); } };
    window.addEventListener('keydown', esc, true);
    return () => { off(); window.removeEventListener('keydown', esc, true); };
  }, [pop]);
  const toggleList = () => {
    if (pop) { setPop(false); return; }
    setPop(true);
    void notesList().then(setRows).catch(() => {}); // 고친 제목·폰에서 쓴 메모까지
  };
  /** 카드가 바꾼 줄 — null 이면 휴지통으로 갔다 */
  const put = (r: NoteRow | null, was: NoteRow) => setRows((x) => (r ? x.map((y) => (y.name === was.name ? r : y)) : x.filter((y) => y.name !== was.name)));
  const scrollTo = (name: string) => requestAnimationFrame(() => stackEl.current?.querySelector(`[data-note="${CSS.escape(name)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  const add = () => void notesNew().then((r) => { setRows((x) => [r, ...x.filter((y) => y.name !== r.name)]); setPop(false); scrollTo(r.name); })
    .catch((e) => tell(`${tr('새 메모를 못 만들었어요:', "Couldn't create the note:")} ${String(e)}`));
  /** 목록 줄 — 안 띄운 것은 패널에 띄우고, 띄운 것은 그 자리로(창이면 그 창을 앞으로) */
  const show = (r: NoteRow) => void notesMeta(r.name, { shown: true, win: false }).then((n) => { put(n, r); scrollTo(r.name); }).catch(() => {});
  const go = (r: NoteRow) => {
    setPop(false);
    if (!r.shown) show(r);
    else if (r.win) void notesWindowOpen(r.name).catch(() => {});
    else scrollTo(r.name);
  };
  const hide = (r: NoteRow) => void notesMeta(r.name, { shown: false, win: false }).then((n) => put(n, r)).catch(() => {});
  const split = splitNotes(rows);
  const now = Date.now();
  const line = (r: NoteRow, act: ReactNode) => (
    <div key={r.name} className="nt-row nt-lrow" role="menuitem" tabIndex={-1}>
      <button className="nt-lgo" onClick={() => go(r)}><i className={`nt-dot sk-${r.skin}`} /><span>{noteTitle(r, tr('새 메모', 'New note'))}</span>{r.win && <b className="nt-tag">{tr('창', 'Window')}</b>}<em>{noteWhen(r.at, now)}</em></button>
      {act}
    </div>
  );
  return (
    <div className="nt-box" ref={box}>
      <header className="nt-head">
        <button className={`nt-title ${pop ? 'open' : ''}`} onClick={toggleList} aria-expanded={pop} title={tr('메모 목록', 'All notes')}>
          <span>{tr('내 메모', 'My notes')}</span><IconChevronDown />
        </button>
        <span className="nt-sp" />
        <IconButton label={tr('새 메모', 'New note')} onClick={add}><IconPlus /></IconButton>
        <IconButton label={tr('띄운 메모 다 창으로', 'Open all in windows')} onClick={onAllToWindow}><IconWindowOut /></IconButton>
        {head}
      </header>
      {pop && (
        <div className="nt-pop nt-list" role="menu" aria-label={tr('메모 목록', 'All notes')}>
          <div className="nt-gh">{tr('띄운 메모', 'Pinned notes')}</div>
          {split.shown.map((r) => line(r, <IconButton label={tr('내리기', 'Unpin')} onClick={() => hide(r)}><IconClose /></IconButton>))}
          <i className="nt-line" />
          <div className="nt-gh">{tr('안 띄운 메모', 'Other notes')}</div>
          {split.hidden.length ? split.hidden.map((r) => line(r, <IconButton label={tr('띄우기', 'Pin')} onClick={() => show(r)}><IconPlus /></IconButton>))
            : <div className="nt-none">{tr('안 띄운 메모가 없어요', 'No other notes')}</div>}
        </div>
      )}
      <div className="nt-stack" ref={stackEl}>
        {split.stack.map((r) => <NoteCard key={r.name} row={r} onRow={put} onShare={onShare} onPaste={onPaste} tell={tell}
          head={<HideButton row={r} onRow={put} tell={tell} />}
          move={{ label: tr('따로 창으로', 'Open in window'), run: () => void notesMeta(r.name, { win: true }).then((n) => { put(n, r); return notesWindowOpen(r.name); }).catch(() => {}) }} />)}
        {!split.stack.length && rows.length > 0 && <p className="nt-empty">{tr('띄운 메모가 없어요. 목록에서 띄우거나 새로 만들어요', 'No pinned notes. Pin one from the list or add a new one')}</p>}
      </div>
      {say && <div className="nt-say" role="status">{say}</div>}
    </div>
  );
}

const W_KEY = 'myNotes.w';
const savedW = () => { try { return noteW(localStorage.getItem(W_KEY)); } catch { return noteW(null); } };

/** 스페이스 패널 자리 — 스페이스 내용이 360 밑이 되면 덮개로 띄우고, 넓을 땐 나란히(11-05 사용자). 왼쪽 경계를 끌어 폭을 바꾸고 기억한다 */
export function NotesSlot({ onClose, onToWindow, onShare, onPaste }: { onClose: () => void; onToWindow: () => void; onShare: (path: string) => boolean; onPaste: (text: string) => boolean }) {
  const el = useRef<HTMLElement>(null);
  const [over, setOver] = useState(false);
  const [w, setW] = useState(savedW);
  const wNow = useRef(w);
  wNow.current = w;
  useEffect(() => { try { localStorage.setItem(W_KEY, String(w)); } catch { /* 이번 실행만 */ } }, [w]);
  useLayoutEffect(() => {
    const self = el.current;
    const main = self?.parentElement?.querySelector<HTMLElement>(':scope > .cv-main');
    if (!self || !main) return;
    const measure = () => setOver(noteOverlay(main.offsetWidth + (self.classList.contains('nt-over') ? 0 : wNow.current), wNow.current));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(main);
    return () => ro.disconnect();
  }, []);
  return (
    <aside ref={el} className={`nt-panel ${over ? 'nt-over' : ''}`} style={{ width: w, flexBasis: w }} aria-label={tr('내 메모', 'My notes')}>
      <Grip width={w} onWidth={setW} min={NOTE_W_MIN} max={NOTE_W_MAX} />
      <NotesPanel onShare={onShare} onPaste={onPaste} onAllToWindow={onToWindow} head={<>
        <IconButton label={tr('닫기', 'Close')} onClick={onClose}><IconClose /></IconButton>
      </>} />
    </aside>
  );
}
