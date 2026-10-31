// 폰 보관함 조각 — 파일 한 칸(카드·줄, 길게 누르기) · 길게 누르기 메뉴 · 폴더 고르기 · + 메뉴 · 이름 짓기(새 문서·새 폴더) · md 글 칸. 시트 몸통은 kit BottomSheet 하나로
import { useEffect, useRef, useState } from 'react';
import type { LockerViewMode } from '../../domain/lockerLog';
import { FileThumb } from './FileThumb';
import { lockerMkdir, lockerNewDoc, lockerWrite, readFileText } from '../../data/web';
import { IconFolder, IconFolderPlus } from '../Icons';
import { BottomSheet } from './kit';
import { tr } from '../../i18n';

/** 길게 누른 것 — 경로(기록·폴더 안 파일), 폴더 안 바로가기면 그 자리 rel */
export type Held = { path: string; name: string; rel?: string; link?: boolean };

/** 손가락으로 0.45초 — 메뉴. 움직이면(스크롤) 취소, 메뉴를 띄운 손은 떼도 열기로 안 친다(말풍선 속 링크도 안 따라간다) */
export function usePress(onOpen: () => void, onHold: () => void) {
  const t = useRef<number | undefined>(undefined);
  const at = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);
  const stop = () => { window.clearTimeout(t.current); at.current = null; };
  useEffect(() => () => window.clearTimeout(t.current), []);
  return {
    onPointerDown: (e: React.PointerEvent) => { held.current = false; at.current = { x: e.clientX, y: e.clientY }; t.current = window.setTimeout(() => { held.current = true; at.current = null; onHold(); }, 450); },
    onPointerMove: (e: React.PointerEvent) => { if (at.current && Math.hypot(e.clientX - at.current.x, e.clientY - at.current.y) > 8) stop(); },
    onPointerUp: stop, onPointerCancel: stop, onPointerLeave: stop,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: (e: React.MouseEvent) => { if (held.current) { held.current = false; e.preventDefault(); return; } onOpen(); },
  };
}

export function Item({ h, view, meta, filed, isNew, onOpen, onHold }: { h: Held; view: LockerViewMode; meta: string; filed: string; isNew?: boolean; onOpen: () => void; onHold: () => void }) {
  const press = usePress(onOpen, onHold);
  const nm = <span className="m-lk-nm">{isNew && <i className="m-lk-new" aria-label={tr('새 것', 'New')} />}{h.name}</span>;
  if (view === 'list') return (
    <button type="button" className="m-lk-row" {...press}>
      <span className="m-lk-rthumb"><FileThumb path={h.path} /></span>
      <span className="m-lk-mid">{nm}<span className="m-file-meta">{meta}</span></span>
      {filed && <span className="m-lk-filed">{filed}</span>}
    </button>
  );
  return (
    <button type="button" className="m-file m-lk-card" {...press}>
      <FileThumb path={h.path} />
      {nm}
      <span className="m-file-meta">{meta}</span>
      {filed && <span className="m-lk-filed">{filed}</span>}
    </button>
  );
}


/** 길게 누르기 메뉴 — 낯선 동작이라 글자. 뜬 직후 0.45초는 손가락 밑 항목을 안 받는다 */
export function ItemMenu({ h, onClose, onOpen, onAlias, onUnalias }: { h: Held; onClose: () => void; onOpen: () => void; onAlias: () => void; onUnalias?: () => void }) {
  return (
    <BottomSheet label={h.name} kind="card" title={h.name} armMs={450} onClose={onClose}>
      {({ close, armed }) => (
        <>
          <button type="button" className="m-menu-item" onClick={() => { if (armed) { close(); onOpen(); } }}>{tr('열기', 'Open')}</button>
          {!h.rel && <button type="button" className="m-menu-item" onClick={() => { if (armed) { close(); onAlias(); } }}>{tr('폴더에 바로가기', 'Add shortcut to folder')}</button>}
          {onUnalias && <button type="button" className="m-menu-item" onClick={() => { if (armed) { close(); onUnalias(); } }}>{tr('바로가기 빼기', 'Remove shortcut')}</button>}
        </>
      )}
    </BottomSheet>
  );
}

/** 어느 폴더에 — 내 폴더(여러 층은 들여쓰기) + 끝 = 새 폴더 */
export function FolderPick({ folders, onClose, onPick, onNew }: { folders: { rel: string; name: string; depth: number }[]; onClose: () => void; onPick: (rel: string) => void; onNew: () => void }) {
  return (
    <BottomSheet label={tr('어느 폴더에', 'Which folder?')} title={tr('어느 폴더에', 'Which folder?')} onClose={onClose}>
      {folders.map((f) => (
        <button key={f.rel} type="button" className="m-menu-item m-lk-prow" style={{ paddingLeft: 16 + f.depth * 18 }} onClick={() => onPick(f.rel)}><IconFolder /><b>{f.name}</b></button>
      ))}
      <button type="button" className="m-menu-item m-lk-prow" onClick={onNew}><IconFolderPlus /><b>{tr('새 폴더', 'New folder')}</b></button>
    </BottomSheet>
  );
}

