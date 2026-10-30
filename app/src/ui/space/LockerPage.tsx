// 보관함 가운데 칸(홈·모드 v2, 사용자 10/11) — 맨 위 = 진행 중 칩 + 내 폴더 카드 + 날짜별 주고받은 기록 · 칩 = 그 프로젝트 기록 · 내 폴더(진짜 폴더).
// 기록은 로그 — 내 폴더로 끌면 바로가기만 생기고 기록엔 '→ 폴더'로 남는다. 보기는 카드/목록(머리 오른쪽, 폴더마다 기억, 기록은 목록 기본).
// 카드: 엑셀·한글·md 는 문서 모양 + 첫 줄, PPT·PDF·그림은 진짜 썸네일. 누르면 탭으로 연다. 끌어서 왼쪽 폴더·채팅에 놓는다
import { closeOnOutside } from '../outsideClose';
import { useEffect, useRef, useState } from 'react';
import { tr } from '../../i18n';
import { docUrl } from '../../domain/reader';
import { cardLook } from '../../domain/locker';
import { crumbsOf, givenBack, homeMark, kidsOf, linkState, readOnlyAt, userFolders, type LkEntry, type LkPlace } from '../../domain/lockerTree';
import { lockerMenu, moveTargets } from '../../domain/lockerMenu';
import { defaultView, logDays, type LockerViewMode, type LogItem } from '../../domain/lockerLog';
import { batchActs, trashKey, batchMenu, type PickedLook } from '../../domain/lockerSelect';
import type { DotKind } from '../../domain/dot';
import { IconButton } from '../kit/IconButton';
import { IconClose, IconDashboard, IconFolderAlias, IconFolderLink, IconFolderMove, IconFolderPlus, IconList, IconMaximize, IconMore, IconPlus, IconTrash } from '../Icons';
import { SendToOrch, type OrchTo } from './SendToOrch';
import { SortButton } from '../SortButton';
import { readSortOf, sortList, type SortState } from '../../domain/sortList';
import { useQlThumb } from './DashboardView';
import { usePeek, useTrashUndo, type Ver } from './useLocker';
import { trashAsk, type TrashAsk, type TrashPlan } from '../../domain/lockerTrash';
import { dragPath, dragPaths } from './dragPath';
import { usePick } from './usePick';
import { FolderTile, PathCrumbs } from './FolderTile';
import { folderItems, menuItems } from './lockerMenuItems';
import { useOrchActions } from '../orchActions';
import { teamLockerTeams } from '../../data/teamApi';
import { teamUploadSub, uploadApi } from '../team/teamUpload';
import './tools.css';
import './locker.css';

/** 폴더 안 정렬 — 팀 보관함과 같은 단추(SortButton), 고른 건 기억 */
const LK_SORTS = ['name', 'at', 'size'] as const;
const LK_SORT_KEY = 'locker.sort.v1';
const readLkSort = () => readSortOf(() => { try { return localStorage.getItem(LK_SORT_KEY); } catch { return null; } }, LK_SORTS);
const saveLkSort = (v: SortState) => { try { localStorage.setItem(LK_SORT_KEY, JSON.stringify(v)); } catch { /* 이번 실행만 */ } };
const lkVals = (e: LkEntry) => ({ name: e.name, at: e.mtime ?? 0, size: e.size ?? 0 });

const when = (t: number) => {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return new Date().toDateString() === d.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
};

/** 카드 한 장 — 보관함 줄(entry) 또는 보여 준 파일(shown) */
type CardItem = { path: string; name: string; gone: boolean; ms?: number; entry?: LkEntry; by?: string };

function Thumb({ c }: { c: CardItem }) {
  const { look, tag } = cardLook(c.path);
  const png = useQlThumb(c.path, look === 'shot' && !c.gone);
  const first = usePeek(c.path, look === 'doc' && !c.gone, c.ms ?? 0);
  if (look === 'image' && !c.gone) return <span className="lk-thumb"><img src={docUrl(c.path)} alt="" loading="lazy" draggable={false} /><i className="lk-tag">{tag}</i></span>;
  if (look === 'shot' && png) return <span className="lk-thumb"><img className="lk-shot" src={docUrl(png)} alt="" draggable={false} /><i className="lk-tag">{tag}</i></span>;
  return (
    <span className="lk-thumb lk-doc">
      <span className="lk-page"><b>{first || c.name.replace(/\.[^.]+$/, '')}</b><i /><i /><i /></span>
      <i className={`lk-tag t-${tag.toLowerCase()}`}>{tag}</i>
    </span>
  );
}

export type CardActs = {
  onOpen: (path: string) => void;
  /** 띄워 보기 — 탭 대신 스페이스 위 미리보기 창(모달) */
  onFloat?: (path: string) => void;
  onSend: (path: string) => void;
  /** 보내기 받는 참모(이름·색) — 단추가 그 참모 색 */
  sendTo?: OrchTo | null;
  onRename?: (rel: string, name: string) => void;
  onTrash?: (rel: string) => void;
  onReveal?: (path: string) => void;
  onBack?: (path: string) => void;
  onKeep?: (path: string) => void;
  loadVers?: (path: string) => Promise<Ver[]>;
  onRestore?: (path: string, n: number) => void;
  /** 끊긴 바로가기 — 같은 이름 후보 찾기 / 그 자리로 다시 잇기 */
  findOrig?: (path: string) => Promise<string[]>;
  onRelink?: (path: string, target: string) => void;
  /** 폴더에 바로가기(기록·집은 그대로 — 끌어 놓기와 같은 길) */
  onAlias?: (path: string, folder: string) => void;
  /** 옮기기(보관함 안 파일·폴더 — 진짜 옮김, to = 빈 글이면 맨 위) */
  onMove?: (rel: string, to: string) => void;
  /** 맥 폴더 연결 — 끊긴 걸 다시 잇기 / 풀기(링크만 지운다, 원본은 그대로) */
  onReconnect?: (rel: string) => void;
  onDisconnect?: (rel: string) => void;
  /** 여러 개 고른 묶음(2026-10-12 사용자) — 채팅 입력칸에 한꺼번에 · 폴더에 바로가기 · 옮기기 · 휴지통(연결 폴더 안은 맥 휴지통) */
  onSendMany?: (paths: string[]) => void;
  /** 지금 연 폴더째 참모에게 — 폴더 머리줄(2026-10-30 사용자 '이 폴더'), 입력칸에 폴더 칩 */
  onSendFolder?: (path: string) => void;
  onAliasMany?: (paths: string[], folder: string) => void;
  onMoveMany?: (rels: string[], to: string) => void;
  /** foldersOk = 안에 든 것이 있는 폴더까지(화면이 '폴더 n개(안에 k개)'를 따로 확인받았다) */
  onTrashMany?: (rels: string[], foldersOk: boolean) => void;
  /** 휴지통 확인 재료(Rust 가 센 실제 규모) — 2026-10-12 사고 */
  planTrash?: (rels: string[]) => Promise<TrashPlan>;
  /** 폴더 안의 것은 꺼내고(to = null 이면 위 폴더) 또는 to 로 옮기고 폴더만 휴지통 */
  onEmptyOut?: (rels: string[], to: string | null) => void;
  /** 마지막 휴지통 묶음 되돌리기 */
  onUndoTrash?: () => void;
};

