// 스페이스 팀 탭 — 고른 팀의 보관함(chammo-relay ADR 0009, 시안 docs/design-drafts/team-locker v1 A+B+C 섞기 10-26 사용자).
// 파일은 이 기기에서 암호화해 중계(R2)에 올라가고 팀원 앱에 바로 뜬다(방 소켓 {t:locker} → team_locker_poll 의 changed).
// 기본은 목록(A), 머리 아이콘으로 카드(B, 그림 썸네일) — 고른 보기·정렬은 기억. 파일을 누르면 스페이스에서 바로 연다(scripts/show 길, 10-26 사용자 292.png —
// 오른쪽 미리보기 칸 C 는 뺐다). 못 그리는 형식·'다른 앱으로 열기'만 맥 기본 앱. 연 파일·썸네일은 데이터 폴더(team-locker-peek)에 풀고 오래되면 Rust 가 지운다,
// '이 기기에 저장'만 팀 폴더 ~/Documents/Chammo/<팀>. 폴더는 참모 보관함과 같은 조각(FolderTile·PathCrumbs) — 폴더 안 폴더(경로 'a/b'), 누르면 들어가고 경로 줄·뒤로,
// 끌어서 폴더(타일·경로 칸)로 옮긴다(10-28 사용자 "진짜 파인더처럼"). 빈 폴더는 봉한 표시 줄(dir)로 남는다.
// 손맛은 참모 보관함(LockerPage)과 같게(10-26 사용자 "보관함이랑 성격이 다르네") — 고르기는 같은 훅(usePick), 끌기는 같은 포인터 길(dragPath),
// 오른쪽 클릭은 뒤따르는 click 을 삼킨다. 바꾸기는 누르면 바로 화면에(기다리는 일 domain/teamLockerPending), 실패하면 되돌리고 알린다(10-26 사용자 298.png).
// room 을 주면 '대화 파일 보기' — 그 DM·팀챗에 붙인 파일만(팀 보관함엔 안 섞는다, 10-28 사용자 "디엠은 그 사용자랑만"). 폴더 칩은 놓으면 복사하는 자리로만
import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { allFolders, folderFiles, crumbsOf, dirId, dirOfId, kidFolders, moveTargets, parentOf, renamedPath, dropPlan, lockerUps, extOf, thumbKind, TEAM_LOCKER_DROP, TEAM_LOCKER_MOVE, TEAM_LOCKER_OUT, fmtBytes, inPlace, inRoom, readSort, sortItems, SORTS, usageText, whenText, type LockerItem, type LockerSort, type LockerUpload, type LockerView } from '../../domain/teamLocker';
import { failText, opKey, withPending, type LockerOp } from '../../domain/teamLockerPending';
import { needFetch, placeMemo, teamViewMemo } from '../../domain/teamViewMemo';
import { opensOnClick } from '../../domain/ctxMenu';
import { tr } from '../../i18n';
import { IconChatSend, IconClose, IconDashboard, IconFolderMove, IconFolderPlus, IconLink, IconList, IconPlus, IconTrash } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { BetaTag } from '../kit/BetaTag';
import { Confirm, ContextMenu, type MenuItem } from '../OrchDialogs';
import { swallowTrailingClick } from '../orchActions';
import { attachToChat } from '../fileDrop';
import { forgetTeamThumb, teamFileThumb } from '../../data/teamApi';
import { dragTeam } from '../space/dragPath';
import { usePick } from '../space/usePick';
import { FolderTile, PathCrumbs } from '../space/FolderTile';
import { SendToOrch } from '../space/SendToOrch';
import { TeamMarkIcon } from './TeamFaces';
import { openTeamFile, type TeamOpenHow } from './openTeamFile';
import { altOpen } from '../../domain/craftOpen';
import { GIVE_LABEL, giveFolder, giveIds, giveItems, giveMenu, useRoster } from './teamGive';
import { splitTeamDrop, type RosterOrch } from '../../domain/teamGive';
import { TEAM_DROP_EVENT } from './teamDrop';
import { SortButton } from '../SortButton';
import '../space/locker.css';
import './team.css';

/** 이 기기 팀 폴더 주인 id — 폰 팀 보관함(PhoneTeam)이 같은 id 로 고른다 */
export const teamOwner = (teamId: string, team: string) => ({ id: `team-${teamId}`, name: team });


/** 팀마다 마지막 목록 — 팀 홈 탭을 갔다 오거나(화면이 내려간다) 대화 파일 탭을 열어도 바로 그린다. 같은 팀이면 대화 파일 보기와 나눠 쓴다(방 거르기는 화면에서) */
const lockerMemo = teamViewMemo<LockerView>();
/** 보던 폴더 — 파일 탭을 닫고 보관함이 다시 붙어도 그 폴더로(10-30 사용자) */
const placeOf = placeMemo();

const VIEW_KEY = 'teamLocker.view.v1';
const readView = (): 'list' | 'cards' => { try { return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'list'; } catch { return 'list'; } };
const saveView = (v: string) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* 저장 못 해도 이번엔 그대로 */ } };
const SORT_KEY = 'teamLocker.sort.v1';
const saveSort = (v: LockerSort) => { try { localStorage.setItem(SORT_KEY, JSON.stringify(v)); } catch { /* 저장 못 해도 이번엔 그대로 */ } };
/** 네모 끌기를 시작하지 않는 자리 — 줄·카드·단추·입력칸·머리·칩·고른 것 줄 */
const NO_BAND = '[data-pick], button, input, textarea, a, [role=menu], .lk-selbar, .tmx-lk-h, .tlk-chips, .lk-crumb';

