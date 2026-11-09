// 폰 '메모' 탭 — 내 메모(시안 v2 M). 띄운 메모가 카드로 위아래로 쌓인다(맥과 같은 띄움 목록, notes/.meta.json). 글 칸이다 — 폰엔 노션식 편집기가 없다.
// 목록 시트에서 메모마다 띄움을 켜고 끄고, 카드 ⋯ 시트에서 스킨을 고른다. 맥에 못 닿으면 마지막에 본 카드를 읽기만. 참모에게 가는 길은 보내기 아이콘·⋯ '보여 주기'뿐
// 탭을 바꾸면 이 화면이 내려갔다 올라온다 — 목록·카드 글은 화면 메모리(memo)에 들고 있다가 바로 그리고, 뒤에서 목록만 다시 받아
// 고친 시각이 달라진 카드만 다시 받는다(2026-11-08 사용자 "메모 나올 때 느림" — 지연 300ms·5장에서 열 때마다 628ms·왕복 6번이었다)
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { noteMeta, noteNew, noteRead, noteTrash, noteWrite, notesRead } from '../../data/web';
import { onNoteStamp } from '../../domain/noteStamp';
import { noteFresh, noteLines, noteMd, notePaste, noteStale, noteTitle, noteWhen, skinOf, splitNotes, type NoteRow, type NoteSeen, type NoteSkin } from '../../domain/notes';
import { assistant, josa, machine, tr } from '../../i18n';
import { IconChatSend, IconChevronDown, IconMore, IconPin, IconPinOff, IconPlus } from '../Icons';
import { SkinPick } from '../notes/SkinPick';
import '../notes/notes.css';
import { BottomSheet } from './BottomSheet';
import { remember, remembered } from './memo';
import { useMdSave } from './useMdSave';

const CACHE = 'm.notes.cards'; // 맥에 못 닿을 때 읽기만 할 카드(페이지를 새로 열어도 남는다)
/** 화면 메모리 열쇠 — 목록 / 카드마다 맥과 맞춘 글(NoteSeen) */
const LIST = 'notes';
const seenKey = (name: string) => `note:${name}`;
type Cache = { name: string; title: string; skin: NoteSkin; text: string };
const readCache = (): Cache[] => { try { return (JSON.parse(localStorage.getItem(CACHE) ?? '[]') as Cache[]).map((c) => ({ ...c, skin: skinOf(c.skin) })); } catch { return []; } };
const cacheOne = (c: Cache) => { try { localStorage.setItem(CACHE, JSON.stringify([c, ...readCache().filter((x) => x.name !== c.name)].slice(0, 12))); } catch { /* 이번만 */ } };

type Give = (text: string) => void;