/** 오른쪽 클릭···· — rename = 그 자리 이름 칸 열기 */
type OnMenu = (e: React.MouseEvent, rename: () => void) => void;

/** 고르기(파인더식) — press = ⌘·⇧ 누름을 고르기로 받았으면 true(그러면 열지 않는다), drag = 끌기(고른 묶음 안이면 묶음째) */
type Pick = { picked: boolean; press: (e: React.MouseEvent) => boolean; drag: ReturnType<typeof dragPath> };

function Card({ c, mark, acts, onMenu, pick }: { c: CardItem; mark: string | null; acts: CardActs; onMenu?: OnMenu; pick?: Pick }) {
  const [naming, setNaming] = useState<string | null>(null);
  const e = c.entry;
  const done = () => { const n = naming?.trim(); if (e && n && n !== c.name) acts.onRename?.(e.rel, n); setNaming(null); };
  const menu = onMenu ? (x: React.MouseEvent) => onMenu(x, () => setNaming(c.name)) : undefined;
  const meta = [mark, c.ms ? when(c.ms) : ''].filter(Boolean).join(' · ');
  return (
    <div className={`lk-card ${c.gone ? 'gone' : ''} ${pick?.picked ? 'picked' : ''}`} data-pick={c.path} onContextMenu={menu}>
      <button className="lk-open" {...(c.gone ? {} : pick?.drag ?? dragPath(c.path))} onClick={(x) => { if (!pick?.press(x) && !c.gone) acts.onOpen(c.path); }} title={c.path} aria-disabled={c.gone || undefined}>
        <Thumb c={c} />
      </button>
      <div className="lk-body">
        {naming !== null ? (
          <input className="lk-rename" autoFocus value={naming} aria-label={tr('이름 바꾸기', 'Rename')} onChange={(x) => setNaming(x.target.value)} onBlur={done}
            onKeyDown={(x) => { if (x.key === 'Enter' && !x.nativeEvent.isComposing) done(); if (x.key === 'Escape') setNaming(null); }} />
        ) : <b title={c.name}>{c.name}</b>}
        <span className="lk-meta">
          {meta && <span>{meta}</span>}
          {c.gone && <em className="lk-badge warn">{tr('원본 없음', 'Original missing')}</em>}
          {!c.gone && e && e.vers > 1 && <em className="lk-badge">{tr(`판 ${e.vers}`, `v${e.vers}`)}</em>}
        </span>
      </div>
      <div className="lk-acts">
        {!c.gone && <SendToOrch size="s" to={acts.sendTo} onClick={() => acts.onSend(c.path)} />}
        {menu && <IconButton size="s" tone="line" label={tr('더 보기', 'More')} onClick={menu}><IconMore /></IconButton>}
      </div>
    </div>
  );
}

function FolderCard({ e, dir, count, onPlace, onRename, onMenu, fresh, pick }: { e: LkEntry; dir: string; count: number; onPlace: (p: LkPlace) => void; onRename?: (rel: string, name: string) => void; onMenu?: OnMenu; /** 방금 만든 폴더 — 바로 이름 칸 */ fresh?: boolean; pick?: Pick }) {
  const link = linkState(e);
  // 연결 폴더·그 안쪽은 읽기 전용이라 끌어 놓는 자리가 아니다
  // data-locker-path = 끄는 폴더 자신·그 안엔 빛·놓기가 없게(dragPath selfOrInside)
  const drop = e.linked || e.ro ? {} : { 'data-locker-folder': e.rel, 'data-locker-drop': e.rel, 'data-locker-path': `${dir}/${e.rel}` };
  return (
    <FolderTile name={e.name} title={e.rel} cls={link === 'gone' ? 'gone' : undefined} icon={e.linked ? <IconFolderLink /> : undefined} drop={drop}
      pick={{ picked: !!pick?.picked, press: (x) => !!pick?.press(x), drag: pick?.drag ?? dragPath(`${dir}/${e.rel}`) }} pickKey={pick ? `${dir}/${e.rel}` : undefined} fresh={fresh}
      tail={link === 'gone' ? <em className="lk-badge warn">{tr('원본 없음', 'Original missing')}</em> : <span className="lk-count">{count}</span>}
      onOpen={() => onPlace({ kind: 'dir', rel: e.rel })} onRename={onRename && ((n) => onRename(e.rel, n))} onMenu={onMenu} />
  );
}

const entryCard = (dir: string, e: LkEntry): CardItem => ({ path: `${dir}/${e.rel}`, name: e.name, gone: e.gone, ms: e.mtime ?? undefined, entry: e });
const baseName = (p: string) => p.split('/').pop() ?? p;
const tagOf = (p: string) => cardLook(p).tag;

