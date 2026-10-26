// 스페이스 팀 탭 — 고른 팀의 보관함(chammo-relay ADR 0009, 시안 docs/design-drafts/team-locker v1 A+B+C 섞기 10-26 사용자).
// 파일은 이 기기에서 암호화해 중계(R2)에 올라가고 팀원 앱에 바로 뜬다(방 소켓 {t:locker} → team_locker_poll 의 changed).
// 기본은 목록(A), 머리 아이콘으로 카드(B, 그림 썸네일) — 고른 보기·정렬은 기억. 파일을 누르면 스페이스에서 바로 연다(scripts/show 길, 10-26 사용자 292.png —
// 오른쪽 미리보기 칸 C 는 뺐다). 못 그리는 형식·'다른 앱으로 열기'만 맥 기본 앱. 연 파일·썸네일은 데이터 폴더(team-locker-peek)에 풀고 오래되면 Rust 가 지운다,
// '이 기기에 저장'만 팀 폴더 ~/Documents/Chammo/<팀>. 폴더 = 칩(만들기·이름 바꾸기·지우기·파일 끌어 놓기), 빈 폴더는 봉한 표시 줄(dir)로 남는다.
// 손맛은 참모 보관함(LockerPage)과 같게(10-26 사용자 "보관함이랑 성격이 다르네") — 고르기는 같은 훅(usePick), 끌기는 같은 포인터 길(dragPath),
// 오른쪽 클릭은 뒤따르는 click 을 삼킨다. 바꾸기는 누르면 바로 화면에(기다리는 일 domain/teamLockerPending), 실패하면 되돌리고 알린다(10-26 사용자 298.png)
import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { CHAT, chips, extOf, TEAM_LOCKER_DROP, TEAM_LOCKER_MOVE, TEAM_LOCKER_OUT, fmtBytes, inPlace, readSort, sortItems, SORTS, usageText, whenText, type LockerItem, type LockerSort, type LockerUpload, type LockerView } from '../../domain/teamLocker';
import { failText, opKey, withPending, type LockerOp } from '../../domain/teamLockerPending';
import { opensOnClick } from '../../domain/ctxMenu';
import { docUrl, kindOf } from '../../domain/reader';
import { tr } from '../../i18n';
import { IconClose, IconDashboard, IconFolderMove, IconFolderPlus, IconLink, IconList, IconPlus, IconTrash } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { Confirm, ContextMenu, type MenuItem } from '../OrchDialogs';
import { swallowTrailingClick } from '../orchActions';
import { attachToChat } from '../fileDrop';
import { dragTeam } from '../space/dragPath';
import { usePick } from '../space/usePick';
import { TeamMarkIcon } from './TeamFaces';
import { openTeamFile } from './openTeamFile';
import { SortButton } from '../SortButton';
import '../space/locker.css';
import './team.css';

/** 이 기기 팀 폴더 주인 id — 폰 팀 보관함(PhoneTeam)이 같은 id 로 고른다 */
export const teamOwner = (teamId: string, team: string) => ({ id: `team-${teamId}`, name: team });


const VIEW_KEY = 'teamLocker.view.v1';
const readView = (): 'list' | 'cards' => { try { return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'list'; } catch { return 'list'; } };
const saveView = (v: string) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* 저장 못 해도 이번엔 그대로 */ } };
const SORT_KEY = 'teamLocker.sort.v1';
const saveSort = (v: LockerSort) => { try { localStorage.setItem(SORT_KEY, JSON.stringify(v)); } catch { /* 저장 못 해도 이번엔 그대로 */ } };
/** 카드 썸네일 — 5MB 넘는 그림은 글자 표 */
const thumbable = (i: LockerItem) => !i.why && i.size <= 5 * 1024 * 1024 && kindOf(i.name) === 'image';
/** 네모 끌기를 시작하지 않는 자리 — 줄·카드·단추·입력칸·머리·칩·고른 것 줄 */
const NO_BAND = '[data-pick], button, input, textarea, a, [role=menu], .lk-selbar, .tmx-lk-h, .tlk-chips';

function usePeek(team: string, item: LockerItem | null, on: boolean) {
  const [path, setPath] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setPath(null);
    setErr('');
    if (!item || !on) return;
    let live = true;
    invoke<string>('team_locker_peek', { team, id: item.id }).then((p) => live && setPath(p), (e: unknown) => live && setErr(String(e)));
    return () => { live = false; };
  }, [team, item?.id, item?.at, on]); // eslint-disable-line react-hooks/exhaustive-deps
  return { path, err };
}

