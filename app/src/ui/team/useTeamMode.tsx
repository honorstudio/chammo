// 팀 모드(시안 team-space v1 A, 10-26 사용자 "추천대로") — 팀은 참모처럼 띠의 한 칸, 고르면 화면 전체가 팀. App 은 넘겨받은 조각만 끼운다(useFarMode 와 같은 모양).
// - 띠: 팀 표 하나(대화 안 읽은 수 합). 누르면 팀 모드 — 가운데 = 대화 목록 + 대화, 오른쪽 = 팀 스페이스(팀 홈·팀 보관함·연 파일, 끝에 팀 설정)
// - 참모로 돌아가기 = 띠의 참모 프사(SpaceView 가 onLeave). 팀 탭 줄은 팀마다 기억한다(domain/teamSpace)
// - 떼기 아이콘은 모니터가 둘 이상일 때만(모니터 하나면 뗀 창이 스페이스를 가린다 — 10-23 이렇게 정함)
import { useEffect, useMemo, useRef, useState } from 'react';
import { teamAllRoom, teamRoomSet, teamTakeInvite, teamUse, teamWindowClose, teamWindowOpen, teamWindowState } from '../../data/teamApi';
import { ALL_ROOM, allRoomPlan } from '../../domain/teamAllRoom';
import { convos as buildConvos, roomConvos, unreadTotal, windowKey, type Convo } from '../../domain/teamChat';
import { lookOf, namedConvos } from '../../domain/teamProfile';
import { closeTeamTab, openTeamCraft, openTeamFile, pickTeamTab, roomFilesKey, teamTabsOf, type TeamTabs } from '../../domain/teamSpace';
import { ReviseBar } from './ReviseBar';
import { dropTeamKey } from '../../domain/teamCraft';
import { craftAppOf, leftCraft } from '../../domain/craftTab';
import { invoke } from '@tauri-apps/api/core';
import { RoomCreate } from './RoomCreate';
import { useRoomMenu } from './useRoomMenu';
import { shownDms } from '../../domain/teamRoomMenu';
import { TeamDialog } from './TeamDialog';
import { lockerApi } from '../space/useLocker';
import { every } from '../poll';
import { TeamConvo, type Handoff } from './TeamConvo';
import { TeamHomeDesktop } from './HomeModeBlock';
import { TeamList } from './TeamList';
import { TeamLocker } from './TeamLocker';
import { TeamRail } from './TeamRail';
import { TeamSettings, teamMenu } from './TeamSettings';
import { TeamSpace as TeamSpaceView } from './TeamSpace';
import { TeamStart } from './TeamStart';
import { MeCell } from './MyProfile';
import { ContextMenu } from '../OrchDialogs';
import { onTeamDock, useTeam } from './useTeam';
import { ProfilesCtx, useProfiles } from './useProfiles';
import { tr } from '../../i18n';
import { IconDockIn, IconPanelLeft, IconWindowOut } from '../Icons';
import { CONVO, TEAM_LIST_W, clampConvo, convoKey, foldKey } from '../../domain/teamLayout';
import { fileHere } from '../chat/openChatFile';
import { IconButton } from '../kit/IconButton';

/** 이 컴퓨터에만 기억한 값 — 막혀 있으면 없음 */
const stored = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const keep = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 이번 실행만 */ } };

/** 스페이스가 팀 모드에 그리는 것 — file = 스페이스 파일 화면(filePage), craft = 팀에서 연 참모 앱 칸(k:<앱>), dropCraft = 꺼짐·숨김 */
export type TeamSpace = { name: string; open: (path: string) => void; craft: (key: string, src: string) => void; dropCraft: (key: string) => void;
  view: (file: (path: string) => React.ReactNode, onHide?: () => void, tabName?: (key: string) => string | undefined) => React.ReactNode };