/** 목록 한 줄 — 시각 · 종류 · 이름 · 누가 · 무엇(→ 폴더) */
const hm = (t: number) => { const d = new Date(t); return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function Row({ path, name, ms, who, what, gone, onOpen, timeOnly, onRename, onMenu, pick }: { path: string; name: string; ms?: number; who?: string; what?: string; gone?: boolean; onOpen: (p: string) => void; /** 날짜 머리 아래(기록) — 시:분만 */ timeOnly?: boolean; onRename?: (name: string) => void; onMenu?: OnMenu; pick?: Pick }) {
  const [naming, setNaming] = useState<string | null>(null);
  const tag = tagOf(path);
  const done = () => { const n = naming?.trim(); if (n && n !== name) onRename?.(n); setNaming(null); };
  const cells = (title: React.ReactNode) => (
    <>
      <i className={`lk-tag t-${tag.toLowerCase()}`}>{tag}</i>
      {title}
      <span className="lk-lwho">{who ?? ''}</span>
      <span className="lk-lwhat">{gone ? tr('원본 없음', 'Original missing') : what ?? ''}</span>
      <span className="lk-ltime">{ms ? (timeOnly ? hm(ms) : when(ms)) : ''}</span>
    </>
  );
  if (naming !== null) {
    return (
      <div className="lk-lrow">
        {cells(<input className="lk-rename" autoFocus value={naming} aria-label={tr('이름 바꾸기', 'Rename')} onChange={(x) => setNaming(x.target.value)} onBlur={done}
          onKeyDown={(x) => { if (x.key === 'Enter' && !x.nativeEvent.isComposing) done(); if (x.key === 'Escape') setNaming(null); }} />)}
      </div>
    );
  }
  return (
    <button className={`lk-lrow ${gone ? 'gone' : ''} ${pick?.picked ? 'picked' : ''}`} data-pick={path} {...(gone ? {} : pick?.drag ?? dragPath(path))} onClick={(x) => { if (!pick?.press(x) && !gone) onOpen(path); }} title={path}
      aria-disabled={gone || undefined}
      onContextMenu={onMenu ? (x) => onMenu(x, () => setNaming(name)) : undefined}>
      {cells(<b>{name}</b>)}
    </button>
  );
}

/** 경로 줄(2026-10-12 나무 칸을 없앴다) — 보관함 › 자료 › 10월. 칸을 누르면 거기로, 카드를 끌어 놓으면 그 폴더로(data-locker-folder),
 *  파인더에서 놓아도 그 폴더(data-locker-drop). 팀 보관함과 같은 조각(PathCrumbs) */
function Crumbs({ dir, rel, count, onPlace, ro }: { dir: string; rel: string; count: number; onPlace: (p: LkPlace) => void; /** 그 칸이 읽기 전용(연결 폴더 안)인가 — 끌어 놓는 자리에서 뺀다 */ ro?: (rel: string) => boolean }) {
  const drop = (r: string) => (r && ro?.(r) ? {} : { 'data-locker-folder': r, 'data-locker-drop': r, 'data-locker-path': r ? `${dir}/${r}` : dir });
  return <PathCrumbs root={tr('보관함', 'Locker')} crumbs={crumbsOf(rel).map((c) => ({ key: c.rel, name: c.name }))} count={count} dropOf={drop} onGo={(r) => onPlace(r ? { kind: 'dir', rel: r } : { kind: 'root' })} />;
}

/** 머리 + — 새 문서(md)·새 엑셀(xlsx)·파일 넣기(홈·모드 ⑦). 지금 보는 폴더에 만들고 바로 탭으로 */
function AddMenu({ folder, onNewDoc, onChoose, onConnect }: { folder: string; onNewDoc?: (folder: string, kind: 'md' | 'xlsx') => void; onChoose: (folder: string) => void; onConnect?: (folder: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const stopOutside = closeOnOutside(window, (t) => !!box.current?.contains(t as Node), () => setOpen(false));
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => { stopOutside(); window.removeEventListener('keydown', esc); };
  }, [open]);
  const go = (f: () => void) => { setOpen(false); f(); };
  if (!onNewDoc) return <IconButton tone="pri" label={tr('파일 넣기', 'Add files')} title={tr('맥에서 파일 골라 넣기', 'Pick files from your Mac')} onClick={() => onChoose(folder)}><IconPlus /></IconButton>;
  return (
    <div className="lk-add" ref={box}>
      <IconButton tone="pri" label={tr('새로 만들기·파일 넣기', 'New or add')} pressed={open} onClick={() => setOpen((o) => !o)}><IconPlus /></IconButton>
      {open && (
        <div className="lk-menu lk-add-menu" role="menu">
          <button role="menuitem" onClick={() => go(() => onNewDoc(folder, 'md'))}>{tr('새 문서', 'New document')}</button>
          <button role="menuitem" onClick={() => go(() => onNewDoc(folder, 'xlsx'))}>{tr('새 엑셀', 'New spreadsheet')}</button>
          <button role="menuitem" onClick={() => go(() => onChoose(folder))}>{tr('파일 넣기', 'Add files')}</button>
          {onConnect && <button role="menuitem" onClick={() => go(() => onConnect(folder))}>{tr('맥 폴더 연결…', 'Link a Mac folder…')}</button>}
        </div>
      )}
    </div>
  );
}

/** session = 그 프로젝트에 떠 있는 세션(있으면 머리줄 '크게' = 그 세션 탭, 패널 하나로 S6) */
export type ChipProject = { root: string; name: string; dot: DotKind; what?: string; session?: string };

/** 진행 중 칩 줄 + '모든 프로젝트' 덮개(찾기 · 진행 중 · 쉼 · 꺼짐) */
function Chips({ active, all, on, onPick, onAddProject }: { active: ChipProject[]; all: ChipProject[]; on?: string; onPick: (root?: string) => void; /** 프로젝트 폴더 더하기(devRoot 밖) — 옛 왼쪽 메뉴 '프로젝트' 절 + 에서 옮김 */ onAddProject?: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const stopOutside = closeOnOutside(window, (t) => !!box.current?.contains(t as Node), () => setOpen(false));
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => { stopOutside(); window.removeEventListener('keydown', esc); };
  }, [open]);
  const hit = all.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const group = (title: string, ps: ChipProject[]) => ps.length > 0 && (
    <>
      <div className="lk-pop-cap">{title}</div>
      {ps.map((p) => (
        <button key={p.root} className={`lk-pop-it ${p.root === on ? 'on' : ''}`} onClick={() => { setOpen(false); onPick(p.root); }} title={p.root}>
          <span className={`lk-dot d-${p.dot}`} aria-hidden="true" /><span className="lk-pop-nm">{p.name}</span>
        </button>
      ))}
    </>
  );
  const pinned = on && !active.some((p) => p.root === on) ? all.find((p) => p.root === on) : undefined;
  return (
    <div className="lk-chips" ref={box}>
      <button className={`lk-chip ${!on ? 'on' : ''}`} onClick={() => onPick(undefined)}>{tr('전체 기록', 'All activity')}</button>
      {[...active, ...(pinned ? [pinned] : [])].map((p) => (
        <button key={p.root} className={`lk-chip ${p.root === on ? 'on' : ''}`} onClick={() => onPick(p.root === on ? undefined : p.root)} title={p.root}>
          <span className={`lk-dot d-${p.dot}`} aria-hidden="true" />{p.name}
        </button>
      ))}
      {(all.length > 0 || onAddProject) && (
        <button className={`lk-chip more ${open ? 'open' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {tr(`모든 프로젝트 ${all.length}`, `All projects ${all.length}`)}
        </button>
      )}
      {open && (
        <div className="lk-pop" role="dialog" aria-label={tr('모든 프로젝트', 'All projects')}>
          <input className="lk-pop-find" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('프로젝트 찾기', 'Find a project')} aria-label={tr('프로젝트 찾기', 'Find a project')} />
          <div className="lk-pop-list">
            {group(tr('진행 중', 'Active'), hit.filter((p) => p.dot === 'ask' || p.dot === 'run'))}
            {group(tr('쉬는 것', 'Resting'), hit.filter((p) => p.dot === 'rest'))}
            {group(tr('꺼진 것', 'Off'), hit.filter((p) => p.dot === 'off'))}
            {hit.length === 0 && <div className="lk-menu-note">{tr('없어요', 'Nothing')}</div>}
          </div>
          {onAddProject && <button className="lk-pop-add" onClick={() => { setOpen(false); onAddProject(); }}>{tr('프로젝트 폴더 더하기', 'Add a project folder')}</button>}
        </div>
      )}
    </div>
  );
}

const VIEW_KEY = 'lockerView';
const loadViews = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as Record<string, string>; } catch { return {}; } };

export function LockerPage({ dir, place, entries, log, chips, projects, whoOf, onPlace, onChoose, onConnect, onNewDoc, onNewFolder, acts, onBigProject, onAddProject }: {
  dir: string;
  /** 홈(l:<참모>#h)은 HomeView 가 그린다 */
  place: Exclude<LkPlace, { kind: 'home' }>;
  entries: LkEntry[];
  /** 주고받은 기록(lockerLog — 최근 순) */
  log: LogItem[];
  /** 진행 중(일하는·기다리는) 프로젝트 칩 · 모든 프로젝트 */
  chips: { active: ChipProject[]; all: ChipProject[] };
  projects: { name: string; root: string }[];
  /** 기록 줄 '누가' — me·세션 id·참모 id → 읽을 이름 */
  whoOf: (by: string) => string;
  onPlace: (p: LkPlace) => void;
  onChoose: (folder: string) => void;
  /** 맥 폴더 연결 — 앱 파일 창으로 폴더를 골라 그 폴더(빈 글 = 맨 위)에 바로가기 폴더로 */
  onConnect?: (folder: string) => void;
  /** 새 문서·새 엑셀 — 그 폴더에 만들고 탭으로(⑦) */
  onNewDoc?: (folder: string, kind: 'md' | 'xlsx') => void;
  /** 새 폴더 — 만든 자리(rel)를 돌려주면 그 카드가 바로 이름 칸 */
  onNewFolder: (parent: string) => Promise<string> | void;
  acts: CardActs;
  /** 진행 중 칩 머리줄 크게 — 그 프로젝트 세션 탭(세션 id) */
  onBigProject?: (session: string) => void;
  onAddProject?: () => void;
}) {
  const [views, setViews] = useState<Record<string, string>>(loadViews);
  const vkey = place.kind === 'dir' ? `d:${place.rel}` : place.project ? `p:${place.project}` : 'root';
  const view = defaultView(views[vkey] ?? null, place.kind === 'dir' ? 'dir' : 'log');
  const setView = (v: LockerViewMode) => setViews((x) => {
    const next = { ...x, [vkey]: v };
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(next)); } catch { /* 이번 실행만 */ }
    return next;
  });
  const markOf = (e?: LkEntry) => {
    const m = e ? homeMark(e, projects) : null;
    return m === 'outside' ? tr('바깥 원본', 'Original elsewhere') : m;
  };
  // 카드/목록 — 앱 공용 두 갈래 켜기(.tl-seg) 안에 아이콘 둘(익숙한 동작)
  const viewSeg = (
    <div className="tl-seg lk-view" role="tablist" aria-label={tr('보기', 'View')}>
      <button role="tab" aria-selected={view === 'card'} className={view === 'card' ? 'on' : ''} onClick={() => setView('card')} aria-label={tr('카드로 보기', 'Cards')} title={tr('카드로 보기', 'Cards')}><IconDashboard /></button>
      <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} aria-label={tr('목록으로 보기', 'List')} title={tr('목록으로 보기', 'List')}><IconList /></button>
    </div>
  );
  const count = (r: string) => entries.filter((e) => !e.dir && e.rel.startsWith(`${r}/`)).length;
  // 오른쪽 클릭·카드 ··· — 앱 공용 메뉴(OrchDialogs ContextMenu), 무엇이 뜨나는 domain/lockerMenu
  const act = useOrchActions();
  const folders = userFolders(entries);
  const here = place.kind === 'dir' ? place.rel : '';
  // 연결 폴더(맥 폴더의 바로가기)와 그 안쪽은 읽기 전용 — 새 폴더·넣기·끌어놓기가 없다
  const ro = readOnlyAt(entries, here);
  const roAt = (r: string) => readOnlyAt(entries, r);
  const connectBtn = onConnect && !ro ? <IconButton tone="line" label={tr('맥 폴더 연결…', 'Link a Mac folder…')} onClick={() => onConnect(here)}><IconFolderLink /></IconButton> : null;
  // 새 폴더 — 만들고 그 자리에 머물러 그 카드를 바로 이름 칸으로(나무의 이름 칸을 대신한다)
  const [fresh, setFresh] = useState('');
  const newFolder = (parent: string) => { if (parent !== here) onPlace(parent ? { kind: 'dir', rel: parent } : { kind: 'root' }); void Promise.resolve(onNewFolder(parent)).then((rel) => { if (rel) setFresh(rel); }); };
  const abs = (rel: string) => (rel ? `${dir}/${rel}` : dir);
  // 보이는 것 — 맨 위(기록) 또는 폴더 안(하위 폴더 + 파일). 고르기 순서(⇧범위·⌘A)가 이 순서
  const cur = place.kind === 'root' && place.project ? chips.all.find((p) => p.root === place.project) : undefined;
  const items = place.kind !== 'root' ? [] : place.project ? log.filter((it) => it.project === (cur?.name ?? place.project!.split('/').pop())) : log;
  const kids = place.kind === 'dir' ? kidsOf(entries, place.rel) : [];
  const [sort, setSort] = useState(readLkSort);
  const dirs = sortList(kids.filter((e) => e.dir), sort.key === 'size' ? { key: 'name', desc: false } : sort, lkVals);
  const files = sortList(kids.filter((e) => !e.dir), sort, lkVals);
  const entryAt = (path: string) => (path.startsWith(`${dir}/`) ? entries.find((x) => `${dir}/${x.rel}` === path) : undefined);
  // 여러 개 고르기(2026-10-12 사용자 "골라서 지우려는데 고르는 단추가 없다") — 기록은 바로가기·보내기·휴지통(보관함에 든 것만, 10-22), 폴더 안은 옮기기까지
  const where = place.kind === 'root' ? 'log' : 'dir';
  const pickables: { key: string; rel?: string; look: PickedLook }[] = place.kind === 'root'
    ? items.map((it) => { const e = entryAt(it.path); return { key: it.path, rel: e?.rel, look: { kind: 'file', inLocker: !!e, gone: !!e?.gone, ro: !!e?.ro } }; })
    : [...dirs, ...files].map((e) => ({ key: abs(e.rel), rel: e.rel, look: { kind: e.dir ? 'folder' : 'file', inLocker: true, linked: !!e.linked, ro: !!e.ro, gone: e.gone } }));
  const order = pickables.map((x) => x.key);
  // 휴지통 한 번 더 묻는 중 — Rust 가 센 실제 규모(파일·폴더·안에 든 항목)와 고를 단추
  const [ask, setAsk] = useState<{ a: TrashAsk; p: TrashPlan } | null>(null);
  const undo = useTrashUndo();
  // 팀 보관함에 올리기 — 든 팀이 있을 때만 메뉴에(10-28 사용자 "참모 보관함 파일을 팀 보관함으로 못 옮긴다"), 올린 뒤 한 줄(팀 모두에게 보인다)
  const [teams, setTeams] = useState(false);
  useEffect(() => { void teamLockerTeams().then((t) => setTeams(t.length > 0), () => {}); }, []);
  const [teamNote, setTeamNote] = useState('');
  useEffect(() => {
    if (!teamNote) return;
    const t = window.setTimeout(() => setTeamNote(''), 6000);
    return () => window.clearTimeout(t);
  }, [teamNote]);
  const box = useRef<HTMLDivElement>(null);
  // 고르기(⌘·⇧클릭·네모·⌘A·풀기)는 팀 보관함과 같은 훅(usePick) — 고른 게 바뀌면 묻던 휴지통 확인은 닫는다
  const pick = usePick({ box, order, reset: vkey, skip: '[data-pick], button, input, textarea, a, [role=menu], .lk-selbar, .lk-head, .lk-chips, .lk-pop', touch: () => setAsk(null) });
  const { sel, end: endPick, bandStart, band } = pick;
  // Backspace·Delete·⌘⌫ = 고른 것 휴지통(Finder 처럼, 2026-10-15 사용자) — 보관함 칸 안 포커스일 때만(domain/lockerSelect trashKey). 최신 고른 것은 keyRef 로
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    const t = e.target as HTMLElement | null;
    const editable = !!t?.closest?.('input, textarea, [contenteditable="true"]');
    if (t && t !== document.body && (!box.current?.contains(t) || editable)) return;
    if (e.key === 'Escape' && sel.keys.length > 0) { endPick(); return; }
    const k = trashKey({ key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, inBox: !!t && !!box.current?.contains(t), composing: e.isComposing, editable, asking: !!ask }, picked.map((x) => x.look), where);
    if (!k) return;
    e.preventDefault();
    if (k === 'many') { askTrash(pickedRels, n - pickedRels.length); return; }
    const rel = picked[0]?.rel;
    if (rel && acts.onTrash) { acts.onTrash(rel); endPick(); } // 되돌리기 알림은 휴지통 결과(LOCKER_TRASHED)가 띄운다 — 고른 게 풀려야 보인다
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const pickOf = (key: string): Pick => ({
    picked: pick.picked(key),
    press: (x) => pick.press(x, key),
    // 고른 묶음 안의 것을 끌면 묶음째(화면 순서), 밖이면 그 하나
    drag: pick.many(key) ? dragPaths(order.filter((k) => sel.keys.includes(k))) : dragPath(key),
  });
  const picked = pickables.filter((x) => sel.keys.includes(x.key));
  const bacts = batchActs(picked.map((x) => x.look), { where, folders: folders.length });
  const pickedPaths = picked.map((x) => x.key);
  const pickedRels = picked.flatMap((x) => (x.rel ? [x.rel] : []));
  const n = picked.length;
  // 묶음 옮기기 자리 — 고른 것 모두가 갈 수 있는 곳만
  const moveManyItems = () => ['', ...folders.map((f) => f.rel)].filter((t) => pickedRels.every((r) => moveTargets(r, folders).includes(t)))
    .map((t) => ({ label: t ? t.split('/').join(' › ') : tr('보관함(맨 위)', 'Locker (top)'), run: () => { acts.onMoveMany?.(pickedRels, t); endPick(); } }));
  const aliasManyItems = () => folderItems(folders, (rel) => { acts.onAliasMany?.(pickedPaths, rel); endPick(); });
  const sendMany = () => { acts.onSendMany?.(pickedPaths); endPick(); };
  // 휴지통 — 먼저 센다. 빈 폴더(숨은 파일만)뿐이면 묻지 않고 바로, 아니면 실제 규모를 보이고 단추를 고르게
  const askTrash = (rels: string[], outside = 0) => {
    if (!acts.planTrash || !rels.length) return;
    void acts.planTrash(rels).then((p) => {
      const a = trashAsk(p, outside);
      if (a.direct) { acts.onTrashMany?.(p.empty_rels, false); endPick(); return; }
      setAsk({ a, p });
    }, () => {});
  };
  const runChoice = (c: TrashAsk['choices'][number], ev: React.MouseEvent) => {
    if (c.key === 'lift') { acts.onEmptyOut?.(c.rels, null); endPick(); return; }
    if (c.key === 'moveOut') {
      const out = ask?.p.dir_rels ?? [];
      const tos = ['', ...folders.map((f) => f.rel)].filter((t) => !out.some((d) => t === d || t.startsWith(`${d}/`)));
      act?.openMenu(ev, tos.map((t) => ({ label: t ? t.split('/').join(' › ') : tr('보관함(맨 위)', 'Locker (top)'), run: () => { acts.onEmptyOut?.(c.rels, t); endPick(); } })));
      return;
    }
    acts.onTrashMany?.(c.rels, !!c.foldersOk);
    endPick();
  };
  const sendName = acts.sendTo?.name;
  const batchItems = () => menuItems(batchMenu(bacts).map((g) => (g.includes('send') && teams ? [...g, 'team' as const] : g)), {
    send: acts.onSendMany && { run: sendMany, label: sendName ? tr(`${n}개 ${sendName}에게 보내기`, `Send ${n} to ${sendName}`) : tr(`${n}개 참모에게 보내기`, `Send ${n} to assistant`) },
    team: teams ? { sub: teamUploadSub(pickedPaths, uploadApi, (t) => { setTeamNote(t); endPick(); }), label: tr(`${n}개 팀 보관함에 올리기`, `Upload ${n} to team locker`), empty: tr('든 팀이 없어요', 'No team') } : undefined,
    alias: acts.onAliasMany && { sub: aliasManyItems, label: tr(`${n}개 폴더에 바로가기`, `Add ${n} shortcuts to folder`) },
    move: acts.onMoveMany && { sub: moveManyItems, empty: tr('옮길 폴더가 없어', 'No folder to move to'), label: tr(`${n}개 옮기기`, `Move ${n} to`) },
    trash: acts.onTrashMany && { run: () => askTrash(pickedRels, n - pickedRels.length), label: tr(`${n}개 휴지통으로…`, `Move ${n} to Trash…`) },
  });
  const many = pick.many;
  // 우클릭 — 고른 묶음 밖이면 그 하나만 고른다(고를 수 있는 자리에서만)
  const pickRight = pick.right;
  const has = (k: (typeof bacts)[number]) => bacts.includes(k);
  // 고른 것 동작 줄 — 아래에 붙는다. 익숙한 동작은 아이콘, 휴지통은 되돌리기 어려워 글자 단추로 한 번 더
  const selBar = (n > 0 || ask) && (
    <div className={`lk-selbar ${ask ? 'asking' : ''}`} role="toolbar" aria-label={ask ? tr('휴지통 확인', 'Confirm Trash') : tr('고른 것', 'Selection')}>
      {ask ? (
        <>
          <span className="lk-ask">
            <b>{ask.a.text}</b>
            {ask.a.blocked && <span className="lk-blocked" title={ask.p.blocked.map((x) => `${x.rel} — ${x.why}`).join('\n')}>{ask.a.blocked}</span>}
          </span>
          <span className="lk-sp" />
          {ask.a.choices.map((c) => <button key={c.key} className={c.pri ? 'btn lk-sure' : 'btn'} onClick={(ev) => runChoice(c, ev)}>{c.label}</button>)}
          <button className="btn" onClick={() => setAsk(null)}>{tr('취소', 'Cancel')}</button>
        </>
      ) : (
        <>
          <b className="lk-selcount">{tr(`${n}개 고름`, `${n} selected`)}</b>
          <span className="lk-sp" />
          {has('send') && acts.onSendMany && <SendToOrch to={acts.sendTo} onClick={sendMany} />}
          {has('alias') && acts.onAliasMany && <IconButton label={tr('폴더에 바로가기', 'Add shortcuts to folder')} onClick={(x) => act?.openMenu(x, aliasManyItems())}><IconFolderAlias /></IconButton>}
          {has('move') && acts.onMoveMany && <IconButton label={tr('폴더로 옮기기', 'Move to folder')} onClick={(x) => act?.openMenu(x, moveManyItems())}><IconFolderMove /></IconButton>}
          {has('trash') && acts.onTrashMany && <IconButton label={tr('휴지통으로', 'Move to Trash')} onClick={() => askTrash(pickedRels, n - pickedRels.length)}><IconTrash /></IconButton>}
          <IconButton label={tr('고른 것 풀기', 'Clear selection')} title={tr('고른 것 풀기 (Esc)', 'Clear selection (Esc)')} onClick={endPick}><IconClose /></IconButton>
        </>
      )}
    </div>
  );
  // 휴지통 직후 — 되돌리기(맥 휴지통에서 그 묶음을 원래 자리로). 지나가도 빈 곳 메뉴 '휴지통 되돌리기'
  // 팀 보관함에 올린 뒤 한 줄 — 고른 것 줄·휴지통 묻기가 없을 때
  const teamBar = teamNote && !ask && n === 0 && (
    <div className="lk-selbar lk-undo" role="status">
      <span className="lk-ask"><b>{teamNote}</b></span>
      <span className="lk-sp" />
      <IconButton label={tr('닫기', 'Close')} onClick={() => setTeamNote('')}><IconClose /></IconButton>
    </div>
  );
  const undoBar = undo.toast !== null && !ask && n === 0 && (
    <div className="lk-selbar lk-undo" role="status">
      <span className="lk-ask"><b>{tr(`${undo.toast}개를 휴지통으로 옮겼어`, `Moved ${undo.toast} to Trash`)}</b></span>
      <span className="lk-sp" />
      {acts.onUndoTrash && <button className="btn" onClick={() => { acts.onUndoTrash!(); undo.hide(); }}>{tr('되돌리기', 'Undo')}</button>}
      <IconButton label={tr('닫기', 'Close')} onClick={undo.hide}><IconClose /></IconButton>
    </div>
  );
  const noShiftSelect = pick.noShiftSelect;
  const bandEl = band && <div className="lk-band" style={band} aria-hidden="true" />;
  // '옮기기' 다음 목록 — 맨 위(보관함) + 내 폴더(지금 자리·자기 안은 빼고)
  const moveItems = (rel: string) => moveTargets(rel, folders).map((t) => ({ label: t ? t.split('/').join(' › ') : tr('보관함(맨 위)', 'Locker (top)'), run: () => acts.onMove!(rel, t) }));
  const fileMenu = (c: CardItem): OnMenu | undefined => (act ? (ev, rename) => {
    if (many(c.path)) { act.openMenu(ev, batchItems()); return; }
    pickRight(c.path);
    const e = c.entry;
    const keys = lockerMenu({ kind: 'file', entry: e ? { link: !!e.link, gone: c.gone, vers: e.vers, givenBack: givenBack(e), ro: !!e.ro } : null, folders: folders.length, teams });
    act.openMenu(ev, menuItems(keys, {
      open: { run: () => acts.onOpen(c.path) },
      big: acts.onFloat && { run: () => acts.onFloat!(c.path) },
      send: { run: () => acts.onSend(c.path), label: acts.sendTo?.name ? tr(`${acts.sendTo.name}에게 보내기`, `Send to ${acts.sendTo.name}`) : undefined },
      team: teams ? { sub: teamUploadSub([c.path], uploadApi, setTeamNote), empty: tr('든 팀이 없어요', 'No team') } : undefined,
      alias: acts.onAlias && { sub: () => folderItems(folders, (rel) => acts.onAlias!(c.path, rel)) },
      move: e && acts.onMove && { sub: () => moveItems(e.rel), empty: tr('옮길 폴더가 없어', 'No folder to move to') },
      keep: acts.onKeep && { run: () => acts.onKeep!(c.path) },
      back: acts.onBack && { run: () => acts.onBack!(c.path) },
      rename: e && !e.ro && acts.onRename ? { run: rename } : undefined,
      vers: acts.loadVers && {
        sub: async () => [...await acts.loadVers!(c.path)].reverse().map((v) => ({ label: tr(`${v.n}판으로 되돌리기`, `Restore v${v.n}`) + (v.mtime ? ` · ${when(v.mtime)}` : ''), run: () => acts.onRestore?.(c.path, v.n) })),
        empty: tr('남은 판이 없어', 'No versions'),
      },
      find: acts.findOrig && {
        sub: async () => (await acts.findOrig!(c.path)).map((t) => ({ label: t.replace(/^\/Users\/[^/]+/, '~'), title: t, run: () => acts.onRelink?.(c.path, t) })),
        empty: tr('같은 이름 파일을 못 찾았어', 'No file with that name'),
      },
      reveal: e && acts.onReveal && { run: () => acts.onReveal!(c.path) },
      trash: e && acts.onTrash && { run: () => acts.onTrash!(e.rel) },
      unlink: e && acts.onTrash && { run: () => acts.onTrash!(e.rel) },
    }));
  } : undefined);
  const folderMenu = (e: LkEntry): OnMenu | undefined => (act ? (ev, rename) => {
    if (many(abs(e.rel))) { act.openMenu(ev, batchItems()); return; }
    pickRight(abs(e.rel));
    act.openMenu(ev, menuItems(lockerMenu({ kind: 'folder', link: linkState(e), ro: e.ro }), {
    open: { run: () => onPlace({ kind: 'dir', rel: e.rel }) },
    reconnect: acts.onReconnect && { run: () => acts.onReconnect!(e.rel) },
    disconnect: acts.onDisconnect && { run: () => acts.onDisconnect!(e.rel) },
    newFolder: { run: () => newFolder(e.rel) },
    move: acts.onMove && { sub: () => moveItems(e.rel), empty: tr('옮길 폴더가 없어', 'No folder to move to') },
    newDoc: onNewDoc && { run: () => onNewDoc(e.rel, 'md') },
    rename: acts.onRename && { run: rename },
    reveal: acts.onReveal && { run: () => acts.onReveal!(abs(e.rel)) },
    trash: acts.planTrash && { run: () => askTrash([e.rel]) },
    }));
  } : undefined);
  // 빈 곳 — 지금 보는 폴더에 새로 만들기. 이름 칸(input) 위에선 맥 기본 메뉴(붙여넣기)
  const blankMenu = act ? (ev: React.MouseEvent) => {
    if ((ev.target as HTMLElement).closest('input, textarea')) return;
    act.openMenu(ev, menuItems(lockerMenu({ kind: 'blank', ro, untrash: !!undo.last }), {
      untrash: acts.onUndoTrash && { run: acts.onUndoTrash, label: tr(`휴지통 되돌리기(${undo.last?.count ?? 0}개)`, `Undo move to Trash (${undo.last?.count ?? 0})`) },
      connect: onConnect && { run: () => onConnect(here) },
      newFolder: { run: () => newFolder(here) },
      newDoc: onNewDoc && { run: () => onNewDoc(here, 'md') },
      newSheet: onNewDoc && { run: () => onNewDoc(here, 'xlsx') },
      add: { run: () => onChoose(here) },
      reveal: acts.onReveal && { run: () => acts.onReveal!(abs(here)) },
    }));
  } : undefined;
  const rowRename = (e?: LkEntry) => (e && !e.ro && acts.onRename ? (n: string) => acts.onRename!(e.rel, n) : undefined);
  const whoLine = (it: LogItem) => {
    const w = whoOf(it.by);
    const p = place.kind === 'root' && !place.project && it.project && !w.includes(it.project) ? it.project : '';
    return [w, p].filter(Boolean).join(' · ');
  };
  const filedWord = (it: LogItem) => (it.filed.length ? `→ ${it.filed.map((f) => f.split('/').pop()).join(', ')}` : it.act === 'shown' ? tr('보여 줌', 'Shown') : tr('넣음', 'Added'));
  const logItems = (items: LogItem[]) => (
    logDays(items).map((g) => (
      <section key={g.label} className="lk-day">
        <div className="lk-sub">{g.label}</div>
        {view === 'card' ? (
          <div className="lk-grid">{g.items.map((it) => {
            const e = it.path.startsWith(`${dir}/`) ? entries.find((x) => `${dir}/${x.rel}` === it.path) : undefined;
            const who = whoLine(it);
            const c = { path: it.path, name: baseName(it.path), gone: !!e?.gone, ms: Date.parse(it.ts), entry: e, by: it.by };
            return <Card key={it.path} c={c} mark={[who, it.filed.length ? filedWord(it) : ''].filter(Boolean).join(' · ') || null} acts={acts} onMenu={fileMenu(c)} pick={pickOf(it.path)} />;
          })}</div>
        ) : (
          <div className="lk-list">{g.items.map((it) => {
            const e = it.path.startsWith(`${dir}/`) ? entries.find((x) => `${dir}/${x.rel}` === it.path) : undefined;
            return <Row key={it.path} path={it.path} name={baseName(it.path)} ms={Date.parse(it.ts)} timeOnly who={whoLine(it)} what={filedWord(it)} gone={!!e?.gone} onOpen={acts.onOpen}
              onRename={rowRename(e)} onMenu={fileMenu({ path: it.path, name: baseName(it.path), gone: !!e?.gone, entry: e })} pick={pickOf(it.path)} />;
          })}</div>
        )}
      </section>
    ))
  );

  if (place.kind === 'root') {
    const tops = kidsOf(entries, '').filter((e) => e.dir);
    return (
      <div className="lk-page-wrap" tabIndex={-1} data-select-all="" ref={box} data-locker-drop="" onContextMenu={blankMenu} onMouseDown={noShiftSelect} onPointerDown={bandStart}>
        <header className="lk-head">
          <Crumbs dir={dir} rel="" count={items.length} onPlace={onPlace} />
          <IconButton tone="line" label={tr('여기에 새 폴더', 'New folder here')} onClick={() => newFolder('')}><IconFolderPlus /></IconButton>
          {connectBtn}
          <span className="lk-sp" />
          {viewSeg}
          <AddMenu folder="" onNewDoc={onNewDoc} onChoose={onChoose} onConnect={onConnect} />
        </header>
        <Chips active={chips.active} all={chips.all} on={place.project} onAddProject={onAddProject} onPick={(root) => onPlace(root ? { kind: 'root', project: root } : { kind: 'root' })} />
        {cur && (
          <div className="lk-phd">
            <span className={`lk-dot d-${cur.dot}`} aria-hidden="true" /><b>{cur.name}</b>{cur.what && <span>{cur.what}</span>}
            <span className="lk-sp" />
            {cur.session && onBigProject && <IconButton size="s" tone="line" label={tr('크게', 'Open large')} title={tr('크게 — 그 세션을 가운데 탭으로', 'Open large — the session in a tab')} onClick={() => onBigProject(cur.session!)}><IconMaximize /></IconButton>}
          </div>
        )}
        {!place.project && tops.length > 0 && <div className="lk-fgrid">{tops.map((e) => <FolderCard key={e.rel} e={e} dir={dir} count={count(e.rel)} onPlace={onPlace} onRename={acts.onRename} onMenu={folderMenu(e)} fresh={fresh === e.rel} />)}</div>}
        {items.length === 0 ? (
          <div className="cv-blank">{place.project ? tr('이 프로젝트와 주고받은 파일이 아직 없어요', 'Nothing exchanged with this project yet') : tr('아직 주고받은 파일이 없어요 — 파인더에서 끌어놓거나 + 로 골라 넣어요', 'Nothing yet — drop files from Finder or press +')}</div>
        ) : logItems(items)}
        {bandEl}
        {selBar}
        {undoBar || teamBar}
      </div>
    );
  }
  return (
    <div className="lk-page-wrap" tabIndex={-1} data-select-all="" ref={box} data-locker-drop={ro ? undefined : place.rel} onContextMenu={blankMenu} onMouseDown={noShiftSelect} onPointerDown={bandStart}>
      <header className="lk-head">
        <Crumbs dir={dir} rel={place.rel} count={files.length} onPlace={onPlace} ro={roAt} />
        {!ro && <IconButton tone="line" label={tr('여기에 새 폴더', 'New folder here')} onClick={() => newFolder(place.rel)}><IconFolderPlus /></IconButton>}
        {connectBtn}
        {acts.onSendFolder && !entries.find((x) => x.rel === here)?.gone && <SendToOrch to={acts.sendTo} onClick={() => acts.onSendFolder!(abs(here))} />}
        <span className="lk-sp" />
        {(files.length > 1 || dirs.length > 1) && <SortButton keys={LK_SORTS} value={sort} onChange={(x) => { setSort(x); saveLkSort(x); }} />}
        {viewSeg}
        {!ro && <AddMenu folder={place.rel} onNewDoc={onNewDoc} onChoose={onChoose} onConnect={onConnect} />}
      </header>
      {here && entries.find((x) => x.rel === here)?.gone ? (
        <div className="cv-blank">
          {tr('원본 폴더가 없어요 — 옮기거나 지웠다면 다시 연결해요', 'The original folder is gone — relink it if you moved it')}
          {acts.onReconnect && <button className="lk-relink" onClick={() => acts.onReconnect!(here)}>{tr('다시 연결…', 'Relink…')}</button>}
        </div>
      ) : dirs.length === 0 && files.length === 0 ? (
        <div className="cv-blank">{tr('비어 있어요 — 기록에서 끌어 오거나 파인더에서 끌어놓아요', 'Empty — drag from the activity list or from Finder')}</div>
      ) : (
        <>
          {dirs.length > 0 && <div className="lk-fgrid">{dirs.map((e) => <FolderCard key={e.rel} e={e} dir={dir} count={count(e.rel)} onPlace={onPlace} onRename={acts.onRename} onMenu={folderMenu(e)} fresh={fresh === e.rel} pick={pickOf(abs(e.rel))} />)}</div>}
          {files.length > 0 && (view === 'card'
            ? <div className="lk-grid">{files.map((e) => { const c = entryCard(dir, e); return <Card key={e.rel} c={c} mark={markOf(e)} acts={acts} onMenu={fileMenu(c)} pick={pickOf(c.path)} />; })}</div>
            : <div className="lk-list">{files.map((e) => <Row key={e.rel} path={`${dir}/${e.rel}`} name={e.name} ms={e.mtime ?? undefined} who={markOf(e) ?? ''} gone={e.gone} onOpen={acts.onOpen} onRename={rowRename(e)} onMenu={fileMenu(entryCard(dir, e))} pick={pickOf(abs(e.rel))} />)}</div>)}
        </>
      )}
      {bandEl}
      {selBar}
      {undoBar || teamBar}
    </div>
  );
}
