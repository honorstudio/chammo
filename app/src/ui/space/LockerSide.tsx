// 보관함 나무(홈·모드 v2, 사용자 10/11) — 프사 띠 옆 200. 그 참모 보관함의 내 폴더(진짜 폴더, 여러 층)만 — 홈·보관함 맨 위는 탭 줄 맨 왼쪽 고정 탭(2026-10-12 사용자).
// 프로젝트 절은 없앴다 — 프로젝트는 폴더가 아니라 기록이라 보관함 맨 위 '진행 중' 칩으로 간다(나무는 보여 줘도 안 움직인다)
import { useState } from 'react';
import { tr } from '../../i18n';
import type { LkPlace } from '../../domain/lockerTree';
import { IconButton } from '../kit/IconButton';
import { IconChevron, IconFolder, IconFolderPlus, IconTrash } from '../Icons';
import { lockerMenu } from '../../domain/lockerMenu';
import { useOrchActions } from '../orchActions';
import { menuItems } from './lockerMenuItems';

type Folder = { rel: string; name: string; depth: number };

const OPEN_KEY = 'lockerOpen';
const loadOpen = (): string[] => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as string[]; } catch { return []; } };

export function LockerSide({ owner, place, here, onPlace, folders, onNewFolder, onRename, onTrash, onNewDoc, onChoose, onReveal }: {
  owner: string;
  /** 지금 자리 — 없으면(문서 탭이 켜짐) 그 파일이 든 줄만 옅게(here) */
  place: LkPlace | null;
  /** 문서 탭이 켜졌을 때 그 파일이 든 자리(옅게) */
  here?: string | null;
  onPlace: (p: LkPlace) => void;
  folders: Folder[];
  onNewFolder: (parent: string, name: string) => void;
  onRename: (rel: string, name: string) => void;
  onTrash: (rel: string) => void;
  /** 오른쪽 클릭 메뉴 — 새 문서·새 엑셀 / 파일 넣기 / 파인더에서 보기(rel = 빈 글이면 보관함 맨 위) */
  onNewDoc?: (folder: string, kind: 'md' | 'xlsx') => void;
  onChoose?: (folder: string) => void;
  onReveal?: (rel: string) => void;
}) {
  const [adding, setAdding] = useState<{ parent: string; name: string } | null>(null);
  const [naming, setNaming] = useState<{ rel: string; name: string } | null>(null);
  const [open, setOpen] = useState<string[]>(loadOpen);
  const toggle = (rel: string) => setOpen((o) => {
    const next = o.includes(rel) ? o.filter((x) => x !== rel) : [...o, rel];
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* 이번 실행만 */ }
    return next;
  });
  const dirOn = (rel: string) => place?.kind === 'dir' && place.rel === rel;
  const hasKids = (rel: string) => folders.some((f) => f.rel.startsWith(`${rel}/`));
  // 접힌 폴더 아래는 숨긴다
  const shown = folders.filter((f) => !folders.some((g) => f.rel.startsWith(`${g.rel}/`) && !open.includes(g.rel)));
  const submitAdd = () => { const n = adding?.name.trim(); if (adding && n) onNewFolder(adding.parent, n); setAdding(null); };
  const submitName = () => { const n = naming?.name.trim(); if (naming && n) onRename(naming.rel, n); setNaming(null); };
  const input = (value: string, label: string, set: (v: string) => void, submit: () => void, cancel: () => void, pad = 0) => (
    <input className="lk-new" style={{ marginLeft: 4 + pad }} autoFocus value={value} placeholder={tr('폴더 이름', 'Folder name')} aria-label={label}
      onChange={(e) => set(e.target.value)} onBlur={submit}
      onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); if (e.key === 'Escape') cancel(); }} />
  );
  // 오른쪽 클릭(앱 공용 메뉴) — 폴더 줄 = 그 폴더, '보관함' 줄·빈 곳 = 맨 위. 새 폴더는 이 나무의 이름 칸으로 바로
  const act = useOrchActions();
  const addIn = (rel: string) => { if (rel) setOpen((o) => (o.includes(rel) ? o : [...o, rel])); setAdding({ parent: rel, name: '' }); };
  const folderMenu = (f: Folder) => (act ? (e: React.MouseEvent) => act.openMenu(e, menuItems(lockerMenu({ kind: 'folder' }), {
    open: { run: () => onPlace({ kind: 'dir', rel: f.rel }) },
    newFolder: { run: () => addIn(f.rel) },
    newDoc: onNewDoc && { run: () => onNewDoc(f.rel, 'md') },
    rename: { run: () => setNaming({ rel: f.rel, name: f.name }) },
    reveal: onReveal && { run: () => onReveal(f.rel) },
    trash: { run: () => onTrash(f.rel) },
  })) : undefined);
  const blankMenu = act ? (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('input')) return;
    act.openMenu(e, menuItems(lockerMenu({ kind: 'blank' }), {
      newFolder: { run: () => addIn('') },
      newDoc: onNewDoc && { run: () => onNewDoc('', 'md') },
      newSheet: onNewDoc && { run: () => onNewDoc('', 'xlsx') },
      add: onChoose && { run: () => onChoose('') },
      reveal: onReveal && { run: () => onReveal('') },
    }));
  } : undefined;
  return (
    <nav className="lk-tree" aria-label={tr('보관함 폴더', 'Locker folders')} onContextMenu={blankMenu}>
        <div className="lk-tree-head">
          <b title={owner}>{owner}</b>
          <IconButton size="s" label={tr('새 폴더', 'New folder')} onClick={() => setAdding({ parent: place?.kind === 'dir' ? place.rel : '', name: '' })}><IconFolderPlus /></IconButton>
        </div>
        {adding?.parent === '' && input(adding.name, tr('새 폴더 이름', 'New folder name'), (v) => setAdding({ parent: '', name: v }), submitAdd, () => setAdding(null), 14)}
        {shown.map((f) => {
          const pad = 14 + f.depth * 14;
          return (
            <div key={f.rel}>
              {naming?.rel === f.rel ? input(naming.name, tr('폴더 이름 바꾸기', 'Rename folder'), (v) => setNaming({ rel: f.rel, name: v }), submitName, () => setNaming(null), pad) : (
                <div className={`lk-row ${dirOn(f.rel) ? 'on' : !place && here === f.rel ? 'here' : ''}`} data-locker-folder={f.rel} data-locker-drop={f.rel} style={{ paddingLeft: pad }} onContextMenu={folderMenu(f)}>
                  {hasKids(f.rel) && (
                    <IconButton size="s" className={`lk-chev-btn ${open.includes(f.rel) ? 'open' : ''}`} label={open.includes(f.rel) ? tr(`${f.name} 접기`, `Collapse ${f.name}`) : tr(`${f.name} 펼치기`, `Expand ${f.name}`)}
                      onClick={() => toggle(f.rel)}><IconChevron /></IconButton>
                  )}
                  <button className="lk-row-btn" style={hasKids(f.rel) ? { paddingLeft: 2 } : undefined} onClick={() => onPlace({ kind: 'dir', rel: f.rel })} onDoubleClick={() => setNaming({ rel: f.rel, name: f.name })}
                    title={`${f.name}\n${tr('두 번 눌러 이름 바꾸기', 'Double-click to rename')}`}>
                    {!hasKids(f.rel) && <span className="lk-row-ic"><IconFolder /></span>}
                    <span className="lk-row-nm">{f.name}</span>
                  </button>
                  <IconButton size="s" className="lk-row-x" label={tr(`${f.name} 안에 새 폴더`, `New folder in ${f.name}`)} onClick={() => { setOpen((o) => (o.includes(f.rel) ? o : [...o, f.rel])); setAdding({ parent: f.rel, name: '' }); }}><IconFolderPlus /></IconButton>
                  <IconButton size="s" className="lk-row-x2" label={tr(`${f.name} 휴지통으로`, `Move ${f.name} to Trash`)} onClick={() => onTrash(f.rel)}><IconTrash /></IconButton>
                </div>
              )}
              {adding?.parent === f.rel && input(adding.name, tr('새 폴더 이름', 'New folder name'), (v) => setAdding({ parent: f.rel, name: v }), submitAdd, () => setAdding(null), pad + 14)}
            </div>
          );
        })}
    </nav>
  );
}