/** alone = 메신저 따로 창(10-26 사용자 "팀 모드와 똑같이, 참모만 없이") — 늘 팀 모드, 창 다시 열기·딥링크 같은 메인 창 일은 안 한다, 누른 파일은 이 창 오른쪽 탭에.
 *  room = 따로 창을 열며 고를 방(대화 하나를 떼어도 이 창에서 그 대화를 고른다) */
export function useTeamMode(o: { handoff: () => Handoff | undefined; wide: boolean; alone?: boolean; room?: string }) {
  const alone = !!o.alone;
  const data = useTeam();
  const { feed } = data;
  const view = feed?.view ?? null;
  // 사진·상태·팀 아이콘(시안 team-settings v1) — 띠·대화·팝오버·팀 탭이 같이 읽는다
  const profiles = useProfiles(view?.joined ? view.teamId : null);
  const [onState, setOn] = useState(false);
  const on = alone || onState;
  const [sel, setSel] = useState<string | null>(null);
  // 팀 홈 글 '대화로' — 고른 팀챗 입력칸 첫 글(n 이 바뀌면 대화 칸을 새로 그려 다시 읽는다)
  const [seed, setSeed] = useState<{ text: string; n: number } | null>(null);
  const [tabsBy, setTabsBy] = useState<Map<string, TeamTabs>>(() => new Map());
  const [shown, setShown] = useState<string[]>([]);
  const [screens, setScreens] = useState(1);
  // 대화 폭(끌어 바꿈)·메신저 접기 — 창마다 따로 기억(domain/teamLayout, 10-26 사용자 "채팅 작게·스페이스 넓게")
  const [convo, setConvoRaw] = useState(() => { const v = stored(convoKey(alone)); return v == null ? CONVO.def : clampConvo(Number(v)); });
  const setConvo = (w: number) => setConvoRaw(clampConvo(w));
  useEffect(() => keep(convoKey(alone), String(convo)), [convo, alone]);
  const [fold, setFold] = useState(() => stored(foldKey(alone)) === '1');
  useEffect(() => keep(foldKey(alone), fold ? '1' : '0'), [fold, alone]);
  // 겹창(TeamDialog, 창 가운데) — room = 팀챗 만들기(roomId 없음)·바꾸기(roomId), 없으면 팀 만들기·들어오기
  const [pop, setPop] = useState<{ kind?: 'start' | 'link' | 'settings' | 'room'; roomId?: string } | null>(null);
  // 팀 메뉴는 누른 자리에
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // 링크(chammo://join)로 받은 초대 — 팝업을 화면 가운데 위에 코드 채운 채로(ADR 0015)
  const [invite, setInvite] = useState('');
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const f = () => setFocused(document.hasFocus() && !document.hidden);
    window.addEventListener('focus', f);
    window.addEventListener('blur', f);
    document.addEventListener('visibilitychange', f);
    return () => { window.removeEventListener('focus', f); window.removeEventListener('blur', f); document.removeEventListener('visibilitychange', f); };
  }, []);
  // 목록 차례 = 위 단톡방, 아래 사람(시안 msg-rooms A). 사람 대화 이름은 프로필 이름으로(팀 설정과 같게 — 10-26 운영 QA)
  // 방 목록엔 모든 팀 방이 온다 — 이 팀 것만(다른 팀 '전체'가 섞여 겹쳐 보이지 않게, 10-26)
  const rooms: Convo[] = useMemo(() => (view?.joined ? roomConvos(view.rooms.filter((r) => (r.team || view.teamId) === view.teamId), feed?.items ?? [], data.read) : []), [view, feed, data.read]);
  const people: Convo[] = useMemo(() => (view?.joined ? namedConvos(buildConvos(view.members, view.rooms, feed?.items ?? [], data.read), profiles.board) : []), [view, feed, data.read, profiles.board]);
  const cs = useMemo(() => [...rooms, ...people], [rooms, people]);
  // 들어오면 아무 대화도 안 고른다 — 사람이 고르거나 알림·딥링크·'대화로'로만 연다(10-26 사용자 "처음 켰을 때 대화방을 안 누르고 싶을 수 있다").
  // 마지막에 본 방을 기억해 열지도 않는다: 연 방은 읽음으로 바뀌어(onRead) 안 읽은 수가 사라진다
  const cur = cs.find((c) => c.key === sel) ?? null;
  const names = useMemo(() => Object.fromEntries((view?.members ?? []).map((m) => [m.id, m.name])), [view]);
  const detached = shown.includes('all');
  const teamId = view?.joined ? view.teamId : '';
  const tabs = teamTabsOf(tabsBy, teamId);
  const setTabs = (f: (t: TeamTabs) => TeamTabs) => setTabsBy((m) => new Map(m).set(teamId, f(teamTabsOf(m, teamId))));

  // 모니터 수·떼어 둔 창 — 켤 때 한 번은 지난번 뗀 창을 그 모니터가 있을 때만 다시 연다(없으면 앱 안으로)
  useEffect(() => {
    if (alone) return;
    let first = true;
    const tick = () => void teamWindowState().then((s) => {
      setScreens(s.screens);
      setShown(s.shown);
      if (first && s.open.length && s.spotAlive && s.screens > 1) void teamWindowOpen('all').catch(() => {}); // 옛 판의 방 창 열쇠도 팀 모드 창 하나로
      else if (first && s.open.length) for (const k of s.open) void teamWindowClose(k).catch(() => {}); // 기록만 지운다(앱 안으로)
      first = false;
    }, () => {});
    tick();
    const stop = every(tick, 30_000);
    const off = onTeamDock(({ key, place }) => setShown((x) => (place === 'window' ? (x.includes(key) ? x : [...x, key]) : x.filter((k) => k !== key))));
    return () => { stop(); off(); };
  }, [alone]);
  // 딥링크 초대 — Rust 가 window.__teamInvite() 로 알리고, 켜지면서 받은 건 처음 한 번 가져간다. 둘 다 team_take_invite 한 길(한 번만 나온다)
  useEffect(() => {
    if (alone) return;
    const take = () => void teamTakeInvite().then((l) => {
      if (!l) return;
      setInvite(l);
      setPop({});
    }, () => {});
    const w = window as unknown as { __teamInvite?: () => void };
    w.__teamInvite = take;
    take();
    return () => { delete w.__teamInvite; };
  }, [alone]);
  // 팝업이 떠 있는 동안은 자주 다시 읽는다 — 앞을 덮은 로그인 화면(LoginGate)에서 로그인하면 팝업이 바로 다음 칸으로
  const popOpen = pop !== null;
  const { refresh } = data;
  useEffect(() => {
    if (!popOpen) return;
    refresh();
    return every(refresh, 3_000);
  }, [popOpen, refresh]);
  // '전체' 팀챗 — 팀장 기기(메인 창)가 없으면 만들고 새로 든 사람을 더한다. 같은 계획은 한 번만(실패해도 사람이 바뀔 때 다시)
  const tried = useRef('');
  useEffect(() => {
    if (alone || !view?.joined) return;
    const plan = allRoomPlan(view);
    if (!plan) return;
    const key = JSON.stringify([view.teamId, plan]);
    if (tried.current === key) return;
    tried.current = key;
    const p = 'make' in plan ? teamAllRoom(view.teamId, ALL_ROOM, plan.make) : teamRoomSet(plan.room, '', plan.add, []);
    void p.then(() => refresh(), () => {});
  }, [alone, view, refresh]);
  // 팀에서 빠지거나 팀이 없어지면 팀 모드도 끝
  const team = view?.joined ? view.team : null;
  useEffect(() => { if (!team) setOn(false); }, [team]);

  // 이 창에서 누른 파일(팀 대화 풍선·팀 보관함) — 리더 창 대신 이 창 오른쪽 팀 탭에(openChatFile 이 먼저 본다)
  const openRef = useRef<(p: string) => void>(() => {});
  openRef.current = (p) => setTabs((t) => openTeamFile(t, p));
  useEffect(() => {
    if (!alone) return;
    fileHere.open = (p) => openRef.current(p);
    return () => { fileHere.open = null; };
  }, [alone]);
  // 팀 칸 참모 앱 — 떠나면 숨기기(10분 뒤 저장·끄기), 들어오면 숨김 풀기(참모 칸 SpaceView 와 같은 규칙). 팀 모드를 떠나도 떠난 것
  const craftHere = on && craftAppOf(tabs.cur) ? tabs.cur : '';
  const prevCraft = useRef('');
  useEffect(() => {
    const gone = leftCraft(prevCraft.current, craftHere);
    if (gone) void invoke('craft_leave', { app: gone }).catch(() => {});
    if (craftHere && craftHere !== prevCraft.current) void invoke('craft_enter', { app: craftAppOf(craftHere) }).catch(() => {});
    prevCraft.current = craftHere;
  }, [craftHere]);
  const pick = (c: Convo) => {
    setSel(c.key);
    setSeed(null);
  };
  // 대화를 보여 주는 길(알림·딥링크로 방 열기·팀챗 만든 뒤·'대화로') — 접어 둔 메신저를 편다
  const showChat = () => setFold(false);
  // 떼기 — 목록 머리·대화 머리·떼어 둔 창으로 가기 모두 팀 모드 창 하나(Rust 가 떠 있으면 앞으로, 방을 주면 그 창에서 고른다)
  const toWindow = (room?: string) => void teamWindowOpen(windowKey(room ?? null), team ?? '').catch(() => {});
  // 따로 창 — 고를 방(주소 r= 또는 Rust 가 __teamPick 으로). 목록이 아직이면 들어오면 고른다
  const [want, setWant] = useState(o.room ?? '');
  useEffect(() => {
    if (!alone) return;
    const w = window as unknown as { __teamPick?: (room: string) => void };
    w.__teamPick = (room: string) => setWant(room);
    return () => { delete w.__teamPick; };
  }, [alone]);
  const wanted = want ? cs.find((c) => c.room === want) : undefined;
  if (wanted) { setWant(''); pick(wanted); setFold(false); }
  const openRoom = (room: string) => {
    if (detached) { toWindow(room); return; }
    const c = cs.find((x) => x.room === room);
    if (!c) return;
    setOn(true);
    showChat();
    pick(c);
  };
  // 줄 우클릭(10-26 사용자) — 이름·사람은 바꾸기 겹창, 나가거나 지우거나 숨긴 대화를 보고 있었으면 가운데를 비운다
  const roomMenu = useRoomMenu({ teamId, owner: view?.role === 'owner', onEdit: (room) => setPop({ kind: 'room', roomId: room }), onChanged: data.refresh,
    onGone: (c) => setSel((s) => (s === c.key ? null : s)) });
  const handoff = o.handoff();
  const canDetach = screens > 1;
  const meId = view?.members.find((m) => m.me)?.id ?? '';

  return {
    data,
    on: on && !!team,
    railOn: on && team ? `team:${teamId}` : null,
    color: cur?.color,
    listW: TEAM_LIST_W,
    convo,
    setConvo,
    fold,
    tabs,
    icon: profiles.board?.teamIcon || undefined,
    rail: team ? (
      <ProfilesCtx.Provider value={profiles}><TeamRail icon={profiles.board?.teamIcon || undefined} team={team} chats={cs.length} on={on} unread={unreadTotal(cs)} wide={o.wide}
        onTeam={() => setOn(true)}
        onMenu={(e) => setMenu({ x: e.clientX, y: e.clientY })} /></ProfilesCtx.Provider>
    ) : null,
    // 팀 만들기·초대 — 참모 띠 + 메뉴에서(띠 RA '+ 하나', 2026-10-24 사용자)
    add: {
      label: team ? tr('팀 초대', 'Invite to team') : tr('팀 만들기', 'Make a team'), open: () => setPop({}),
      room: team ? { label: tr('팀챗 만들기', 'New team chat'), open: () => setPop({ kind: 'room' }) } : undefined,
    },
    // 가운데 — 대화 목록(메신저 창과 같은 TeamList) + 고른 대화
    chat: on && team && view && feed ? (
      <ProfilesCtx.Provider value={profiles}>
        <div className="tmc" style={{ ['--tmc-list' as string]: `${TEAM_LIST_W}px` }}>
          <div className="tmc-list">
            <div className="tmx-list-h"><b>{team}</b>
              <IconButton label={tr('메신저 접기', 'Collapse the messenger')} onClick={() => setFold(true)}><IconPanelLeft /></IconButton>
              {alone ? <IconButton label={tr('앱에 붙이기', 'Dock into the app')} onClick={() => void teamWindowClose('all')}><IconDockIn /></IconButton>
                : canDetach && <IconButton label={tr('메신저 따로 창으로', 'Open the messenger in its own window')} onClick={() => toWindow()}><IconWindowOut /></IconButton>}
            </div>
            <div className="tmx-list"><TeamList convos={shownDms(people, roomMenu.hidden)} rooms={rooms} sel={cur?.key ?? null} onPick={pick} onMenu={roomMenu.open}
              onInvite={view.role === 'owner' ? () => setPop({ kind: 'link' }) : undefined} onNewRoom={() => setPop({ kind: 'room' })} /></div>
            <MeCell me={lookOf(profiles.board, meId, view.me)} rosterName={view.me} sub={`${team} · ${view.role === 'owner' ? tr('팀장', 'owner') : tr('팀원', 'member')}`} onSaved={profiles.reload} />
          </div>
          <div className="tmc-main">
            {cur ? <TeamConvo key={`${cur.key}:${seed?.n ?? 0}`} seed={seed?.text} onSeeded={() => setSeed((s) => (s?.text ? { ...s, text: '' } : s))} convo={cur} items={feed.items} team={view.team} myName={view.me} handed={data.handed} focused={focused} safety={feed.safety} held={feed.held}
              onRead={data.markRoom} onHanded={data.markHanded} onSent={data.refresh} handoff={handoff} people={names} teamId={view.teamId} members={view.members} reads={feed.reads}
              onEditRoom={cur.kind === 'group' ? () => setPop({ kind: 'room', roomId: cur.room }) : undefined}
              detach={canDetach && !alone ? () => toWindow(cur.room) : undefined}
              onFiles={cur.room ? () => setTabs((t) => openTeamFile(t, roomFilesKey(cur.room))) : undefined} />
              : <div className="tmx-win-empty">{cs.length ? tr('대화를 고르면 여기에 열려요', 'Pick a chat to open it here') : tr('아직 대화가 없어요', 'No chats yet')}</div>}
          </div>
        </div>
      </ProfilesCtx.Provider>
    ) : null,
    space: team && view ? {
      name: team,
      open: (path: string) => { setOn(true); setTabs((t) => openTeamFile(t, path)); },
      craft: (key: string, src: string) => { setOn(true); setTabs((t) => openTeamCraft(t, key, src)); },
      dropCraft: (key: string) => setTabsBy((m) => dropTeamKey(m, key)),
      view: (file: (path: string) => React.ReactNode, onHide?: () => void, tabName?: (key: string) => string | undefined) => (
        <ProfilesCtx.Provider value={profiles}>
          <TeamSpaceView tabs={tabs} tabName={tabName} revise={(p) => <ReviseBar key={p} path={p} team={view.teamId} me={view.me} />} onHide={onHide} onUnfold={fold ? showChat : undefined} onPick={(k) => setTabs((t) => pickTeamTab(t, k))} onClose={(p) => setTabs((t) => closeTeamTab(t, p))} file={file}
            onSettings={() => setPop({ kind: 'settings' })}
            roomName={(r) => cs.find((c) => c.room === r)?.name ?? tr('대화', 'Chat')}
            roomFiles={(r) => <TeamLocker key={`room:${r}`} teamId={view.teamId} team={team} people={view.members.length} follow onFollow={() => {}} room={{ id: r, name: cs.find((c) => c.room === r)?.name ?? tr('대화', 'Chat') }}
              onOpen={(p, dir) => (dir ? void lockerApi.reveal(p) : setTabs((t) => openTeamFile(t, p)))} />}
            home={<TeamHomeDesktop teamId={view.teamId} team={team} members={view.members} icon={profiles.board?.teamIcon || undefined}
              onTalk={(text) => { const c = rooms[0] ?? cur; if (!c) return; setSel(c.key); showChat(); setSeed((s) => ({ text, n: (s?.n ?? 0) + 1 })); }} />}
            // 팀 설정은 탭 줄 끝 톱니라 보관함 머리 끝 자리는 비운다(빈 조각 — 없으면 옛 '팀 따라가기' 단추가 나온다)
            locker={<TeamLocker teamId={view.teamId} team={team} people={view.members.length} follow onFollow={() => {}} icon={profiles.board?.teamIcon || undefined}
              onOpen={(p, dir) => (dir ? void lockerApi.reveal(p) : setTabs((t) => openTeamFile(t, p)))} tail={<></>} />} />
        </ProfilesCtx.Provider>
      ),
    } satisfies TeamSpace : undefined,
    pop: (
      <ProfilesCtx.Provider value={profiles}>
        {pop && (
          <TeamDialog label={popLabel(pop, !!team)} onClose={() => { setPop(null); setInvite(''); }}>
            {pop.kind === 'room' && view?.joined
              ? <RoomCreate team={view.teamId} members={view.members} room={pop.roomId ? roomOf(view.rooms, pop.roomId) : undefined}
                  onCancel={() => setPop(null)} onDone={(room) => { setPop(null); setOn(true); showChat(); setSel(`room:${room}`); data.refresh(); }} />
              : pop.kind === 'settings' && view?.joined
              ? <TeamSettings view={view} onClose={() => setPop(null)} onChanged={data.refresh} />
              : <TeamStart key={invite} view={view} invite={invite} makeNow={pop.kind === 'link'} onDone={() => { setPop(null); setInvite(''); data.refresh(); }} onChanged={data.refresh} />}
          </TeamDialog>
        )}
        {roomMenu.node}
        {menu && <ContextMenu x={menu.x} y={menu.y} items={teamMenu(view, (kind) => setPop({ kind }), (t) => void teamUse(t).then(() => { setSel(null); data.refresh(); }, () => {}))} onClose={() => setMenu(null)} />}
      </ProfilesCtx.Provider>
    ),
    /** 팀 메뉴로 여는 겹창(메신저 창 팀 아이콘) */
    openPop: (kind: 'start' | 'link' | 'settings' | 'room') => setPop({ kind }),
    leave: () => setOn(false),
    openRoom,
  };
}

/** 바꾸기 창에 넘길 방 — 이름·사람(서버 목록 값; 바꿀 땐 Rust 가 명부에서 다시 센다). 화면 목록은 이름을 with 에 준다 — name 만 보면 바꾸기 창 이름 칸이 비었다 */
export const roomOf = (rooms: { id: string; name?: string; with?: string; members?: string[] }[], id: string) => {
  const r = rooms.find((x) => x.id === id);
  return r ? { id, name: r.name || r.with || '', members: r.members ?? [] } : undefined;
};

/** 겹창 이름(읽기 도구) */
const popLabel = (p: { kind?: string; roomId?: string }, joined: boolean) =>
  p.kind === 'room' ? (p.roomId ? tr('팀챗 바꾸기', 'Edit team chat') : tr('팀챗 만들기', 'New team chat'))
    : p.kind === 'settings' ? tr('팀 설정', 'Team settings')
    : p.kind === 'link' || joined ? tr('팀 초대', 'Invite to team') : tr('팀 만들기', 'Make a team');