/** 카드 한 장 — 글 칸 + 머리(보내기·⋯). 저장은 카드마다 따로(맥에서 그새 고쳤으면 안 덮는다). text 는 저장 md 그대로, 글 칸엔 문단 = 한 줄(noteLines) */
function Card({ row, off, cached, onPaste, onMore, onSaved, flash }: { row: NoteRow; off: boolean; cached?: string; onPaste: Give; onMore: (r: NoteRow, text: string | null) => void; onSaved: (r: NoteRow) => void; flash: (m: string) => void }) {
  const key = seenKey(row.name);
  const [text, setText] = useState<string | null>(() => cached ?? remembered<NoteSeen>(key)?.text ?? null);
  const textRef = useRef(text);
  textRef.current = text;
  /** 맥과 마지막으로 맞춘 글 = 저장 base. 글 칸이 이것과 다르면 쓰는 중 */
  const known = useRef<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<[number, number] | null>(null);
  /** 저장이 몇 번 맥에 닿았나 — 저장보다 먼저 떠난 읽기의 늦은 답(옛 글)이 저장한 글을 되돌리지 않게 */
  const wrote = useRef(0);
  const saver = useMdSave((t, base) => noteWrite(row.name, t, base).then((r) => {
    wrote.current += 1;
    known.current = t;
    remember(key, { text: t, at: r.at }); // 다시 열 때 바로 — 고친 시각도 맞춰 목록이 같다고 하면 안 받는다
    onSaved(r);
    return r;
  }));
  useEffect(() => {
    if (off) return;
    let live = true;
    const seen = remembered<NoteSeen>(key);
    // 기억한 글로 그렸으면 그 글을 저장 base 로 — 그새 맥에서 고쳤으면 저장이 CHANGED_OUTSIDE 로 막혀 맥 글을 안 덮는다
    if (seen && known.current === null && textRef.current === seen.text) { known.current = seen.text; saver.reset(seen.text); }
    if (!noteStale(seen, row.at)) return;
    const at = row.at;
    const w = wrote.current;
    void noteRead(row.name).then((t) => {
      if (!live || wrote.current !== w) return; // 더 새 목록이 다시 받기 시작했거나 그새 저장했다 — 늦게 온 옛 답은 버린다
      remember(key, { text: t, at });
      cacheOne({ name: row.name, title: row.title, skin: row.skin, text: t });
      const how = noteFresh(textRef.current, known.current, t);
      if (how === 'keep') return; // 쓰는 중 — 친 글·커서를 지킨다
      if (how === 'take') {
        const el = box.current;
        caret.current = el && document.activeElement === el ? [el.selectionStart, el.selectionEnd] : null;
        setText(t);
      }
      if (known.current !== t) { known.current = t; saver.reset(t); }
    }).catch(() => {});
    return () => { live = false; };
  }, [row.name, row.at, off]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { void saver.flush(textRef.current); }, [row.name, off]); // eslint-disable-line react-hooks/exhaustive-deps -- 다른 탭으로 — 쓰던 글을 남긴다
  // 글 칸을 누른 채(안 치고) 새 글로 갈았으면 커서를 그 자리에
  useLayoutEffect(() => {
    const el = box.current;
    const c = caret.current;
    caret.current = null;
    if (!el || !c) return;
    const n = el.value.length;
    el.setSelectionRange(Math.min(c[0], n), Math.min(c[1], n));
  }, [text]);
  // 글 길이만큼 자란다 — 탭 전체가 스크롤한다. 스킨마다 줄 높이가 달라 스킨이 바뀌어도 다시 잰다
  useEffect(() => { const el = box.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }, [text, row.skin]);
  const change = (t: string) => { setText(t); saver.change(t); cacheOne({ name: row.name, title: row.title, skin: row.skin, text: t }); };
  const paste = () => {
    const t = text === null ? null : notePaste(text);
    if (!t) { flash(tr('메모가 비었어요', 'This note is empty')); return; }
    onPaste(t);
  };
  const status = saver.st === 'saving' ? tr('저장 중', 'Saving') : saver.st === 'error' ? tr('못 저장했어요', "Couldn't save") : '';
  return (
    <article className={`nt-card nt-sk sk-${row.skin} m-nt-card`} data-note={row.name}>
      <header className="nt-ch">
        <span className={`m-lk-saved ${saver.st}`} role="status">{status}</span>
        <span className="nt-sp" />
        <button type="button" className="m-ico m-nt-ib" onClick={paste} aria-label={tr(`${assistant()} 입력칸에 넣기`, `Add to ${assistant()} input`)} title={tr(`${assistant()} 입력칸에 넣기`, `Add to ${assistant()} input`)}><IconChatSend /></button>
        {!off && <button type="button" className="m-ico m-nt-ib" onClick={() => onMore(row, text)} aria-label={tr('더보기', 'More')} title={tr('더보기', 'More')}><IconMore /></button>}
      </header>
      {saver.st === 'outside' && <div className="m-nt-note" role="alert">{tr(`${machine()}에서 먼저 고쳐서 저장 안 했어요. 닫고 다시 열어요`, `Not saved because the note changed on your ${machine()}. Close and reopen it`)}</div>}
      {text !== null && (
        <textarea ref={box} className="m-nt-ed" value={noteLines(text)} readOnly={off} onChange={(e) => change(noteMd(e.target.value, text))} placeholder={tr('여기에 적어요', 'Write here')}
          aria-label={noteTitle(row, tr('새 메모', 'New note'))} spellCheck={false} rows={2} />
      )}
    </article>
  );
}