/** 카드 썸네일 — 말풍선과 같은 길(teamApi teamFileThumb: 그림 그대로·PDF 첫 장). 잠긴 파일·못 그리는 형식은 확장자 표 */
function Thumb({ team, item }: { team: string; item: LockerItem }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (item.why) return;
    let live = true;
    teamFileThumb(team, item.id, item.name, item.size).then((u) => { if (live) setSrc(u); }, () => {});
    return () => { live = false; };
  }, [team, item.id, item.at, item.why]); // eslint-disable-line react-hooks/exhaustive-deps
  if (src) return <span className={`tlk-thumb ${thumbKind(item.name, item.size) === 'pdf' ? 'tlk-pg' : ''}`}><img src={src} alt="" draggable={false} onError={() => { forgetTeamThumb(team, item.id); setSrc(null); }} /></span>;
  return <span className="tlk-thumb"><span className="tmx-ext">{extOf(item.name) || tr('파일', 'file')}</span></span>;
}

export function TeamLocker({ teamId, team, people, follow, onFollow, onOpen, tail, icon, room }: {
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
  /** 대화 파일 보기 — 그 방(DM·팀챗) 파일만. name = 머리 이름(상대·팀챗 이름) */
  room?: { id: string; name: string };
}) {
  const [v, setV] = useState<LockerView | null>(null);
  const [err, setErr] = useState('');
  const [ups, setUps] = useState<LockerUpload[]>([]);
  const placeKey = room ? `${teamId}:${room.id}` : teamId;
  const [place, setPlace] = useState(() => placeOf.get(placeKey));
  // 팀을 바꾸는 렌더엔 place 가 아직 앞 팀 것 — 그 팀 칸에 맞춘 뒤(아래 열기 효과)부터 적는다
  const placeFor = useRef(placeKey);
  useEffect(() => { if (placeFor.current === placeKey) placeOf.put(placeKey, place); }, [placeKey, place]);
  const [trash, setTrash] = useState(false);
  const [mode, setMode] = useState<'list' | 'cards'>(readView);
  const [sort, setSort] = useState<LockerSort>(() => readSort(() => localStorage.getItem(SORT_KEY)));
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  /** 새 폴더 — 지금 자리에 이름 칸 타일(이름을 넣어야 만든다) */
  const [folderIn, setFolderIn] = useState(false);
  /** 안에 파일이 든 폴더 지우기 확인 — 경로들과 안의 파일 수 */
  const [rmFolder, setRmFolder] = useState<{ keys: string[]; n: number } | null>(null);
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
      lockerMemo.put(teamId, fresh);
      if (cur.current === teamId) { setV(lockerMemo.get(teamId)?.v ?? fresh); setErr(''); }
    } catch (e) { if (cur.current === teamId) setErr(String(e)); } finally { setBusyList(false); listing.current = false; }
  }, [teamId]);

  // 열자마자 — 이 창이 기억한 마지막 목록(탭을 갔다 와도), 없으면 기기에 봉해 둔 목록(앱을 다시 켠 뒤, 망 없이)을 먼저(10-26 사용자 296.png "그냥 떠 있어야").
  // 망은 기억이 없거나 오래됐을 때만 바로 — 기억이 있으면 아래 확인이 소켓이 알린 판과 견줘 바뀌었을 때만 받는다(10-28 사용자 "매번 새로 로드")
  useEffect(() => {
    const m = lockerMemo.get(teamId);
    setV(m?.v ?? null); placeFor.current = placeKey; setPlace(placeOf.get(placeKey)); setTrash(false); setPend([]); setUndone(null);
    if (!m) void invoke<LockerView | null>('team_locker_cached', { team: teamId }).then((c) => { if (c && cur.current === teamId) setV((x) => x ?? c); }, () => {});
    if (needFetch(m, 0)) void load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 이 화면이 본 판 — 봉해 둔 목록(cached)은 아직 본 게 아니다(받는 중) */
  const seenRev = useRef<number | null>(null);
  seenRev.current = v && !v.cached ? v.rev : null;
  // 2초마다(붙자마자 한 번) — 올리는 중 줄과 '새 판 알림'(방 소켓, 본 판보다 새 판인가). 올리기가 끝났거나 새 판이면 목록을 다시
  useEffect(() => {
    const tick = () => {
      void invoke<{ uploads: LockerUpload[]; changed: boolean }>('team_locker_poll', { team: teamId, seen: seenRev.current }).then((p) => {
        setUps(p.uploads);
        const going = lockerUps(p.uploads, {}).filter((u) => !u.error).length;
        if ((p.changed || going < upCount.current) && !listing.current) void load();
        upCount.current = going;
      }, () => {});
    };
    tick();
    const t = window.setInterval(tick, 2000);
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

  const folder = !trash && !room && place ? place : null;
  const putIn = useCallback((paths: string[], to: string | null) => {
    if (!paths.length) return Promise.resolve();
    return invoke('team_locker_put', { team: teamId, paths, folder: to }).then(() => invoke<{ uploads: LockerUpload[] }>('team_locker_poll', { team: teamId }).then((p) => { setUps(p.uploads); upCount.current = lockerUps(p.uploads, {}).length; }));
  }, [teamId]);

  // 끌어 넣기 — 파인더(fileDrop)·참모 보관함 카드(dragPath, 같은 창이나 다른 창에서 넘어온 것). folder 가 있으면 놓은 폴더(타일·경로 칸), 없으면 지금 보는 폴더.
  // 대화 파일 보기 칸엔 못 올린다 — 이유를 말한다
  useEffect(() => {
    const f = (e: Event) => {
      const d = (e as CustomEvent<{ paths: string[]; team: string; folder?: string }>).detail;
      if (d?.team !== teamId || !d.paths?.length) return;
      if (room && d.folder === undefined) { setNote(tr('대화 파일 보기엔 못 올려요 — 팀 보관함 탭이나 위 폴더 칩에 놓아 줘', 'Not here — drop on the team locker tab or a folder chip above')); return; }
      // 올리는 중 줄이 바로 그 자리에 뜬다 — 따로 알림 줄은 안 띄운다(10-28 사용자)
      const to = d.folder !== undefined ? d.folder || null : folder;
      void putIn(d.paths, to).catch((x: unknown) => setNote(tr(`팀 보관함에 못 올렸어요 — ${String(x)}`, `Couldn't upload to the team locker — ${String(x)}`)));
    };
    window.addEventListener(TEAM_LOCKER_DROP, f);
    return () => window.removeEventListener(TEAM_LOCKER_DROP, f);
  }, [teamId, putIn, folder, room]);

  const shown = useMemo(() => (v ? withPending(v.items, pend.map((p) => p.op)) : null), [v, pend]);
  const busy = shown?.busy ?? new Set<string>();
  const busyFolders = shown?.busyFolders ?? new Set<string>();
  const roomId = room?.id ?? '';
  const items = useMemo(() => (shown ? sortItems(room ? inRoom(shown.items, roomId, trash) : inPlace(shown.items, place, trash), sort) : []), [shown, room, roomId, place, trash, sort]);
  const all = useMemo(() => (shown ? allFolders(shown.items) : []), [shown]);
  /** 지금 자리 폴더 타일 — 이름순 뒤집기만 따른다(참모 보관함과 같게) */
  const tiles = useMemo(() => {
    if (!shown || trash || room) return [];
    const k = kidFolders(shown.items, place);
    return sort.key === 'name' && sort.desc ? [...k].reverse() : k;
  }, [shown, trash, room, place, sort]);
  const use = v ? usageText(v.usage) : null;
  // 보던 폴더가 사라지면(만들기 실패로 되돌아감·팀원이 지움) 남아 있는 가장 가까운 위 폴더로 — 빈 칸에 갇히지 않게
  useEffect(() => {
    if (!shown || !place || all.includes(place)) return;
    let up = parentOf(place);
    while (up && !all.includes(up)) up = parentOf(up);
    setPlace(up);
  }, [shown, all, place]);

  // 고르기 — 참모 보관함과 같은 훅. 못 여는 줄(잠긴 파일)은 고르지 않는다
  const box = useRef<HTMLDivElement>(null);
  // 고르는 순서 = 보이는 순서 — 폴더 타일(dir:경로) 다음 파일
  const order = useMemo(() => [...tiles.map((f) => dirId(f.key)), ...items.filter((i) => !i.why).map((i) => i.id)], [tiles, items]);
  const pick = usePick({ box, order, reset: `${teamId}|${roomId}|${place}|${trash}`, skip: NO_BAND });
  const picked = items.filter((i) => pick.picked(i.id));
  const pickedDirs = tiles.filter((f) => pick.picked(dirId(f.key)));
  const byId = (id: string) => shown?.items.find((x) => x.id === id);

  const act = (fn: () => Promise<unknown>) => void fn().then(() => load(), (e: unknown) => setNote(String(e)));
  /** 누르면 연다(편집 앱이 맞는 형식은 참모 앱, 그 밖은 스페이스) — app = 우클릭 '다른 앱으로 열기'(true)·'미리보기'·'참모 ○○로 열기' */
  const open = (i: LockerItem, app: TeamOpenHow = false) => {
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
  // 내 참모에게 — 이 기기에서 풀어 그 참모 보관함(팀 보관함/<팀>/…)에 두고, 메인 창이 그 참모 채팅 입력칸에 #file 칩을 붙인다(보내기는 사람이)
  const roster = useRoster();
  const give = (ids: string[], o: RosterOrch) => {
    const go = ids.filter((id) => !opening.has(id));
    if (!go.length) return;
    setOpening((x) => { const n = new Set(x); go.forEach((id) => n.add(id)); return n; });
    void giveIds(teamId, go, o)
      .catch((e: unknown) => setNote(tr(`${o.label}에게 못 보냈어요 — ${String(e)}`, `Couldn't send to ${o.label} — ${String(e)}`)))
      .finally(() => setOpening((x) => { const n = new Set(x); go.forEach((id) => n.delete(id)); return n; }));
  };
  /** 아이콘 단추 — 누른 자리 아래에 참모 고르기 */
  const menuAt = (e: MouseEvent, run: (o: RosterOrch) => void) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const list = giveItems(roster, run);
    setMenu({ x: Math.round(r.left), y: Math.round(r.bottom + 4), items: list.length ? list : [{ label: tr('켜져 있는 참모가 없어요', 'No assistant is running') }] });
  };
  const pickOrch = (e: MouseEvent, ids: string[]) => menuAt(e, (o) => { give(ids, o); pick.end(); });
  // 지금 연 폴더째(안쪽까지) — 그 참모 팀 자리에 같은 폴더 모양으로 풀고 폴더 칩 하나(2026-10-30 사용자 '이 폴더')
  const folderHas = !!folder && folderFiles(shown?.items ?? [], folder).length > 0;
  const giveHere = (o: RosterOrch) => {
    if (!folder) return;
    void giveFolder(teamId, folder, folderFiles(shown?.items ?? [], folder).map((x) => x.id), o)
      .catch((e: unknown) => setNote(tr(`${o.label}에게 못 보냈어요 — ${String(e)}`, `Couldn't send to ${o.label} — ${String(e)}`)));
  };
  const rename = (id: string, args: { name?: string; folder?: string }) => run({ k: 'meta', id, ...args }, () => invoke('team_locker_rename', { team: teamId, id, ...args }));
  const verb = (id: string, what: 'trash' | 'restore' | 'purge') => run({ k: 'act', id, verb: what }, () => invoke('team_locker_act', { team: teamId, id, verb: what }));
  /** 대화 파일을 폴더로 복사 — 이 기기에서 풀어 그 폴더에 새로 올린다(대화 파일은 방 사람 열쇠로만 봉해져 서버에서 바로 못 옮긴다). 원본은 대화에 남는다 */
  const copyTo = (ids: string[], to: string) => {
    if (!ids.length) return;
    setNote(tr(`대화 파일 ${ids.length}개를 '${to}'에 복사해요 — 원본은 대화에 남아요`, `Copying ${ids.length} chat file(s) into '${to}' — the originals stay in the chat`));
    void Promise.all(ids.map((id) => invoke<string>('team_locker_open', { team: teamId, id, external: false })))
      .then((paths) => putIn(paths, to))
      .catch((e: unknown) => setNote(tr(`대화 파일을 '${to}'에 못 복사했어요 — ${String(e)}`, `Couldn't copy the chat file(s) into '${to}' — ${String(e)}`)));
  };
  /** 폴더로 — 팀 보관함 파일은 옮기고(이미 거기면 빼고), 폴더(dir:경로)는 그 안으로, 대화 파일은 복사. 대화 파일을 맨 위에 놓으면 왜 그대로인지 말한다.
   *  마지막 것이 빠져 비는 폴더엔 표시 줄을 남긴다(파인더처럼 빈 폴더가 남게) — 옮기기를 먼저 얹어야 기다리는 일이 빈 폴더를 그린다 */
  const moveTo = (ids: string[], to: string) => {
    const p = dropPlan(ids, to, byId, shown?.items ?? []);
    for (const id of p.move) rename(id, { folder: to });
    for (const d of p.dirs) run({ k: 'folder', from: d.from, to: d.to }, () => invoke('team_locker_folder', { team: teamId, from: d.from, to: d.to }));
    for (const f of p.keep) run({ k: 'mkdir', folder: f }, () => invoke('team_locker_mkdir', { team: teamId, folder: f }));
    copyTo(p.copy, to);
    if (p.stay) setNote(tr('대화 파일은 폴더 칩에 놓으면 그 폴더로 복사돼요', 'Drop chat files on a folder chip to copy them there'));
  };
  const trashMany = (ids: string[]) => { const went = ids.filter((id) => verb(id, 'trash')); if (went.length) setUndone(went); pick.end(); };
  /** 고른 것 휴지통 — 파일은 바로(되돌리기 줄), 안에 파일이 든 폴더는 한 번 묻는다(빈 폴더는 바로) */
  const trashPicked = () => {
    const full = pickedDirs.filter((f) => f.n > 0);
    pickedDirs.filter((f) => f.n === 0).forEach((f) => removeFolder(f.key));
    if (full.length) setRmFolder({ keys: full.map((f) => f.key), n: full.reduce((a, f) => a + f.n, 0) });
    trashMany(picked.map((i) => i.id));
  };

  // 끌어 놓기 — 폴더 칩(옮기기)·채팅 칸(풀어서 그 채팅에 붙이기). 끄는 길은 참모 보관함과 같은 dragPath
  useEffect(() => {
    const mv = (e: Event) => { const d = (e as CustomEvent<{ team: string; ids: string[]; folder: string }>).detail; if (d?.team === teamId) moveTo(d.ids, d.folder); };
    const out = (e: Event) => {
      const d0 = (e as CustomEvent<{ team: string; ids: string[]; chat?: string; convo?: HTMLElement; note?: string }>).detail;
      if (d0?.team !== teamId) return;
      // 창 밖에 놓았는데 참모 자리가 아니었다 — 그때만 한 줄(받는 창이 drag_back 으로, 아무 창 위도 아니면 dragPath 가)
      if (d0.note) { setNote(d0.note); return; }
      // 폴더는 채팅에 못 붙인다 — 파일만 넘기고, 폴더뿐이면 이유를 말한다
      const d = { ...d0, ids: d0.ids.filter((id) => dirOfId(id) === null) };
      if (!d.ids.length) { setNote(tr('폴더는 채팅에 못 붙여요 — 안의 파일을 골라 끌어 줘', "Folders can't be attached — drag the files inside")); return; }
      const fail = (e2: unknown) => setNote(tr(`채팅에 못 붙였어요 — ${String(e2)}`, `Couldn't attach to the chat — ${String(e2)}`));
      const unpack = (ids: string[]) => Promise.all(ids.map((id) => invoke<string>('team_locker_open', { team: teamId, id, external: false })));
      // 팀 대화 칸 — 이미 팀 보관함에 있는 파일은 그 파일을 가리키는 첨부로, 다른 방 대화 파일만 풀어서 이 방에 다시 올린다
      if (d.convo) {
        const el = d.convo;
        const ds = d.ids.map(byId).filter((x): x is LockerItem => !!x && !x.why);
        const { refs, reupload } = splitTeamDrop(ds, el.dataset.teamRoom ?? '', teamId);
        if (refs.length) el.dispatchEvent(new CustomEvent(TEAM_DROP_EVENT, { detail: { refs } }));
        if (reupload.length) void unpack(reupload).then((paths) => el.dispatchEvent(new CustomEvent(TEAM_DROP_EVENT, { detail: { paths } })), fail);
        return;
      }
      // 참모 채팅 칸·띠 참모 프사 = 그 참모 보관함에 두고 #file 칩. 참모가 아닌 세션 채팅이면 풀어 둔 자리 그대로 붙인다
      const o = roster.find((x) => x.id === d.chat);
      if (o) give(d.ids, o);
      else if (d.chat) { const c = d.chat; void unpack(d.ids).then((paths) => attachToChat(c, paths), fail); }
    };
    window.addEventListener(TEAM_LOCKER_MOVE, mv);
    window.addEventListener(TEAM_LOCKER_OUT, out);
    return () => { window.removeEventListener(TEAM_LOCKER_MOVE, mv); window.removeEventListener(TEAM_LOCKER_OUT, out); };
  });
  /** 끌기 — 고른 묶음 안의 것을 끌면 묶음째(화면 순서), 밖이면 그 하나. 휴지통·잠긴 파일은 안 끈다 */
  const dragOf = (i: LockerItem) => {
    if (trash || i.why) return {};
    const ids = pick.many(i.id) ? order.filter((k) => pick.picked(k)) : [i.id];
    const label = ids.length > 1 ? tr(`${ids.length}개`, `${ids.length} items`) : i.name;
    // 대화 파일이 섞였으면 끄는 표에 미리 — 폴더 칩엔 옮기지 않고 복사된다
    return dragTeam(teamId, ids, ids.some((k) => byId(k)?.room) ? `${label} · ${tr('폴더엔 복사', 'copies into folders')}` : label);
  };

  /** 폴더 타일 끌기 — 고른 묶음 안이면 묶음째(파일·폴더), 밖이면 그 폴더 하나. 폴더(타일·경로 칸)에 놓으면 그 안으로 */
  const dragDir = (key: string) => {
    const k = dirId(key);
    const ids = pick.many(k) ? order.filter((x) => pick.picked(x)) : [k];
    return dragTeam(teamId, ids, ids.length > 1 ? tr(`${ids.length}개`, `${ids.length} items`) : key.split('/').pop() ?? key);
  };

  // 키보드 — Esc 풀기 · Backspace·Delete·⌘⌫ 고른 것 휴지통(되돌리기 줄) · Enter 하나 고른 것 열기. 보관함 칸 안 포커스·입력칸 밖일 때만
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    const t = e.target as HTMLElement | null;
    if (!t || !box.current?.contains(t) || t.closest('input, textarea, [contenteditable="true"]') || e.isComposing || menu || purge || rmFolder) return;
    if (e.key === 'Escape' && pick.sel.keys.length) { e.preventDefault(); pick.end(); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && (picked.length || pickedDirs.length) && !trash) { e.preventDefault(); trashPicked(); return; }
    if (e.key === 'Enter' && picked.length + pickedDirs.length === 1) { e.preventDefault(); if (pickedDirs[0]) setPlace(pickedDirs[0].key); else open(picked[0]!); }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  /** 폴더 이름 글 — '견적 › 10월', 맨 위는 '팀 보관함(맨 위)' */
  const pathLabel = (t: string) => (t ? t.split('/').join(' › ') : tr('팀 보관함(맨 위)', 'Team locker (top)'));
  /** 옮길 곳 메뉴 — 고른 폴더 자신·안쪽·지금 자리는 빼고 */
  const moveItems = (ids: string[]) => {
    const dirs = ids.map(dirOfId).filter((x): x is string => x !== null);
    // 다 같은 자리에서 온 것이면 그 자리는 뺀다
    const froms = new Set(ids.map((id) => { const d = dirOfId(id); return d !== null ? parentOf(d) : byId(id)?.folder ?? ''; }));
    return moveTargets(shown?.items ?? [], { from: froms.size === 1 ? [...froms][0] : undefined, dirs })
      .map((t) => ({ label: pathLabel(t), run: () => moveTo(ids, t) }));
  };
  /** 대화 파일 복사할 곳 — 팀 보관함 모든 폴더 */
  const copyItems = (ids: string[], after?: () => void) => all.map((f) => ({ label: pathLabel(f), run: () => { copyTo(ids, f); after?.(); } }));
  const menuFor = (i: LockerItem): MenuItem[] => trash
    ? [
      { label: tr('되살리기', 'Restore'), run: () => verb(i.id, 'restore') },
      { label: tr('영구 지우기…', 'Delete forever…'), danger: true, sep: true, run: () => setPurge(i) },
    ]
    : [
      ...(i.why ? [] : [
        { label: tr('열기', 'Open'), run: () => open(i) },
        ...((alt) => (alt ? [{ label: alt.label, run: () => open(i, alt.how) }] : []))(altOpen(i.name)),
        { label: tr('다른 앱으로 열기', 'Open with default app'), run: () => open(i, true) },
        giveMenu(roster, (o) => give([i.id], o)),
        { label: tr('이 기기에 저장', 'Save to this Mac'), run: () => save(i) },
        { label: tr('이름 바꾸기', 'Rename'), sep: true, run: () => setNaming({ id: i.id, what: 'name', value: i.name }) },
        ...(i.room ? (all.length ? [{
          label: tr('팀 보관함 폴더로 복사', 'Copy to a team folder'),
          sub: () => copyItems([i.id]),
        }] : []) : [{
          label: tr('폴더로 옮기기', 'Move to folder'),
          sub: () => [
            ...moveItems([i.id]),
            { label: tr('새 폴더…', 'New folder…'), sep: true, run: () => setNaming({ id: i.id, what: 'folder' as const, value: '' }) },
          ],
        }]),
      ]),
      { label: tr('휴지통으로', 'Move to trash'), sep: true, danger: true, run: () => verb(i.id, 'trash') },
    ];
  /** 여럿 고른 채 — 옮기기·휴지통(휴지통 안이면 되살리기) */
  const batchItems = (): MenuItem[] => {
    const ids = picked.map((i) => i.id);
    const dirIds = pickedDirs.map((f) => dirId(f.key));
    const n = ids.length + dirIds.length;
    if (trash) return [{ label: tr(`${n}개 되살리기`, `Restore ${n}`), run: () => { ids.forEach((id) => verb(id, 'restore')); pick.end(); } }];
    const movable = [...dirIds, ...picked.filter((i) => !i.room).map((i) => i.id)];
    const chat = picked.filter((i) => i.room).map((i) => i.id);
    return [
      ...(ids.length ? [{ ...giveMenu(roster, (o) => { give(ids, o); pick.end(); }), label: tr(`${ids.length}개 내 참모에게`, `Send ${ids.length} to my assistant`) }] : []),
      ...(movable.length ? [{ label: tr(`${movable.length}개 폴더로 옮기기`, `Move ${movable.length} to folder`), sub: () => moveItems(movable).map((m) => ({ ...m, run: () => { m.run(); pick.end(); } })), empty: tr('옮길 폴더가 없어요', 'No folder to move to') }] : []),
      ...(chat.length && all.length ? [{ label: tr(`${chat.length}개 팀 보관함 폴더로 복사`, `Copy ${chat.length} to a team folder`), sub: () => copyItems(chat, pick.end) }] : []),
      { label: tr(`${n}개 휴지통으로`, `Move ${n} to trash`), sep: true, danger: true, run: trashPicked },
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
    if (trash || room || (e.target as HTMLElement).closest('input, textarea, [data-pick], .tlk-chip, .lk-fcard')) return;
    e.preventDefault();
    swallowTrailingClick();
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: tr('새 폴더', 'New folder'), run: () => setFolderIn(true) },
      { label: tr('파일 넣기', 'Add files'), run: () => void invoke('team_locker_pick', { team: teamId, folder }).catch((x: unknown) => setNote(String(x))) },
    ] });
  };

  // 폴더 — 만들기는 봉한 표시 줄, 이름 바꾸기·옮기기·지우기는 그 폴더(안쪽까지) 파일 meta 를 고치거나 휴지통으로(Rust team_locker_folder). 누르면 바로 화면에
  const removeFolder = (key: string) => { if (place === key || place.startsWith(`${key}/`)) setPlace(parentOf(key)); run({ k: 'folder', from: key, to: null }, () => invoke('team_locker_folder', { team: teamId, from: key, to: null })); };
  const renameFolder = (key: string, name: string) => {
    const to = renamedPath(key, name);
    if (!name.trim() || to === key) return;
    run({ k: 'folder', from: key, to }, () => invoke('team_locker_folder', { team: teamId, from: key, to }));
  };
  /** 새 폴더 이름 칸이 끝남 — 지금 자리 안에 만든다(이미 있으면 그리로 들어가기만) */
  const folderDone = (name: string) => {
    setFolderIn(false);
    const n = name.trim().replace(/\//g, '-');
    if (!n) return;
    const key = place ? `${place}/${n}` : n;
    if (!all.includes(key)) run({ k: 'mkdir', folder: key }, () => invoke('team_locker_mkdir', { team: teamId, folder: key }));
  };
  const askRemove = (f: { key: string; n: number }) => (f.n ? setRmFolder({ keys: [f.key], n: f.n }) : removeFolder(f.key));
  /** 폴더 타일 오른쪽 클릭 — 고른 묶음 안이면 묶음 메뉴, 밖이면 그 폴더를 고르고 */
  const folderMenu = (e: MouseEvent, f: { key: string; n: number }, renameIt: () => void) => {
    e.preventDefault();
    e.stopPropagation();
    swallowTrailingClick();
    if (pick.many(dirId(f.key))) { setMenu({ x: e.clientX, y: e.clientY, items: batchItems() }); return; }
    pick.right(dirId(f.key));
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: tr('열기', 'Open'), run: () => setPlace(f.key) },
      { label: tr('이름 바꾸기', 'Rename'), sep: true, run: renameIt },
      { label: tr('폴더로 옮기기', 'Move to folder'), sub: () => moveItems([dirId(f.key)]), empty: tr('옮길 폴더가 없어요', 'No folder to move to') },
      { label: f.n ? tr('폴더 지우기…', 'Delete folder…') : tr('폴더 지우기', 'Delete folder'), danger: true, sep: true, run: () => askRemove(f) },
    ] });
  };
  /** 경로 칸·타일은 끌어 놓는 자리 — dragPath 가 [data-team-folder] 를 빛내고 놓으면 옮기기 신호 */
  const dropAt = (key: string) => ({ 'data-team-folder': key });

  const nameBox = (i: LockerItem) => naming?.id === i.id && (
    <input className="tlk-name" autoFocus value={naming.value} placeholder={naming.what === 'folder' ? tr('새 폴더 이름', 'New folder name') : ''}
      onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onChange={(e) => setNaming({ ...naming, value: e.target.value })}
      onBlur={() => setNaming(null)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); setNaming(null); }
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && naming.value.trim()) {
          // 새 폴더로 옮기기 — 지금 보는 폴더 안에 그 이름으로
          const nf = naming.value.trim().replace(/\//g, '-');
          rename(i.id, naming.what === 'name' ? { name: naming.value.trim() } : { folder: place ? `${place}/${nf}` : nf });
          setNaming(null);
        }
      }} />
  );
  const meta = (i: LockerItem) => (i.why ? tr('이 기기에선 아직 못 열어요', 'Not openable on this Mac yet') : [i.by, whenText(i.at), fmtBytes(i.size)].filter(Boolean).join(' · '));
  /** 그 줄 끝 글 — 여는 중 · 반영 중(보낸 바꾸기) · 평소 */
  const state = (i: LockerItem, normal: ReactNode) => (opening.has(i.id) ? tr('여는 중', 'Opening') : busy.has(i.id) ? tr('반영 중', 'Saving') : normal);
  // 올리는 중 줄 — 팀 보관함 올리기만(대화 파일 붙이기는 채팅 칸이 그린다), 휴지통·대화 파일 보기에선 안 보인다
  const myUps = lockerUps(ups, { trash, room: room?.id });
  const n = picked.length + pickedDirs.length;
  /** 줄·카드 끝 '내 참모에게 보내기' — 줄이 단추라 안에 못 넣어 옆(겹친 자리)에. 고른 묶음 안이면 묶음째. 휴지통·잠긴 파일·이름 바꾸는 중엔 없다 */
  const giveBtn = (i: LockerItem) => !trash && !i.why && naming?.id !== i.id && (
    <IconButton size="s" className="tlk-give" label={GIVE_LABEL()} onClick={(e) => pickOrch(e, pick.many(i.id) ? order.filter((k) => pick.picked(k)) : [i.id])}><IconChatSend /></IconButton>
  );
  const rowCls = (i: LockerItem, base: string) => [base, i.why ? 'tlk-locked' : '', opening.has(i.id) ? 'tlk-opening' : '', busy.has(i.id) ? 'tlk-pending' : '', pick.picked(i.id) ? 'picked' : ''].filter(Boolean).join(' ');

  return (
    // 파인더에서 끌어 넣는 자리는 팀 보관함만 — 대화 파일 보기에 놓으면 팀 전체에 올라가 버린다
    <div className={`tmx-locker tlk ${room ? 'tlk-room' : ''}`} data-team-locker={room ? undefined : teamId} data-team-id={teamId}>
      <div className="tlk-main" ref={box} tabIndex={-1} data-select-all="" onPointerDown={pick.bandStart} onMouseDown={pick.noShiftSelect} onContextMenu={blankMenu}>
        <div className="tmx-lk-h">
          <TeamMarkIcon name={room ? room.name : team} size={34} img={room ? undefined : icon} />
          <span className="tmx-head-tx"><b>{room ? room.name : team}</b><span>{trash ? tr('휴지통 · 30일 뒤 지워져요', 'Trash · cleared after 30 days') : room ? tr('대화 파일 · 이 대화 사람만 봐요', 'Chat files · only people in this chat') : tr(`팀 보관함 · 사람 ${people}`, `Team locker · ${people} people`)}
            {pend.length > 0 ? <i className="tlk-sync" role="status">{tr('보내는 중', 'Saving')}</i> : busyList && v?.cached && <i className="tlk-sync" role="status">{tr('새로 받는 중', 'Updating')}</i>}</span></span>
          {!room && <BetaTag className="tlk-beta" />}
          {use && !room && (
            <span className="tlk-use" title={tr(`팀 보관함 ${fmtBytes(v!.usage.used)} 사용 · 한도 ${fmtBytes(v!.usage.limit)}(좌석 ${v!.usage.seats} × 10GB)`, `${fmtBytes(v!.usage.used)} used of ${fmtBytes(v!.usage.limit)} (${v!.usage.seats} seats × 10GB)`)}>
              <span className="tlk-bar"><i style={{ width: `${Math.max(use.ratio * 100, use.ratio > 0 ? 3 : 0)}%` }} /></span>{use.text}
            </span>
          )}
          <SortButton keys={SORTS} value={sort} onChange={(x) => { setSort(x); saveSort(x); }} />
          <IconButton tone="line" pressed={mode === 'cards'} label={mode === 'cards' ? tr('목록으로 보기', 'List view') : tr('카드로 보기', 'Card view')}
            onClick={() => { const m = mode === 'cards' ? 'list' : 'cards'; setMode(m); saveView(m); }}>{mode === 'cards' ? <IconList /> : <IconDashboard />}</IconButton>
          {!trash && !room && <IconButton tone="line" label={tr('여기에 새 폴더', 'New folder here')} onClick={() => setFolderIn(true)}><IconFolderPlus /></IconButton>}
          {!trash && !room && <IconButton tone="line" label={tr('파일 넣기', 'Add files')} onClick={() => void invoke('team_locker_pick', { team: teamId, folder }).catch((e: unknown) => setNote(String(e)))}><IconPlus /></IconButton>}
          <IconButton tone="line" pressed={trash} label={trash ? tr('휴지통 닫기', 'Close trash') : tr('휴지통', 'Trash')} onClick={() => setTrash(!trash)}><IconTrash /></IconButton>
          {room ? null : tail ?? <IconButton tone="line" pressed={follow} label={follow ? tr('메신저 팀 따라가기 — 켜짐', 'Follow messenger team — on') : tr('메신저 팀 따라가기 — 꺼짐', 'Follow messenger team — off')} onClick={() => onFollow(!follow)}><IconLink /></IconButton>}
        </div>

        {!trash && room && all.length > 0 && (
          // 대화 파일 보기 — 팀 보관함 맨 위 폴더는 놓으면 복사하는 자리로만(누르는 칩이 아니다, 깊은 폴더는 오른쪽 클릭 '팀 보관함 폴더로 복사'). 앞 아이콘 하나로 '복사' 를 알린다
          <div className="tlk-chips tlk-copyto" role="group" aria-label={tr('놓으면 팀 보관함 폴더로 복사', 'Drop to copy into a team folder')} title={tr('파일을 끌어 놓으면 그 팀 보관함 폴더로 복사돼요', 'Drop files here to copy them into that team folder')}>
            <span className="tlk-copyto-ic" aria-hidden="true"><IconFolderMove /></span>
            {all.filter((f) => !f.includes('/')).map((f) => <span key={f} className="tlk-chip" data-team-folder={f}>{f}</span>)}
          </div>
        )}
        {!trash && !room && (
          // 경로 줄 — 팀 보관함 › 견적 › 10월(참모 보관함과 같은 조각). 칸을 누르면 거기로, 끌어 놓으면 그 폴더로
          <div className="tlk-path">
            <PathCrumbs root={tr('팀 보관함', 'Team locker')} crumbs={crumbsOf(place)} onGo={setPlace} dropOf={dropAt} back={place ? () => setPlace(parentOf(place)) : undefined} />
            {folderHas && <SendToOrch size="s" to={{ name: tr('내 참모', 'my assistant'), color: '' }} onClick={(e) => menuAt(e, giveHere)} />}
          </div>
        )}

        {err && <div className="tmx-none">{err}</div>}
        {note && <div className="tmx-hint tlk-note" role="alert" onClick={() => setNote('')}>{note}</div>}
        {!!v?.skipped.length && !trash && <div className="tmx-hint">{tr(`${v.skipped.join(', ')} — 보안 번호 확인 전이라 새 파일을 아직 못 받아요`, `${v.skipped.join(', ')} can't receive new files until their security number is confirmed`)}</div>}

        {(tiles.length > 0 || folderIn) && (
          <div className="lk-fgrid tlk-fgrid">
            {tiles.map((f) => (
              <FolderTile key={f.key} name={f.name} title={f.key} drop={dropAt(f.key)} pickKey={dirId(f.key)}
                cls={busyFolders.has(f.key) ? 'tlk-pending' : undefined}
                pick={{ picked: pick.picked(dirId(f.key)), press: (x) => pick.press(x, dirId(f.key)), drag: dragDir(f.key) }}
                tail={<span className="lk-count">{busyFolders.has(f.key) ? tr('반영 중', 'Saving') : f.n}</span>}
                onOpen={() => setPlace(f.key)} onRename={(n) => renameFolder(f.key, n)} onMenu={(x, renameIt) => folderMenu(x, f, renameIt)} />
            ))}
            {folderIn && <FolderTile key="+new" name="" fresh onOpen={() => {}} onRename={folderDone} onCancel={() => setFolderIn(false)} />}
          </div>
        )}
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
                <div key={i.id} className="tlk-rw">
                  <button data-pick={i.why ? undefined : i.id} className={rowCls(i, 'tmx-lk-row')} onClick={(e) => click(e, i)} onContextMenu={(e) => onMenu(e, i)} title={i.name} aria-busy={opening.has(i.id) || busy.has(i.id)} {...dragOf(i)}>
                    <span className="tmx-ext">{extOf(i.name) || tr('파일', 'file')}</span>
                    {nameBox(i) || <b>{i.name || tr('잠긴 파일', 'Locked file')}</b>}
                    <span className="d">{state(i, meta(i))}</span>
                  </button>
                  {giveBtn(i)}
                </div>
              ))}
            </div>
          ) : (
            <div className="tlk-grid">
              {myUps.map((u) => (
                <div key={u.local} className="tlk-card tlk-up"><span className="tlk-thumb"><span className="tlk-prog"><i style={{ width: `${u.total ? (u.done / u.total) * 100 : 0}%` }} /></span></span><span className="tlk-cap"><b>{u.name}</b><span>{u.error || fmtBytes(u.total)}</span></span></div>
              ))}
              {items.map((i) => (
                <div key={i.id} className="tlk-rw">
                  <button data-pick={i.why ? undefined : i.id} className={rowCls(i, 'tlk-card')} onClick={(e) => click(e, i)} onContextMenu={(e) => onMenu(e, i)} title={i.name} aria-busy={opening.has(i.id) || busy.has(i.id)} {...dragOf(i)}>
                    <Thumb team={teamId} item={i} />
                    <span className="tlk-cap">{nameBox(i) || <b>{i.name || tr('잠긴 파일', 'Locked file')}</b>}<span>{state(i, i.why ? tr('아직 못 열어요', 'Locked') : `${i.by} · ${fmtBytes(i.size)}`)}</span></span>
                  </button>
                  {giveBtn(i)}
                </div>
              ))}
            </div>
          )
        ) : !v && !err ? (
          <div className="tmx-lk-rows tlk-skel" role="status" aria-label={tr('팀 보관함 여는 중', 'Opening the team locker')}>{[0, 1, 2, 3, 4].map((k) => <div key={k} className="tmx-lk-row"><i /><i /><i /></div>)}</div>
        ) : v && !err && !tiles.length && !folderIn && (
          <div className="tmx-none">{trash ? tr('휴지통이 비었어요', 'Trash is empty') : room ? tr('이 대화에 붙인 파일이 없어요', 'No files in this chat yet') : place ? tr('비어 있어요 — 파일이나 폴더를 끌어 놓아요', 'Empty — drop files or folders here') : tr('팀 보관함이 비었어요 — 파인더에서 이 칸으로 끌어 넣으면 팀 모두에게 올라가요', 'The team locker is empty — drag files here from Finder to share with the team')}</div>
        )}
        {pick.band && <div className="lk-band" style={pick.band} aria-hidden="true" />}
        {n > 0 ? (
          <div className="lk-selbar" role="toolbar" aria-label={tr('고른 것', 'Selection')}>
            <b className="lk-selcount">{tr(`${n}개 고름`, `${n} selected`)}</b>
            <span className="lk-sp" />
            {trash ? <button className="btn" onClick={() => { picked.forEach((i) => verb(i.id, 'restore')); pick.end(); }}>{tr('되살리기', 'Restore')}</button> : <>
              {picked.length > 0 && <IconButton label={GIVE_LABEL()} onClick={(x) => pickOrch(x, picked.map((i) => i.id))}><IconChatSend /></IconButton>}
              {(pickedDirs.length > 0 || picked.some((i) => !i.room)) && <IconButton label={tr('폴더로 옮기기', 'Move to folder')} onClick={(x) => { const r = x.currentTarget.getBoundingClientRect(); const ids = [...pickedDirs.map((f) => dirId(f.key)), ...picked.filter((i) => !i.room).map((i) => i.id)]; setMenu({ x: r.left, y: r.top - 8, items: moveItems(ids).map((m) => ({ ...m, run: () => { m.run(); pick.end(); } })) }); }}><IconFolderMove /></IconButton>}
              <IconButton label={tr('휴지통으로', 'Move to trash')} onClick={trashPicked}><IconTrash /></IconButton>
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
        {!room && <div className="tlk-drop" aria-hidden>{tr('여기 놓으면 팀 모두에게 올라가요', 'Drop to share with the team')}</div>}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {rmFolder && (
        <Confirm danger title={tr('폴더 지우기', 'Delete folder')} body={tr(`${rmFolder.keys.map((k) => `'${k.split('/').pop()}'`).join(', ')} 안 파일 ${rmFolder.n}개(안쪽 폴더까지)를 휴지통으로 옮기고 폴더를 지워요. 30일 안에 휴지통에서 되살릴 수 있어요.`, `Moves ${rmFolder.n} file(s) inside (including subfolders) to the trash and removes the folder. You can restore them from the trash within 30 days.`)}
          ok={tr('휴지통으로 옮기기', 'Move to trash')} onCancel={() => setRmFolder(null)}
          onOk={() => { const f = rmFolder; setRmFolder(null); f.keys.forEach(removeFolder); pick.end(); }} />
      )}
      {purge && (
        <Confirm danger title={tr('영구 지우기', 'Delete forever')} body={tr(`'${purge.name || '잠긴 파일'}' 을(를) 팀 모두에게서 지워요. 되돌릴 수 없어요.`, `Deletes '${purge.name || 'locked file'}' for the whole team. This can't be undone.`)}
          ok={tr('영구 지우기', 'Delete forever')} onCancel={() => setPurge(null)}
          onOk={() => { const p = purge; setPurge(null); verb(p.id, 'purge'); }} />
      )}
    </div>
  );
}
