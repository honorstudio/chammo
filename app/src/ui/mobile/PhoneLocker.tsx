// 폰 보관함(폰 홈·보관함 v1, 사용자 10/11 "추천대로") — 데스크톱 보관함 v2 와 같은 판단(lockerLog·kidsOf·defaultView)을 폰 바닥 화면에.
// 뿌리 = 진행 중 칩(일하는·기다리는 프로젝트) · 내 폴더 카드 줄 · 날짜별 기록. 칩 = 그 프로젝트와 주고받은 기록, 폴더 = 같은 화면에서 들어감(뒤로 + 이름).
// 기록 → 폴더는 끌기 대신 길게 누르기 메뉴 → 폴더 고르기 → 바로가기(기록은 그대로 '→ 자료') + 되돌리기. + = 새 문서·사진·파일(새 엑셀은 데스크톱).
// 폰이 쓰는 건 그 참모 보관함 안에만(서버가 다시 거른다). 옮기기·이름 바꾸기·지우기는 데스크톱
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { lockerAlias, lockerUnalias } from '../../data/web';
import type { LockerView } from '../../domain/locker';
import { defaultView, logDays, lockerLog, type LockerViewMode, type LogItem } from '../../domain/lockerLog';
import { kidsOf, readOnlyAt, userFolders, type LkEntry } from '../../domain/lockerTree';
import { dotClass, openPathOf, phoneTree, type PhoneChip } from '../../domain/phoneLocker';
import { IconBack, IconDashboard, IconFolderPlus, IconList, IconPlus } from '../Icons';
import { BottomSheet, IconBtn } from './kit';
import { AddSheet, FolderPick, Item, ItemMenu, MdEditor, NameSheet, type Held } from './PhoneLockerParts';

type Shown = { path: string; ts: string; by: string };
type Place = { kind: 'root'; project?: string } | { kind: 'dir'; rel: string };