function Thumb({ team, item }: { team: string; item: LockerItem }) {
  const { path } = usePeek(team, item, thumbable(item));
  if (path) return <span className="tlk-thumb"><img src={docUrl(path)} alt="" draggable={false} /></span>;
  return <span className="tlk-thumb"><span className="tmx-ext">{extOf(item.name) || tr('파일', 'file')}</span></span>;
}

export function TeamLocker({ teamId, team, people, follow, onFollow, onOpen, tail, icon }: {
  teamId: string;
  team: string;
  people: number;
  follow: boolean;
  onFollow: (on: boolean) => void;
  /** 받은 파일을 파인더에서 보이기('이 기기에 저장') */
  onOpen: (path: string, dir: boolean) => void;
  /** 머리 오른쪽 끝 자리 — 주면 '메신저 팀 따라가기' 링크 단추 대신 이것(팀 설정 조절 막대, team-settings) */
  tail?: ReactNode;
  /** 팀 아이콘 그림(data URL) — 없으면 첫 글자 */
  icon?: string;
}) {
  const [v, setV] = useState<LockerView | null>(null);
  const [err, setErr] = useState('');
  const [ups, setUps] = useState<LockerUpload[]>([]);
  const [place, setPlace] = useState('');
  const [trash, setTrash] = useState(false);
  const [mode, setMode] = useState<'list' | 'cards'>(readView);
  const [sort, setSort] = useState<LockerSort>(() => readSort(() => localStorage.getItem(SORT_KEY)));
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  /** 폴더 칩 입력 — 새 폴더(from 빈 글) 또는 이름 바꾸기 */
  const [folderIn, setFolderIn] = useState<{ from: string; value: string } | null>(null);
  const [rmFolder, setRmFolder] = useState<{ key: string; n: number } | null>(null);
  const [naming, setNaming] = useState<{ id: string; what: 'name' | 'folder'; value: string } | null>(null);
  const [purge, setPurge] = useState<LockerItem | null>(null);
  const [note, setNote] = useState('');
  /** 누른 뒤 풀어 여는 중인 파일 id — 그 줄에 '여는 중'(10-26 사용자 "누르면 바로 안 열린다") */
  const [opening, setOpening] = useState<Set<string>>(() => new Set());
  /** 보낸 뒤 서버 답을 기다리는 바꾸기 — 화면엔 이미 반영(withPending), 열쇠가 같은 건 또 안 보낸다 */
  const [pend, setPend] = useState<{ key: string; op: LockerOp }[]>([]);
  const pendRef = useRef(pend);
  pendRef.current = pend;
  /** 방금 휴지통으로 보낸 것 — 되돌리기 줄 */
  const [undone, setUndone] = useState<string[] | null>(null);
  const upCount = useRef(0);

  const [busyList, setBusyList] = useState(false);
  const cur = useRef(teamId);
  cur.current = teamId;
  /** 받는 중 — 2초 폴링이 받는 중에 또 부르지 않게(목록이 2초 넘게 걸리면 겹쳐 불렀다, 10-26 사고) */
  const listing = useRef(false);
  const load = useCallback(async () => {
    setBusyList(true);
    listing.current = true;
    try {
      const fresh = await invoke<LockerView>('team_locker_list', { team: teamId });
      if (cur.current === teamId) { setV(fresh); setErr(''); }
    } catch (e) { if (cur.current === teamId) setErr(String(e)); } finally { setBusyList(false); listing.current = false; }
  }, [teamId]);

  // 열자마자 — 기기에 봉해 둔 마지막 목록을 먼저(망 없이), 그다음 새로 받은 걸로 갈아 끼운다(10-26 사용자 296.png "그냥 떠 있어야")
  useEffect(() => {
    setV(null); setPlace(''); setTrash(false); setPend([]); setUndone(null);
    void invoke<LockerView | null>('team_locker_cached', { team: teamId }).then((c) => { if (c && cur.current === teamId) setV((x) => x ?? c); }, () => {});
    void load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2초마다 — 올리는 중 줄과 '새 판 알림'(방 소켓). 올리기가 끝났거나 새 판이면 목록을 다시
  useEffect(() => {
    const t = window.setInterval(() => {
      void invoke<{ uploads: LockerUpload[]; changed: boolean }>('team_locker_poll', { team: teamId }).then((p) => {
        setUps(p.uploads);
        const going = p.uploads.filter((u) => !u.error).length;
        if ((p.changed || going < upCount.current) && !listing.current) void load();
        upCount.current = going;
      }, () => {});
    }, 2000);
    return () => window.clearInterval(t);
  }, [teamId, load]);

  /** 바꾸기 하나 — 누르자마자 화면에 얹고(기다리는 일), 같은 열쇠가 기다리는 중이면 안 보낸다(연타 한 번만).
   *  서버가 받으면 새 목록을 받은 뒤 뗀다(그사이 옛 목록으로 깜빡이지 않게), 실패하면 바로 떼서 되돌리고 무엇이 안 됐는지 알린다 */
  const run = (op: LockerOp, call: () => Promise<unknown>): boolean => {
    const key = opKey(op);
    if (pendRef.current.some((p) => p.key === key)) return false;
    const mine = { key, op };
    pendRef.current = [...pendRef.current, mine];
    setPend(pendRef.current);
    const drop = () => setPend((x) => x.filter((p) => p !== mine));
    void call().then(() => load().finally(drop), (e: unknown) => { drop(); setNote(failText(op, String(e))); });
    return true;
  };

  const folder = !trash && place && place !== CHAT ? place : null;
  const put = useCallback((paths: string[]) => {
    if (!paths.length) return;
    void invoke('team_locker_put', { team: teamId, paths, folder }).then(() => invoke<{ uploads: LockerUpload[] }>('team_locker_poll', { team: teamId }).then((p) => { setUps(p.uploads); upCount.current = p.uploads.length; }), (e: unknown) => setNote(String(e)));
  }, [teamId, folder]);

  // 파인더에서 끌어 넣기(fileDrop → 이 사건)
  useEffect(() => {
    const f = (e: Event) => {
      const d = (e as CustomEvent<{ paths: string[]; team: string }>).detail;
      if (d?.team === teamId) put(d.paths);
    };
    window.addEventListener(TEAM_LOCKER_DROP, f);
    return () => window.removeEventListener(TEAM_LOCKER_DROP, f);
  }, [teamId, put]);

  const shown = useMemo(() => (v ? withPending(v.items, pend.map((p) => p.op)) : null), [v, pend]);
  const busy = shown?.busy ?? new Set<string>();
  const busyFolders = shown?.busyFolders ?? new Set<string>();
  const items = useMemo(() => (shown ? sortItems(inPlace(shown.items, place, trash), sort) : []), [shown, place, trash, sort]);
  const folders = useMemo(() => (shown ? chips(shown.items) : [{ key: '', n: 0 }]), [shown]);
  const use = v ? usageText(v.usage) : null;
  // 고른 폴더가 사라지면(만들기 실패로 되돌아감·팀원이 지움) 전체로 — 빈 칸에 갇히지 않게
  useEffect(() => { if (shown && place && !folders.some((f) => f.key === place)) setPlace(''); }, [shown, folders, place]);

  // 고르기 — 참모 보관함과 같은 훅. 못 여는 줄(잠긴 파일)은 고르지 않는다
  const box = useRef<HTMLDivElement>(null);
  const order = useMemo(() => items.filter((i) => !i.why).map((i) => i.id), [items]);
  const pick = usePick({ box, order, reset: `${teamId}|${place}|${trash}`, skip: NO_BAND });
  const picked = items.filter((i) => pick.picked(i.id));
  const byId = (id: string) => shown?.items.find((x) => x.id === id);

  const act = (fn: () => Promise<unknown>) => void fn().then(() => load(), (e: unknown) => setNote(String(e)));
  /** 누르면 스페이스에서 연다 — app = '다른 앱으로 열기'(맥 기본 앱) */
  const open = (i: LockerItem, app = false) => {
    if (i.why || trash || opening.has(i.id)) return;
    setOpening((x) => new Set(x).add(i.id));
    void openTeamFile((external) => invoke<string>('team_locker_open', { team: teamId, id: i.id, external }), i.name, app)
      .catch((e: unknown) => setNote(String(e)))
      .finally(() => setOpening((x) => { const n = new Set(x); n.delete(i.id); return n; }));
  };
  /** 줄·카드 누름 — 왼쪽 단추만 열기(오른쪽·ctrl+클릭은 메뉴 몫), ⌘·⇧는 고르기 */
  const click = (e: MouseEvent, i: LockerItem) => {
    if (!opensOnClick(e) || pick.press(e, i.id)) return;
    open(i);
  };
  const save = (i: LockerItem) => act(async () => onOpen(await invoke<string>('team_locker_save', { team: teamId, id: i.id }), true));
  const rename = (id: string, args: { name?: string; folder?: string }) => run({ k: 'meta', id, ...args }, () => invoke('team_locker_rename', { team: teamId, id, ...args }));
  const verb = (id: string, what: 'trash' | 'restore' | 'purge') => run({ k: 'act', id, verb: what }, () => invoke('team_locker_act', { team: teamId, id, verb: what }));
  /** 옮기기 — 대화 파일·이미 거기 있는 건 빼고 하나씩 */
  const moveTo = (ids: string[], to: string) => { for (const id of ids) { const it = byId(id); if (it && !it.room && it.folder !== to) rename(id, { folder: to }); } };
  const trashMany = (ids: string[]) => { const went = ids.filter((id) => verb(id, 'trash')); if (went.length) setUndone(went); pick.end(); };

  // 끌어 놓기 — 폴더 칩(옮기기)·채팅 칸(풀어서 그 채팅에 붙이기). 끄는 길은 참모 보관함과 같은 dragPath
  useEffect(() => {
    const mv = (e: Event) => { const d = (e as CustomEvent<{ team: string; ids: string[]; folder: string }>).detail; if (d?.team === teamId && d.folder !== CHAT) moveTo(d.ids, d.folder); };
    const out = (e: Event) => {
      const d = (e as CustomEvent<{ team: string; ids: string[]; chat: string }>).detail;
      if (d?.team !== teamId) return;
      void Promise.all(d.ids.map((id) => invoke<string>('team_locker_open', { team: teamId, id, external: false })))
        .then((paths) => attachToChat(d.chat, paths), (e2: unknown) => setNote(tr(`채팅에 못 붙였어요 — ${String(e2)}`, `Couldn't attach to the chat — ${String(e2)}`)));
    };
    window.addEventListener(TEAM_LOCKER_MOVE, mv);
    window.addEventListener(TEAM_LOCKER_OUT, out);
    return () => { window.removeEventListener(TEAM_LOCKER_MOVE, mv); window.removeEventListener(TEAM_LOCKER_OUT, out); };
  });
  /** 끌기 — 고른 묶음 안의 것을 끌면 묶음째(화면 순서), 밖이면 그 하나. 휴지통·잠긴 파일은 안 끈다 */
  const dragOf = (i: LockerItem) => {
    if (trash || i.why) return {};
    const ids = pick.many(i.id) ? order.filter((k) => pick.picked(k)) : [i.id];
    return dragTeam(teamId, ids, ids.length > 1 ? tr(`${ids.length}개`, `${ids.length} items`) : i.name);
  };

  // 키보드 — Esc 풀기 · Backspace·Delete·⌘⌫ 고른 것 휴지통(되돌리기 줄) · Enter 하나 고른 것 열기. 보관함 칸 안 포커스·입력칸 밖일 때만
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    const t = e.target as HTMLElement | null;
    if (!t || !box.current?.contains(t) || t.closest('input, textarea, [contenteditable="true"]') || e.isComposing || menu || purge || rmFolder) return;
    if (e.key === 'Escape' && pick.sel.keys.length) { e.preventDefault(); pick.end(); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && picked.length && !trash) { e.preventDefault(); trashMany(picked.map((i) => i.id)); return; }
    if (e.key === 'Enter' && picked.length === 1) { e.preventDefault(); open(picked[0]!); }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const moveItems = (ids: string[]) => [
    { label: tr('맨 위로', 'Top level'), run: () => moveTo(ids, '') },
    ...folders.filter((f) => f.key && f.key !== CHAT).map((f) => ({ label: f.key, run: () => moveTo(ids, f.key) })),
  ];
  const menuFor = (i: LockerItem): MenuItem[] => trash
    ? [
      { label: tr('되살리기', 'Restore'), run: () => verb(i.id, 'restore') },
      { label: tr('영구 지우기…', 'Delete forever…'), danger: true, sep: true, run: () => setPurge(i) },
    ]
    : [
      ...(i.why ? [] : [
        { label: tr('열기', 'Open'), run: () => open(i) },
        { label: tr('다른 앱으로 열기', 'Open with default app'), run: () => open(i, true) },
        { label: tr('이 기기에 저장', 'Save to this Mac'), run: () => save(i) },
        { label: tr('이름 바꾸기', 'Rename'), sep: true, run: () => setNaming({ id: i.id, what: 'name', value: i.name }) },
        ...(i.room ? [] : [{
          label: tr('폴더로 옮기기', 'Move to folder'),
          sub: () => [
            ...(i.folder ? [{ label: tr('맨 위로', 'Top level'), run: () => rename(i.id, { folder: '' }) }] : []),
            ...folders.filter((f) => f.key && f.key !== CHAT && f.key !== i.folder).map((f) => ({ label: f.key, run: () => rename(i.id, { folder: f.key }) })),
            { label: tr('새 폴더…', 'New folder…'), sep: true, run: () => setNaming({ id: i.id, what: 'folder' as const, value: '' }) },
          ],
        }]),
      ]),
      { label: tr('휴지통으로', 'Move to trash'), sep: true, danger: true, run: () => verb(i.id, 'trash') },
    ];
  /** 여럿 고른 채 — 옮기기·휴지통(휴지통 안이면 되살리기) */
  const batchItems = (): MenuItem[] => {
    const ids = picked.map((i) => i.id);
    const n = ids.length;
    if (trash) return [{ label: tr(`${n}개 되살리기`, `Restore ${n}`), run: () => { ids.forEach((id) => verb(id, 'restore')); pick.end(); } }];
    const movable = picked.filter((i) => !i.room).map((i) => i.id);
    return [
      ...(movable.length ? [{ label: tr(`${movable.length}개 폴더로 옮기기`, `Move ${movable.length} to folder`), sub: () => moveItems(movable).map((m) => ({ ...m, run: () => { m.run(); pick.end(); } })) }] : []),
      { label: tr(`${n}개 휴지통으로`, `Move ${n} to trash`), sep: true, danger: true, run: () => trashMany(ids) },
    ];
  };

  /** 오른쪽 클릭 — 맥 웹뷰가 뒤에 보내는 click 은 삼킨다(그게 줄을 열어 메뉴를 못 썼다). 고른 묶음 안이면 묶음 메뉴, 밖이면 그 하나를 고르고 */
  const onMenu = (e: MouseEvent, i: LockerItem) => {
    e.preventDefault();
    e.stopPropagation();
    swallowTrailingClick();
    if (pick.many(i.id)) { setMenu({ x: e.clientX, y: e.clientY, items: batchItems() }); return; }
    if (!i.why) pick.right(i.id);
    setMenu({ x: e.clientX, y: e.clientY, items: menuFor(i) });
  };
  /** 빈 곳 — 새 폴더·파일 넣기(휴지통 안은 없음). 이름 칸 위에선 맥 기본 메뉴(붙여넣기) */
  const blankMenu = (e: MouseEvent) => {
    if (trash || (e.target as HTMLElement).closest('input, textarea, [data-pick], .tlk-chip')) return;
    e.preventDefault();
    swallowTrailingClick();
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: tr('새 폴더', 'New folder'), run: () => setFolderIn({ from: '', value: '' }) },
      { label: tr('파일 넣기', 'Add files'), run: () => void invoke('team_locker_pick', { team: teamId, folder }).catch((x: unknown) => setNote(String(x))) },
    ] });
  };

  // 폴더 — 만들기는 봉한 표시 줄, 이름 바꾸기·지우기는 그 폴더 파일 meta 를 고치거나 휴지통으로(Rust team_locker_folder). 누르면 바로 화면에
  const removeFolder = (key: string) => { if (place === key) setPlace(''); run({ k: 'folder', from: key, to: null }, () => invoke('team_locker_folder', { team: teamId, from: key, to: null })); };
  const folderDone = () => {
    const f = folderIn;
    setFolderIn(null);
    const name = f?.value.trim() ?? '';
    if (!f || !name || name === f.from) return;
    const sent = f.from
      ? run({ k: 'folder', from: f.from, to: name }, () => invoke('team_locker_folder', { team: teamId, from: f.from, to: name }))
      : folders.some((x) => x.key === name) || run({ k: 'mkdir', folder: name }, () => invoke('team_locker_mkdir', { team: teamId, folder: name }));
    if (sent) setPlace(name);
  };
  const chipMenu = (e: MouseEvent, f: { key: string; n: number }) => {
    if (!f.key || f.key === CHAT) return;
    e.preventDefault();
    swallowTrailingClick();
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: tr('폴더 이름 바꾸기', 'Rename folder'), run: () => setFolderIn({ from: f.key, value: f.key }) },
      { label: f.n ? tr('폴더 지우기…', 'Delete folder…') : tr('폴더 지우기', 'Delete folder'), danger: true, sep: true, run: () => (f.n ? setRmFolder(f) : removeFolder(f.key)) },
    ] });
  };

  const nameBox = (i: LockerItem) => naming?.id === i.id && (
    <input className="tlk-name" autoFocus value={naming.value} placeholder={naming.what === 'folder' ? tr('새 폴더 이름', 'New folder name') : ''}
      onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onChange={(e) => setNaming({ ...naming, value: e.target.value })}
      onBlur={() => setNaming(null)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); setNaming(null); }
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && naming.value.trim()) { rename(i.id, naming.what === 'name' ? { name: naming.value.trim() } : { folder: naming.value.trim() }); setNaming(null); }
      }} />
  );
  const meta = (i: LockerItem) => (i.why ? tr('이 기기에선 아직 못 열어요', 'Not openable on this Mac yet') : [i.by, whenText(i.at), fmtBytes(i.size)].filter(Boolean).join(' · '));
  /** 그 줄 끝 글 — 여는 중 · 반영 중(보낸 바꾸기) · 평소 */
  const state = (i: LockerItem, normal: ReactNode) => (opening.has(i.id) ? tr('여는 중', 'Opening') : busy.has(i.id) ? tr('반영 중', 'Saving') : normal);
  // 올리는 중 줄 — 팀 보관함 올리기만(대화 파일 붙이기는 채팅 칸이 그린다), 휴지통·대화 파일 칩에선 안 보인다
  const myUps = trash || place === CHAT ? [] : ups.filter((u) => !u.room);
  const n = picked.length;
  const rowCls = (i: LockerItem, base: string) => [base, i.why ? 'tlk-locked' : '', opening.has(i.id) ? 'tlk-opening' : '', busy.has(i.id) ? 'tlk-pending' : '', pick.picked(i.id) ? 'picked' : ''].filter(Boolean).join(' ');

  return (
    <div className="tmx-locker tlk" data-team-locker={teamId}>
      <div className="tlk-main" ref={box} tabIndex={-1} data-select-all="" onPointerDown={pick.bandStart} onMouseDown={pick.noShiftSelect} onContextMenu={blankMenu}>
        <div className="tmx-lk-h">
          <TeamMarkIcon name={team} size={34} img={icon} />
          <span className="tmx-head-tx"><b>{team}</b><span>{trash ? tr('휴지통 · 30일 뒤 지워져요', 'Trash · cleared after 30 days') : tr(`팀 보관함 · 사람 ${people}`, `Team locker · ${people} people`)}
            {pend.length > 0 ? <i className="tlk-sync" role="status">{tr('보내는 중', 'Saving')}</i> : busyList && v?.cached && <i className="tlk-sync" role="status">{tr('새로 받는 중', 'Updating')}</i>}</span></span>
          {use && (
            <span className="tlk-use" title={tr(`팀 보관함 ${fmtBytes(v!.usage.used)} 사용 · 한도 ${fmtBytes(v!.usage.limit)}(좌석 ${v!.usage.seats} × 10GB)`, `${fmtBytes(v!.usage.used)} used of ${fmtBytes(v!.usage.limit)} (${v!.usage.seats} seats × 10GB)`)}>
              <span className="tlk-bar"><i style={{ width: `${Math.max(use.ratio * 100, use.ratio > 0 ? 3 : 0)}%` }} /></span>{use.text}
            </span>
          )}
          <SortButton keys={SORTS} value={sort} onChange={(x) => { setSort(x); saveSort(x); }} />
          <IconButton tone="line" pressed={mode === 'cards'} label={mode === 'cards' ? tr('목록으로 보기', 'List view') : tr('카드로 보기', 'Card view')}
            onClick={() => { const m = mode === 'cards' ? 'list' : 'cards'; setMode(m); saveView(m); }}>{mode === 'cards' ? <IconList /> : <IconDashboard />}</IconButton>
          {!trash && <IconButton tone="line" label={tr('새 폴더', 'New folder')} onClick={() => setFolderIn({ from: '', value: '' })}><IconFolderPlus /></IconButton>}
          {!trash && <IconButton tone="line" label={tr('파일 넣기', 'Add files')} onClick={() => void invoke('team_locker_pick', { team: teamId, folder }).catch((e: unknown) => setNote(String(e)))}><IconPlus /></IconButton>}
          <IconButton tone="line" pressed={trash} label={trash ? tr('휴지통 닫기', 'Close trash') : tr('휴지통', 'Trash')} onClick={() => setTrash(!trash)}><IconTrash /></IconButton>
          {tail ?? <IconButton tone="line" pressed={follow} label={follow ? tr('메신저 팀 따라가기 — 켜짐', 'Follow messenger team — on') : tr('메신저 팀 따라가기 — 꺼짐', 'Follow messenger team — off')} onClick={() => onFollow(!follow)}><IconLink /></IconButton>}
        </div>

        {!trash && (folders.length > 1 || folderIn) && (
          <div className="tlk-chips">
            {folders.map((f) => (folderIn && folderIn.from && folderIn.from === f.key ? (
              <input key={f.key} className="tlk-chip-in" autoFocus value={folderIn.value} aria-label={tr('폴더 이름', 'Folder name')} onChange={(e) => setFolderIn({ ...folderIn, value: e.target.value })} onBlur={folderDone}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setFolderIn(null); } if (e.key === 'Enter' && !e.nativeEvent.isComposing) folderDone(); }} />
            ) : (
              // 끌어 놓는 자리 — dragPath 가 [data-team-folder] 를 빛내고 놓으면 옮기기 신호(대화 파일 칩은 자리가 아니다)
              <button key={f.key || '*'} className={`tlk-chip ${place === f.key ? 'on' : ''} ${busyFolders.has(f.key) ? 'tlk-pending' : ''}`} aria-pressed={place === f.key} aria-busy={busyFolders.has(f.key) || undefined}
                title={busyFolders.has(f.key) ? tr('반영 중', 'Saving') : undefined} {...(f.key === CHAT ? {} : { 'data-team-folder': f.key })}
                onClick={() => setPlace(f.key)} onContextMenu={(e) => chipMenu(e, f)}>
                {f.key || tr('전체', 'All')}<span>{f.n}</span>
              </button>
            )))}
            {folderIn && !folderIn.from && (
              <input className="tlk-chip-in" autoFocus value={folderIn.value} placeholder={tr('새 폴더 이름', 'New folder name')} aria-label={tr('새 폴더 이름', 'New folder name')} onChange={(e) => setFolderIn({ ...folderIn, value: e.target.value })} onBlur={folderDone}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setFolderIn(null); } if (e.key === 'Enter' && !e.nativeEvent.isComposing) folderDone(); }} />
            )}
          </div>
        )}

        {err && <div className="tmx-none">{err}</div>}
        {note && <div className="tmx-hint tlk-note" role="alert" onClick={() => setNote('')}>{note}</div>}
        {!!v?.skipped.length && !trash && <div className="tmx-hint">{tr(`${v.skipped.join(', ')} — 보안 번호 확인 전이라 새 파일을 아직 못 받아요`, `${v.skipped.join(', ')} can't receive new files until their security number is confirmed`)}</div>}

        {(items.length > 0 || myUps.length > 0) ? (
          mode === 'list' ? (
            <div className="tmx-lk-rows">
              {myUps.map((u) => (
                <div key={u.local} className="tmx-lk-row tlk-up">
                  <span className="tmx-ext">{extOf(u.name) || tr('파일', 'file')}</span><b>{u.name}</b>
                  {u.error ? <span className="d tlk-err" title={u.error}>{u.error}</span> : <><span className="tlk-prog"><i style={{ width: `${u.total ? (u.done / u.total) * 100 : 0}%` }} /></span><span className="d">{fmtBytes(u.total)}</span></>}
                  {u.error && <IconButton size="s" label={tr('닫기', 'Dismiss')} onClick={() => void invoke('team_locker_dismiss', { local: u.local }).then(() => setUps((x) => x.filter((y) => y.local !== u.local)))}><IconClose /></IconButton>}
                </div>
              ))}
              {items.map((i) => (
                <button key={i.id} data-pick={i.why ? undefined : i.id} className={rowCls(i, 'tmx-lk-row')} onClick={(e) => click(e, i)} onContextMenu={(e) => onMenu(e, i)} title={i.name} aria-busy={opening.has(i.id) || busy.has(i.id)} {...dragOf(i)}>
                  <span className="tmx-ext">{extOf(i.name) || tr('파일', 'file')}</span>
                  {nameBox(i) || <b>{i.name || tr('잠긴 파일', 'Locked file')}</b>}
                  <span className="d">{state(i, <>{place === '' && i.room ? `${CHAT} · ` : ''}{meta(i)}</>)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="tlk-grid">
              {myUps.map((u) => (
                <div key={u.local} className="tlk-card tlk-up"><span className="tlk-thumb"><span className="tlk-prog"><i style={{ width: `${u.total ? (u.done / u.total) * 100 : 0}%` }} /></span></span><span className="tlk-cap"><b>{u.name}</b><span>{u.error || fmtBytes(u.total)}</span></span></div>
              ))}
              {items.map((i) => (
                <button key={i.id} data-pick={i.why ? undefined : i.id} className={rowCls(i, 'tlk-card')} onClick={(e) => click(e, i)} onContextMenu={(e) => onMenu(e, i)} title={i.name} aria-busy={opening.has(i.id) || busy.has(i.id)} {...dragOf(i)}>
                  <Thumb team={teamId} item={i} />
                  <span className="tlk-cap">{nameBox(i) || <b>{i.name || tr('잠긴 파일', 'Locked file')}</b>}<span>{state(i, i.why ? tr('아직 못 열어요', 'Locked') : `${i.by} · ${fmtBytes(i.size)}`)}</span></span>
                </button>
              ))}
            </div>
          )
        ) : !v && !err ? (
          <div className="tmx-lk-rows tlk-skel" role="status" aria-label={tr('팀 보관함 여는 중', 'Opening the team locker')}>{[0, 1, 2, 3, 4].map((k) => <div key={k} className="tmx-lk-row"><i /><i /><i /></div>)}</div>
        ) : v && !err && (
          <div className="tmx-none">{trash ? tr('휴지통이 비었어요', 'Trash is empty') : tr('팀 보관함이 비었어요 — 파인더에서 이 칸으로 끌어 넣으면 팀 모두에게 올라가요', 'The team locker is empty — drag files here from Finder to share with the team')}</div>
        )}
        {pick.band && <div className="lk-band" style={pick.band} aria-hidden="true" />}
        {n > 0 ? (
          <div className="lk-selbar" role="toolbar" aria-label={tr('고른 것', 'Selection')}>
            <b className="lk-selcount">{tr(`${n}개 고름`, `${n} selected`)}</b>
            <span className="lk-sp" />
            {trash ? <button className="btn" onClick={() => { picked.forEach((i) => verb(i.id, 'restore')); pick.end(); }}>{tr('되살리기', 'Restore')}</button> : <>
              {picked.some((i) => !i.room) && <IconButton label={tr('폴더로 옮기기', 'Move to folder')} onClick={(x) => { const r = x.currentTarget.getBoundingClientRect(); const ids = picked.filter((i) => !i.room).map((i) => i.id); setMenu({ x: r.left, y: r.top - 8, items: moveItems(ids).map((m) => ({ ...m, run: () => { m.run(); pick.end(); } })) }); }}><IconFolderMove /></IconButton>}
              <IconButton label={tr('휴지통으로', 'Move to trash')} onClick={() => trashMany(picked.map((i) => i.id))}><IconTrash /></IconButton>
            </>}
            <IconButton label={tr('고른 것 풀기', 'Clear selection')} title={tr('고른 것 풀기 (Esc)', 'Clear selection (Esc)')} onClick={pick.end}><IconClose /></IconButton>
          </div>
        ) : undone && !trash && (
          // 휴지통 직후 — 되돌리기(팀 휴지통에서 되살리기). 30일 안엔 휴지통에서도 된다
          <div className="lk-selbar lk-undo" role="status">
            <span className="lk-ask"><b>{tr(`${undone.length}개를 휴지통으로 옮겼어요`, `Moved ${undone.length} to the trash`)}</b></span>
            <span className="lk-sp" />
            <button className="btn" onClick={() => { undone.forEach((id) => verb(id, 'restore')); setUndone(null); }}>{tr('되돌리기', 'Undo')}</button>
            <IconButton label={tr('닫기', 'Close')} onClick={() => setUndone(null)}><IconClose /></IconButton>
          </div>
        )}
        <div className="tlk-drop" aria-hidden>{tr('여기 놓으면 팀 모두에게 올라가요', 'Drop to share with the team')}</div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {rmFolder && (
        <Confirm danger title={tr('폴더 지우기', 'Delete folder')} body={tr(`'${rmFolder.key}' 안 파일 ${rmFolder.n}개를 휴지통으로 옮기고 폴더를 지워요. 30일 안에 휴지통에서 되살릴 수 있어요.`, `Moves ${rmFolder.n} file(s) in '${rmFolder.key}' to the trash and removes the folder. You can restore them from the trash within 30 days.`)}
          ok={tr('휴지통으로 옮기기', 'Move to trash')} onCancel={() => setRmFolder(null)}
          onOk={() => { const f = rmFolder; setRmFolder(null); removeFolder(f.key); }} />
      )}
      {purge && (
        <Confirm danger title={tr('영구 지우기', 'Delete forever')} body={tr(`'${purge.name || '잠긴 파일'}' 을(를) 팀 모두에게서 지워요. 되돌릴 수 없어요.`, `Deletes '${purge.name || 'locked file'}' for the whole team. This can't be undone.`)}
          ok={tr('영구 지우기', 'Delete forever')} onCancel={() => setPurge(null)}
          onOk={() => { const p = purge; setPurge(null); verb(p.id, 'purge'); }} />
      )}
    </div>
  );
}