/** onShare(글) — ⋯ '보여 주기'(참조). onPaste 글 — 카드 머리 보내기 아이콘: 메모 글 통째를 입력칸에(보내기는 사람이). 사람이 눌렀을 때만 */
export function MemoTab({ onShare, onPaste }: { onShare: (text: string) => void; onPaste: (text: string) => void }) {
  const [rows, setRows] = useState<NoteRow[]>(() => remembered<NoteRow[]>(LIST) ?? []);
  const [off, setOff] = useState(false);
  const [err, setErr] = useState('');
  const [say, setSay] = useState('');
  const [sheet, setSheet] = useState<'list' | { row: NoteRow; text: string | null } | null>(null);
  const [cache] = useState(readCache);
  const list = useRef<HTMLDivElement>(null);
  const flash = (m: string) => { setSay(m); window.setTimeout(() => setSay(''), 2500); };
  const load = async () => {
    try {
      const got = await notesRead();
      setRows(got.length ? got : [await noteNew()]);
      setOff(false); setErr('');
    } catch (e) {
      // 맥에 못 닿는다 — 마지막에 본 카드를 읽기만
      if (cache.length) { setRows(cache.map((c) => ({ name: c.name, path: '', title: c.title, preview: '', at: 0, skin: c.skin, shown: true, win: false }))); setOff(true); }
      else if (remembered<NoteRow[]>(LIST)?.length) { setOff(true); setErr(`${tr('메모를 못 불러왔어요:', "Couldn't load notes:")} ${(e as Error).message}`); }
      else setErr(`${tr('메모를 못 불러왔어요:', "Couldn't load notes:")} ${(e as Error).message}`);
    }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 열어 둔 채 맥에서 고치면 — 세션 목록 답(3초마다)의 메모 도장이 바뀐다(domain/noteStamp). 목록만 다시 받고 고친 시각이 달라진 카드만 Card 가 받는다.
  // 쓰는 중이면 Card 의 noteFresh 가 친 글을 지킨다. 못 받으면 그대로 둔다(읽기만으로 안 바꾼다 — 다음 도장·다시 열기에서)
  useEffect(() => onNoteStamp(() => { void notesRead().then((got) => { if (got.length) { setRows(got); setOff(false); setErr(''); } }, () => {}); }), []);
  // 맥에서 받은 목록만 기억한다 — 맥에 못 닿을 때 만든 목록(고친 시각 0)은 아니다
  useEffect(() => { if (!off) remember(LIST, rows); }, [rows, off]);
  /** 카드가 저장했다 — 목록의 고친 시각·제목을 맞춘다(띄움·스킨은 그대로). 시각이 맞아야 다시 열 때 그 카드를 또 안 받는다 */
  //  탭을 떠나며 한 저장(flush)은 이 화면이 내려간 뒤에 끝난다 — 그래서 기억한 목록도 바로 고친다
  const saved = (r: NoteRow) => {
    const fix = (x: NoteRow[]) => x.map((y) => (y.name === r.name ? { ...y, at: r.at, title: r.title, preview: r.preview } : y));
    const had = remembered<NoteRow[]>(LIST);
    if (had) remember(LIST, fix(had));
    setRows(fix);
  };
  const put = (r: NoteRow) => setRows((x) => x.map((y) => (y.name === r.name ? r : y)));
  const scrollTo = (name: string) => requestAnimationFrame(() => list.current?.querySelector(`[data-note="${CSS.escape(name)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  const add = () => void noteNew().then((r) => { setRows((x) => [r, ...x.filter((y) => y.name !== r.name)]); scrollTo(r.name); }).catch((e: Error) => flash(`${tr('새 메모를 못 만들었어요:', "Couldn't create the note:")} ${e.message}`));
  /** 목록 시트 핀 — 맥과 같은 띄움 목록(폰엔 따로 창이 없어 창에 뜬 것도 여기 쌓인다) */
  const pin = (r: NoteRow, on: boolean) => void noteMeta(r.name, { shown: on }).then(put).catch(() => {});
  const skin = (r: NoteRow, s: NoteSkin) => { setSheet(null); void noteMeta(r.name, { skin: s }).then(put).catch(() => {}); };
  const share = (text: string | null) => { setSheet(null); if (text === null) return; onShare(text); flash(tr(`${assistant()} 입력칸에 넣었어요`, `Added to the ${assistant()} input`)); };
  const trash = (r: NoteRow) => { setSheet(null); void noteTrash(r.name).then(() => load()).catch((e: Error) => flash(`${tr('휴지통으로 못 옮겼어요:', "Couldn't move to Trash:")} ${e.message}`)); };
  const shown = rows.filter((r) => r.shown).sort((a, b) => b.name.localeCompare(a.name, 'en', { numeric: true }));
  const split = splitNotes(rows);
  const now = Date.now();
  const lrow = (r: NoteRow) => (
    <div key={r.name} className={`m-nt-row ${r.shown ? '' : 'off'}`}>
      <button type="button" className="m-nt-go" onClick={() => { setSheet(null); if (!r.shown) pin(r, true); scrollTo(r.name); }}>
        <i className={`nt-dot sk-${r.skin}`} /><span className="m-nt-tx"><b>{noteTitle(r, tr('새 메모', 'New note'))}</b></span><em>{noteWhen(r.at, now)}</em>
      </button>
      <button type="button" className={`m-ico m-nt-ib ${r.shown ? 'on' : ''}`} onClick={() => pin(r, !r.shown)} aria-pressed={r.shown}
        aria-label={r.shown ? tr('내리기', 'Unpin') : tr('띄우기', 'Pin')} title={r.shown ? tr('내리기', 'Unpin') : tr('띄우기', 'Pin')}>{r.shown ? <IconPin /> : <IconPinOff />}</button>
    </div>
  );
  const more = sheet && sheet !== 'list' ? sheet : null;
  return (
    <div className="m-nt">
      <header className="m-nt-head">
        <button type="button" className="m-nt-title" onClick={() => { setSheet('list'); void notesRead().then(setRows).catch(() => {}); }} aria-haspopup="dialog" aria-label={tr('메모 목록', 'All notes')} title={tr('메모 목록', 'All notes')}>
          <b>{tr('내 메모', 'My notes')}</b><IconChevronDown />
        </button>
        <span className="m-nt-sp" />
        {!off && <button type="button" className="m-rt-btn m-ico" onClick={add} aria-label={tr('새 메모', 'New note')} title={tr('새 메모', 'New note')}><IconPlus /></button>}
      </header>
      {off && <div className="m-nt-note" role="status">{tr(`${josa(machine(), '이', '가')} 꺼져 있어서 읽기만 돼요`, `Your ${machine()} is off, so notes are read-only`)}</div>}
      {err && <div className="m-nt-note" role="alert">{err}</div>}
      <div className="m-nt-stack" ref={list}>
        {shown.map((r) => <Card key={r.name} row={r} off={off} cached={off ? cache.find((c) => c.name === r.name)?.text : undefined} onPaste={onPaste} flash={flash} onSaved={saved} onMore={(row, text) => setSheet({ row, text })} />)}
        {!shown.length && rows.length > 0 && <p className="nt-empty">{tr('띄운 메모가 없어요. 목록에서 띄우거나 새로 만들어요', 'No pinned notes. Pin one from the list or add a new one')}</p>}
      </div>
      {say && <div className="m-nt-say" role="status">{say}</div>}
      {sheet === 'list' && (
        <BottomSheet label={tr('메모 목록', 'All notes')} title={tr('메모 목록', 'All notes')} onClose={() => setSheet(null)}>
          <div className="m-nt-list">{[...split.shown, ...split.hidden].map(lrow)}</div>
        </BottomSheet>
      )}
      {more && (
        <BottomSheet label={tr('더보기', 'More')} title={tr('더보기', 'More')} onClose={() => setSheet(null)}>
          <div className="m-nt-list">
            <div className="m-nt-row m-nt-skin"><span className="m-nt-tx"><b>{tr('스킨', 'Skin')}</b></span><SkinPick className="nt-sw m-nt-sw" value={more.row.skin} onPick={(s) => skin(more.row, s)} /></div>
            <button type="button" className="m-nt-row" onClick={() => share(more.text)}><span className="m-nt-tx"><b>{tr(`${assistant()}에게 보여 주기`, `Show to ${assistant()}`)}</b></span></button>
            <button type="button" className="m-nt-row" onClick={() => { setSheet(null); pin(more.row, false); }}><span className="m-nt-tx"><b>{tr('내리기', 'Unpin')}</b></span></button>
            <button type="button" className="m-nt-row warn" onClick={() => trash(more.row)}><span className="m-nt-tx"><b>{tr('휴지통으로', 'Move to Trash')}</b></span></button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