const VIEW_KEY = 'm.lkViews';
const loadViews = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as Record<string, string>; } catch { return {}; } };
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const hm = (ts: string) => { const d = new Date(ts); return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function PhoneLocker({ owner, view: lv, shown, projects, chips, whoOf, onOpen, onReload, onUpload }: {
  owner: string;
  view: LockerView;
  /** 참모·맡긴 세션이 보여 준 파일(dashFiles) */
  shown: Shown[];
  projects: { name: string; root: string }[];
  chips: { active: PhoneChip[]; all: PhoneChip[] };
  /** 'me'·세션 id·참모 id → 읽을 이름 */
  whoOf: (by: string) => string;
  onOpen: (path: string, name: string) => void;
  onReload: () => void;
  /** 폰 사진·파일 올리기 → 보관함 맨 위(집) 경로들 */
  onUpload: (files: FileList) => Promise<string[]>;
}) {
  const tree = phoneTree(lv, owner);
  const log = lockerLog(shown, tree.entries, tree.dir, projects);
  const [place, setPlace] = useState<Place>({ kind: 'root' });
  const [views, setViews] = useState<Record<string, string>>(loadViews);
  const [held, setHeld] = useState<Held | null>(null);
  const [picking, setPicking] = useState<Held | null>(null);
  const [adding, setAdding] = useState(false);
  const [naming, setNaming] = useState<{ kind: 'doc' | 'folder'; parent: string; then?: Held } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const toastT = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(toastT.current), []);
  const say = (text: string, undo?: () => void) => { window.clearTimeout(toastT.current); setToast({ text, undo }); toastT.current = window.setTimeout(() => setToast(null), 5000); };

  const vkey = place.kind === 'dir' ? `d:${place.rel}` : place.project ? `p:${place.project}` : 'root';
  const mode = defaultView(views[vkey] ?? null, place.kind === 'dir' ? 'dir' : 'log');
  const setMode = (v: LockerViewMode) => setViews((x) => { const n = { ...x, [vkey]: v }; try { localStorage.setItem(VIEW_KEY, JSON.stringify(n)); } catch { /* 이번 실행만 */ } return n; });
  const folderRel = place.kind === 'dir' ? place.rel : '';
  const open = (path: string, name: string) => onOpen(openPathOf(path, tree), name);
  const relOf = (abs: string) => (tree.dir && abs.startsWith(`${tree.dir}/`) ? abs.slice(tree.dir.length + 1) : '');

  const alias = async (h: Held, folder: string) => {
    setPicking(null);
    try {
      const r = await lockerAlias(owner, openPathOf(h.path, tree), folder);
      onReload();
      const rel = relOf(r.path);
      say(`${baseName(folder)}에 바로가기 넣음`, rel ? () => void lockerUnalias(owner, rel).then(() => { setToast(null); onReload(); }, () => say('못 되돌렸어요')) : undefined);
    } catch (e) {
      say(`못 넣었어요 — ${(e as Error).message}`);
    }
  };
  const unalias = (h: Held) => { if (h.rel) void lockerUnalias(owner, h.rel).then(onReload, (e) => say(`못 뺐어요 — ${(e as Error).message}`)); };

  const seg = (
    <span className="m-lk-seg" role="tablist" aria-label="보기">
      <button type="button" role="tab" aria-selected={mode === 'card'} className={mode === 'card' ? 'm-on' : ''} onClick={() => setMode('card')} aria-label="카드로 보기" title="카드로 보기"><IconDashboard /></button>
      <button type="button" role="tab" aria-selected={mode === 'list'} className={mode === 'list' ? 'm-on' : ''} onClick={() => setMode('list')} aria-label="목록으로 보기" title="목록으로 보기"><IconList /></button>
    </span>
  );
  // 연결 폴더(맥 폴더의 바로가기)는 폰에선 읽기만 — 새로 만들기·올리기 없음
  const tools = (title: ReactNode, ro = false) => <div className="m-lk-tools">{title}{!ro && <IconBtn label="새로 만들기·올리기" onClick={() => setAdding(true)}><IconPlus /></IconBtn>}{seg}</div>;
  const filedWord = (it: LogItem) => (it.filed.length ? `→ ${it.filed.map((f) => baseName(f)).join(', ')}` : '');
  const metaOf = (it: LogItem) => {
    const w = whoOf(it.by);
    const what = it.act === 'shown' && it.by !== 'me' ? `${w}${w.endsWith('세션') ? '' : '이'} 보여 줌` : w;
    return [what, hm(it.ts)].filter(Boolean).join(' · ');
  };
  const logView = (items: LogItem[]) => (items.length === 0 ? <p className="m-muted m-sm">아직 주고받은 파일이 없어요</p> : logDays(items).map((g) => (
    <section key={g.label}>
      <div className="m-sect">{g.label}</div>
      <div className={mode === 'card' ? 'm-files' : 'm-lk-list'}>
        {g.items.map((it) => {
          const h: Held = { path: it.path, name: baseName(it.path) };
          return <Item key={it.path} h={h} view={mode} meta={metaOf(it)} filed={filedWord(it)} onOpen={() => open(it.path, h.name)} onHold={() => setHeld(h)} />;
        })}
      </div>
    </section>
  )));
  const folderCard = (e: LkEntry) => {
    const n = tree.entries.filter((x) => !x.dir && x.rel.startsWith(`${e.rel}/`)).length;
    return <button key={e.rel} type="button" className="m-lk-fold" onClick={() => setPlace({ kind: 'dir', rel: e.rel })}><span className="tab" aria-hidden="true" /><b>{e.name}</b><span>{n}</span></button>;
  };

  let body: ReactNode;
  if (place.kind === 'dir') {
    const kids = kidsOf(tree.entries, place.rel);
    const up = place.rel.includes('/') ? place.rel.slice(0, place.rel.lastIndexOf('/')) : null;
    const files = kids.filter((e) => !e.dir);
    body = (
      <>
        {tools(<><IconBtn label="뒤로" onClick={() => setPlace(up ? { kind: 'dir', rel: up } : { kind: 'root' })}><IconBack /></IconBtn><b className="m-lk-title">{baseName(place.rel)}</b></>, readOnlyAt(tree.entries, place.rel))}
        {kids.some((e) => e.dir) && <div className="m-lk-folds">{kids.filter((e) => e.dir).map(folderCard)}</div>}
        {files.length === 0 ? <p className="m-muted m-sm">비어 있어요 — 기록에서 길게 눌러 바로가기를 넣거나 + 로 만들어요</p> : (
          <div className={mode === 'card' ? 'm-files' : 'm-lk-list'}>
            {files.map((e) => {
              const path = `${tree.dir}/${e.rel}`;
              const h: Held = { path, name: e.name, rel: e.rel, link: !!e.link && !e.ro };
              return <Item key={e.rel} h={h} view={mode} meta={[e.link && !e.ro ? '바로가기' : '', e.mtime ? hm(new Date(e.mtime).toISOString()) : ''].filter(Boolean).join(' · ')} filed="" onOpen={() => open(path, e.name)} onHold={() => setHeld(h)} />;
            })}
          </div>
        )}
      </>
    );
  } else {
    const cur = place.project ? chips.all.find((c) => c.root === place.project) : undefined;
    const items = cur ? log.filter((it) => it.project === cur.name) : log;
    const tops = kidsOf(tree.entries, '').filter((e) => e.dir);
    const chip = (c: PhoneChip) => (
      <button key={c.root} type="button" className={place.project === c.root ? 'm-chip m-on' : 'm-chip'} onClick={() => setPlace(place.project === c.root ? { kind: 'root' } : { kind: 'root', project: c.root })}>
        <span className={`st-dot ${dotClass(c.dot)}`} aria-hidden="true" />{c.name}
      </button>
    );
    const onChips = cur && !chips.active.some((c) => c.root === cur.root) ? [...chips.active, cur] : chips.active;
    body = (
      <>
        {tools(<span className="m-lk-sp" />)}
        <div className="m-chips m-lk-chips">{onChips.map(chip)}<button type="button" className="m-chip m-lk-more" onClick={() => setAllOpen(true)}>모든 프로젝트</button></div>
        {cur && <div className="m-lk-phead"><span className={`st-dot ${dotClass(cur.dot)}`} aria-hidden="true" /><b>{cur.name}</b></div>}
        {!cur && (
          <>
            <div className="m-sect">내 폴더</div>
            <div className="m-lk-folds">{tops.map(folderCard)}<button type="button" className="m-lk-fold m-lk-addf" aria-label="새 폴더" title="새 폴더" onClick={() => setNaming({ kind: 'folder', parent: '' })}><IconFolderPlus /></button></div>
          </>
        )}
        {logView(items)}
      </>
    );
  }

  return (
    <div className="m-lk">
      {body}
      {toast && <div className="m-lk-toast" role="status">{toast.text}{toast.undo && <button type="button" onClick={toast.undo}>되돌리기</button>}</div>}
      {held && <ItemMenu h={held} onClose={() => setHeld(null)} onOpen={() => open(held.path, held.name)} onAlias={() => setPicking(held)} onUnalias={held.link ? () => unalias(held) : undefined} />}
      {picking && <FolderPick folders={userFolders(tree.entries)} onClose={() => setPicking(null)} onPick={(rel) => void alias(picking, rel)} onNew={() => { setNaming({ kind: 'folder', parent: '', then: picking }); setPicking(null); }} />}
      {adding && <AddSheet where={folderRel ? baseName(folderRel) : '보관함'} onClose={() => setAdding(false)} onDoc={() => setNaming({ kind: 'doc', parent: folderRel })}
        onFiles={(fl) => void onUpload(fl).then(async (paths) => { if (folderRel) await Promise.allSettled(paths.map((p) => lockerAlias(owner, p, folderRel))); onReload(); }, (e) => say(`못 올렸어요 — ${(e as Error).message}`))} />}
      {naming && <NameSheet owner={owner} kind={naming.kind} parent={naming.parent} onClose={() => setNaming(null)}
        onMade={(made) => { setNaming(null); onReload(); if (naming.kind === 'doc') setEditing(made); else if (naming.then) void alias(naming.then, made); }} onError={(m) => say(m)} />}
      {editing && <MdEditor owner={owner} path={editing} onClose={() => { setEditing(null); onReload(); }} />}
      {allOpen && (
        <BottomSheet label="모든 프로젝트" title="모든 프로젝트" onClose={() => setAllOpen(false)}>
          {chips.all.length === 0 ? <p className="m-muted m-sm">떠 있는 프로젝트가 없어요</p> : chips.all.map((c) => (
            <button key={c.root} type="button" className="m-menu-item m-lk-allrow" onClick={() => { setAllOpen(false); setPlace({ kind: 'root', project: c.root }); }}>
              <span className={`st-dot ${dotClass(c.dot)}`} aria-hidden="true" /><b>{c.name}</b>
            </button>
          ))}
        </BottomSheet>
      )}
    </div>
  );
}