/** + — 새 문서 · 사진 올리기 · 파일 올리기(지금 보는 자리에). 새 엑셀은 칸 편집기가 폰에 없어 데스크톱에서 */
export function AddSheet({ where, onClose, onDoc, onFiles }: { where: string; onClose: () => void; onDoc: () => void; onFiles: (f: FileList) => void }) {
  const photo = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const pick = (el: HTMLInputElement | null, close: () => void) => {
    if (!el) return;
    el.onchange = () => { if (el.files?.length) onFiles(el.files); close(); };
    el.click();
  };
  return (
    <BottomSheet label={tr(`${where}에`, `In ${where}`)} kind="card" title={tr(`${where}에`, `In ${where}`)} onClose={onClose}>
      {({ close }) => (
        <>
          <button type="button" className="m-menu-item" onClick={() => { close(); onDoc(); }}>{tr('새 문서', 'New document')}</button>
          <button type="button" className="m-menu-item" onClick={() => pick(photo.current, close)}>{tr('사진 올리기', 'Upload photo')}</button>
          <button type="button" className="m-menu-item" onClick={() => pick(file.current, close)}>{tr('파일 올리기', 'Upload file')}</button>
          <input ref={photo} type="file" accept="image/*" multiple hidden />
          <input ref={file} type="file" accept="image/*,.pdf,.md,.txt,.csv,.json,.zip" multiple hidden />
        </>
      )}
    </BottomSheet>
  );
}

/** 이름 짓기 — 새 문서(제목 = 파일 이름 = 첫 줄) · 새 폴더. made = 문서 경로 또는 폴더 자리 */
export function NameSheet({ owner, kind, parent, onClose, onMade, onError }: { owner: string; kind: 'doc' | 'folder'; parent: string; onClose: () => void; onMade: (made: string) => void; onError: (m: string) => void }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const name = v.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      onMade(kind === 'doc' ? (await lockerNewDoc(owner, parent, name)).path : (await lockerMkdir(owner, parent, name)).rel);
    } catch (e) {
      onError(tr(`못 만들었어요 — ${(e as Error).message}`, `Couldn't create — ${(e as Error).message}`));
      setBusy(false);
    }
  };
  const label = kind === 'doc' ? tr('새 문서', 'New document') : tr('새 폴더', 'New folder');
  return (
    <BottomSheet label={label} title={label} onClose={onClose}>
      <form className="m-new m-lk-name" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <input autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={kind === 'doc' ? tr('제목', 'Title') : tr('폴더 이름', 'Folder name')} aria-label={kind === 'doc' ? tr('제목', 'Title') : tr('폴더 이름', 'Folder name')} maxLength={80} />
        <div className="m-new-row">
          <button type="button" className="m-btn" onClick={onClose}>{tr('취소', 'Cancel')}</button>
          <button type="submit" className="m-send" disabled={!v.trim() || busy}>{tr('만들기', 'Create')}</button>
        </div>
      </form>
    </BottomSheet>
  );
}

/** md 글 칸 — 쓰는 대로 저장(0.8초 멈추면), 저장 버튼 없음. 서버가 그 참모 보관함 안 md 만 받는다 */
export function MdEditor({ owner, path, onClose }: { owner: string; path: string; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [st, setSt] = useState<'idle' | 'saving' | 'saved' | 'error' | 'outside'>('idle');
  const timer = useRef<number | undefined>(undefined);
  const last = useRef('');
  useEffect(() => { readFileText(path).then((t) => { last.current = t; setText(t); }, () => setText('')); }, [path]);
  // 저장은 한 줄로 — 앞 저장이 끝나야 base(last)가 바뀐다. 겹쳐 보내면 뒤 것이 옛 base 로 가 제 앞 저장 때문에 '바뀌었어요'를 맞았다(2026-10-22 코드 리뷰)
  const chain = useRef<Promise<void>>(Promise.resolve());
  const outside = useRef(false);
  const save = (t: string) => {
    if (t === last.current || outside.current) return;
    setSt('saving');
    // 맥에서 그새 바뀌었으면 덮지 않는다(⑦-5) — 글 칸은 그대로 두고 알린다. 닫고 다시 열면 그 판을 받는다
    chain.current = chain.current.then(() => {
      if (t === last.current || outside.current) return;
      return lockerWrite(owner, path, t, last.current).then(() => { last.current = t; setSt('saved'); }, (e: Error) => {
        if (e.message.includes('CHANGED_OUTSIDE')) { outside.current = true; setSt('outside'); } else setSt('error');
      });
    });
  };
  const change = (t: string) => { setText(t); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => save(t), 800); };
  const close = () => { window.clearTimeout(timer.current); if (text !== null) save(text); onClose(); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const title = (text ?? '').split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '') || path.slice(path.lastIndexOf('/') + 1);
  return (
    <BottomSheet label={title} kind="full" title={title} titleClass="m-view-title" onClose={close}
      actions={<span className={`m-lk-saved ${st}`} role="status">{st === 'saving' ? tr('저장 중', 'Saving') : st === 'saved' ? tr('저장됨', 'Saved') : st === 'error' ? tr('못 저장했어요', 'Couldn\'t save') : st === 'outside' ? tr('컴퓨터에서 그새 바뀌었어요 — 닫고 다시 열어 주세요', 'Changed on your computer in the meantime — close and reopen') : ''}</span>}>
      {text === null ? <p className="m-muted m-sm m-lk-edpad">{tr('불러오는 중', 'Loading')}</p> : (
        <textarea className="m-lk-ed" value={text} onChange={(e) => change(e.target.value)} aria-label={tr('문서 내용', 'Document content')} autoFocus spellCheck={false} />
      )}
    </BottomSheet>
  );
}
