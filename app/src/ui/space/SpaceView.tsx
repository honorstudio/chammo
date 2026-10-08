import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { appendTaskEvent, readSessionTasks, readShowLog, readTranscriptTails, sendTextToSession, spaceTrace, spawnLines } from '../../data/tauri';
import { queueShow, showPlace, traceLine } from '../../domain/spaceJump';
import { dashFiles, paneState, type DashFile } from '../../domain/dashboard';
import { findTarget } from '../../domain/inbox';
import { kindOf } from '../../domain/reader';
import type { Session } from '../../domain/session';
import { sameOrchSlot, stoppedOrchs } from '../../domain/stopped';
import { foldAgents, pruneAgents, type SubAgent } from '../../domain/subAgents';
import { addSpawned, focusPick, harnitorPick, holderMap, reviewPick, toolsPick, newShows, orphanSends, shownFiles, showOwner, transcriptTargets } from '../../domain/spaceNav';
import { orchDocs, projectGroups } from '../../domain/spaceTree';
import { termTail } from '../../domain/termTail';
import { starterLists } from '../../domain/starterLists';
import type { TaskCard, TaskEvent } from '../../domain/tasks';
import { targetLabel, unclosedOf, type KnownSession } from '../../domain/orphans';
import { UnclosedTasks } from './UnclosedTasks';
import type { StoppedSession } from '../../domain/stopped';
import { assistant, josa, tr } from '../../i18n';
import { TerminalPane } from '../TerminalPane';
import { AgentBrowser, useAgentLives } from '../AgentBrowser';
import { liveOf } from '../../domain/agentBrowser';
import { DashboardView, type DashLine, type DashLists, type LiveLine } from './DashboardView';
import { AgentList } from './AgentList';
import { DocPage } from './DocPage';
import type { ShowAt } from '../../domain/showAt';
import { PagesHome } from './PagesHome';
import { ToolsPage } from './ToolsPage';
import { CurationMode } from './CurationMode';
import { HarnitorPanel } from '../HarnitorPanel';
import type { HarnitorSel } from '../../domain/harnitor';
import { spaceWord } from '../../domain/viewNow';
import { reportView } from '../viewReport';
import { OPEN_PAGE, PAGE_TITLE } from './PageBlock';
import { Preview } from './Preview';
import { CHAT_INSERT, dragPath } from './dragPath';
import { attachToChat } from '../fileDrop';
import { SpaceNav, StateMark } from './SpaceNav';
import { sessionStatus, statusWord, type ActivityStatus } from '../../domain/status';
import { useChatItems } from './useChatItems';
import { OrchName, useOrchActions } from '../orchActions';
import { orchRoleOf, useOrchRoleData } from '../orchRoleStore';
import { NotePanel } from './NotePanel';
import type { NoteBase } from '../../domain/noteEdits';
import { projectRoot } from '../../domain/spaceTree';
import './space.css';
import { attachCommand } from '../../domain/termCommand';
import type { RoutineItem } from '../../domain/routine';
import { bodyColor, orchColor } from '../../domain/avatar';
import { OrchAvatar, avatarState, useAvatars } from '../avatar';
import { EMPTY_NAV, goBack, goForward, visit, type Nav } from '../../domain/navHistory';
import { SPACE_NAV } from './navSignal';
import { deskTarget, navPick, OFFICE, officePick, rememberSide, sheetBack, sheetOpen, showPick, spaceView, startPick, type Side, type SpaceSide } from '../../domain/spaceOffice';
import { OfficeSheet, SheetIcons } from '../office/OfficeSheet';
import { HOME_PICK as HOME } from '../../domain/orchHome';
import { IconClose, IconDashboard, IconOffice, IconPet } from '../Icons';
import { BrowserAttachButton } from '../BrowserAttach';

const nameOf = (s: Session) => (s.workspace ? `${s.project} / ${s.workspace}` : s.project);

// 참모 문서 고정 — 참모 이름 기준(세션이 바뀌어도 남는다, v10 R1)
const PIN_KEY = 'spacePins';
const loadPins = (): Record<string, string[]> => { try { return JSON.parse(localStorage.getItem(PIN_KEY) ?? '{}') as Record<string, string[]>; } catch { return {}; } };
// 내 페이지 제목(첫 줄 # 제목) — 파일 이름보다 이게 메뉴에 보인다
const TITLE_KEY = 'spacePageTitles';
const loadTitles = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(TITLE_KEY) ?? '{}') as Record<string, string>; } catch { return {}; } };
// 참모마다 사무실/스페이스 중 마지막에 고른 쪽 — 참모 이름 기준(앱을 다시 켜도, 2026-10-03 사용자)
const SIDE_KEY = 'spaceOfficeSide';
const loadSides = (): Record<string, Side> => { try { return JSON.parse(localStorage.getItem(SIDE_KEY) ?? '{}') as Record<string, Side>; } catch { return {}; } };
// 기억 키 = 세션 짧은 번호(이름을 바꿔도·/clear 해도 그대로) — 예전 키(이름)도 읽는다(2026-10-03 QA 8번)
const sideKey = (o: Session) => o.id;
const sideKeys = (o: Session) => [o.id, ...(o.name ? [o.name] : [])];

/** 스페이스 ↔ 사무실 두 칸 — 지금 쪽이 칠해진다(시안 office-chat v1 A) */
function SideSeg({ office, onPick }: { office: boolean; onPick: (want: 'office' | 'space') => void }) {
  return (
    <span className="seg cv-side" role="group" aria-label={tr('스페이스 / 사무실', 'Space / office')}>
      <button className={office ? '' : 'on'} aria-pressed={!office} aria-label={tr('스페이스', 'Space')} title={tr('스페이스 — 대시보드·문서', 'Space — dashboard and docs')} onClick={() => onPick('space')}><IconDashboard /></button>
      <button className={office ? 'on' : ''} aria-pressed={office} aria-label={tr('사무실', 'Office')} title={tr('사무실', 'Office')} onClick={() => onPick('office')}><IconOffice /></button>
    </span>
  );
}

/** 머리 오른쪽 끝 세 칸 — 대시보드 · 펫 · 사무실. 그 참모 대시보드·펫·사무실 어디서든 같은 자리(cv-main 오른쪽 위)에 고정(2026-10-03 사용자) */
function ViewSeg({ side, pet, office, onPick }: { side: SpaceSide; pet: boolean; office: boolean; onPick: (want: SpaceSide) => void }) {
  const b = (k: SpaceSide, label: string, icon: React.ReactNode) => (
    <button className={side === k ? 'on' : ''} aria-pressed={side === k} aria-label={label} title={label} onClick={() => onPick(k)}>{icon}</button>
  );
  return (
    <span className="seg cv-side cv-viewseg" role="group" aria-label={tr('대시보드 / 펫 / 사무실', 'Dashboard / pet / office')}>
      {b('dash', tr('대시보드', 'Dashboard'), <IconDashboard />)}
      {pet && b('pet', tr('펫', 'Pet'), <IconPet />)}
      {office && b('office', tr('사무실', 'Office'), <IconOffice />)}
    </span>
  );
}

/**
 * 채팅 뷰의 스페이스(큰 창 전체) — v10: 왼쪽 메뉴 트리(참모·프로젝트마다 대시보드 + 문서, 내 페이지),
 * 가운데 = 고른 것(대시보드 / 노션식 문서 / 세션 터미널). 참모·맡긴 세션이 띄운 파일은 위에 모달
 */
export function SpaceView({ orchPins = [], pet, petReq = null, onPetReq, office, officeReq = null, onOfficeReq, onOfficeShown, harnitorReq = null, onHarnitorReq, onHarnitorShown, onHarnitorClosed, toolsReq = null, onToolsReq, onToolsShown, onToolsClosed, reviewReq = null, onReviewReq, onReviewShown, computerUse, orchs, stoppingIds, startingOrchs, orch: chatOrch, projectSessions, sessions, events, claudeBin, fontSize, home, orchHome, send, sendTo, live = {}, menuOpen = true, idle = [], stopped = [], orchCwd = '', onResume, onRemoveStopped, onNewSession, onNewOrch, routines, routinePage, reviewPage, ctxOf, onAddProject, onChatTab, helpers = [], loose = [], tasks, onMessage }: {
  /** 고정한 참모(대화 id, 고정한 순서) — 사이드바 줄 순서·압정 표시 */
  orchPins?: string[];
  /** 세션이 안 떠 있는 프로젝트(예전 사이드바처럼 흐리게) */
  idle?: { name: string; root: string }[];
  /** 하니터 열기·닫기 요청(탑바·⌘·scripts/app) — 받아 처리하면 onHarnitorReq 로 비운다. 하니터는 탭마다 기억되는 화면('h:')이라
   *  지금 탭에 열리고, 다른 탭으로 가면 그 탭 화면이 보인다(2026-10-02 사용자). 열려 있으면 스페이스 칸을 덮는다(채팅 열은 그대로) */
  /** 참모가 키우는 펫 — 참모 대시보드의 '펫' 탭(다마고치 기능을 끄면 없음) */
  pet?: (who: (id: string) => { name: string; color: string } | null) => React.ReactNode;
  /** 위젯 '더보기' — 그 참모 대시보드의 펫 탭을 연다(n 이 바뀔 때마다) */
  petReq?: { id: string; n: number } | null;
  /** 펫 요청을 처리했으면 비운다 — 안 비우면 스페이스가 다시 그려질 때(리플레이·터미널 뷰 갔다 오기) 옛 요청으로 돌보는 참모 펫에 또 갔다(2026-10-06) */
  onPetReq?: () => void;
  harnitorReq?: 'open' | 'close' | 'toggle' | null;
  onHarnitorReq?: () => void;
  /** 지금 탭에 하니터가 떠 있나(탑바 버튼 켜짐) */
  onHarnitorShown?: (open: boolean) => void;
  /** 하니터를 닫았다(닫기 버튼·요청) — 터미널 뷰에서 열었으면 앱이 되돌아간다 */
  onHarnitorClosed?: () => void;
  /** 도구(MCP·플러그인·스킬) 열기·닫기 요청(위 막대 아이콘·scripts/app) — 하니터와 같은 식, 탭마다 기억되는 화면('t:') */
  toolsReq?: 'open' | 'close' | 'toggle' | null;
  onToolsReq?: () => void;
  onToolsShown?: (open: boolean) => void;
  onToolsClosed?: () => void;
  /** 도구 화면 내장 화면 조종의 '모든 프로젝트'(기능 computerUse) */
  computerUse?: { all: boolean; setAll: (on: boolean) => void };
  /** 꺼진 세션(이어서 켤 수 있는 것) */
  stopped?: StoppedSession[];
  /** 닫히지 않은 일 — 주인 잃은 카드(세션 없음·끝 표시 없음) + 이 맥 세션 기록. 참모 대시보드에 그 참모 것만 한 줄로(작업 패널 대신, 2026-10-02) */
  tasks?: { orphaned: TaskCard[]; known: KnownSession[]; canResume: (c: TaskCard) => boolean; onResume: (c: TaskCard) => Promise<void>; onFinish: (c: TaskCard) => void };
  /** 끄는 중인 참모 id · 켜는 중인 꺼진 참모 — 사이드바가 줄을 그대로 두고 상태만 바꾼다 */
  stoppingIds?: string[];
  startingOrchs?: StoppedSession[];
  orchCwd?: string;
  onResume?: (s: StoppedSession) => void;
  onRemoveStopped?: (s: StoppedSession) => void;
  ctxOf?: (s: Session) => number | undefined;
  onAddProject?: () => void;
  /** 메뉴에서 참모 이름을 누르면 채팅 탭도 그 참모로(2026-09-30 사용자) */
  onChatTab?: (id: string) => void;
  /** 도우미 세션(프로젝트가 아닌 일 — 이 폴더에서 띄운 것) */
  helpers?: Session[];
  loose?: Session[];
  onNewSession?: (root: string, name: string) => void;
  /** 머리줄 버튼 결과 한 줄(앱 위 알림 띠) — 브라우저 연결 등 */
  onMessage?: (m: string | null) => void;
  /** 참모 하나 더(⌘T 와 같다) — 채팅 탭 줄·오케스트레이터 칸의 + */
  onNewOrch?: () => void;
  /** 예약(루틴) 목록·화면(App 이 사이드바와 같은 RoutinePage 를 만들어 준다) */
  routines?: RoutineItem[];
  routinePage?: (name: string, removed: () => void, toChat?: (text: string) => void) => React.ReactNode;
  /** 리뷰(머지 전에 볼 것·열린 PR) — 터미널 뷰에만 있던 것을 채팅 뷰에도(2026-10-01 사용자). 입구는 위 막대 아이콘(2026-10-06, 사이드바 줄에서 옮김) */
  reviewReq?: 'open' | 'close' | 'toggle' | null;
  onReviewReq?: () => void;
  onReviewShown?: (open: boolean) => void;
  reviewPage?: (key: string | undefined, onKey: (key: string) => void, onOpen: (target: string) => void) => React.ReactNode;
  live?: Record<string, LiveLine>;
  /** 오케스트레이터 홈(어떤 참모를 켤지) — 메뉴 '오케스트레이터' 머리를 누르거나 참모가 하나도 없을 때. onGo = 켜진 참모를 눌렀을 때 */
  orchHome?: (onGo: (id: string) => void) => React.ReactNode;
  orchs: Session[];
  /** 지금 채팅 탭 참모 */
  orch?: Session;
  projectSessions: Session[];
  sessions: Session[];
  events: TaskEvent[];
  claudeBin: string;
  fontSize: number;
  home?: string;
  send: (text: string) => Promise<void>;
  sendTo?: string;
  onClose: () => void;
  onOpenSession: (id: string) => void;
  menuOpen?: boolean;
  /** 사무실 칸(터미널 뷰 사무실과 같은 것) — 없으면 사무실 기능 꺼짐. onOpen = 책상·카드를 누르면, dim = 옅게 할 이름표 */
  office?: (onOpen: (id: string) => void, dim?: (id: string) => boolean) => React.ReactNode;
  /** 사무실 켜기·끄기 요청(탑바 사무실 아이콘) — 받아 처리하면 onOfficeReq 로 비운다. 지금 탭 기준(탭마다 기억되는 화면) */
  officeReq?: 'open' | 'close' | 'toggle' | null;
  onOfficeReq?: () => void;
  /** 지금 탭에 사무실이 떠 있나(탑바 사무실 아이콘 켜짐) */
  onOfficeShown?: (on: boolean) => void;
}) {
  useOrchRoleData(); // 맡은 일이 바뀌면 대시보드 머리도 다시
  // 메뉴에서 보는 참모 — 채팅 탭을 바꾸면 따라오고, 메뉴에서 고르면 채팅 탭은 그대로(2026-09-30 사용자)
  const [nav, setNav] = useState<{ view?: string; chat?: string }>({ view: chatOrch?.id, chat: chatOrch?.id });
  const sides = useRef(loadSides());
  const homeOf = (o: Session) => (office ? startPick(sides.current, sideKeys(o), `o:${o.id}`) : `o:${o.id}`);
  const [pick, setPickRaw] = useState<string>(() => (chatOrch ? homeOf(chatOrch) : ''));
  // 지나온 화면 — 참모 탭(채팅 탭)마다 따로. 문서 "뒤로"·⌘[·마우스 뒤로 = 왔던 곳, ⌘] = 앞으로(없으면 위 칸).
  // 예전 문서 뒤로는 '위 칸'이라 링크 타고 간 뒤 누르면 오케스트레이터 홈으로 튕겼다(2026-10-04 QA D2)
  const navs = useRef(new Map<string, Nav>());
  const navKey = () => now.current.view ?? '';
  // 기록은 상태 갱신 함수 밖에서 바꾼다 — 개발판(StrictMode)은 갱신 함수를 두 번 돌려 뒤로가 두 칸 갔다
  // 스페이스를 바꾼 길 — 바뀔 때마다 종류만 기록(domain/spaceJump traceLine). 이름 없이 바뀌면 '?' 로 남아 다음에 또 튀면 잡힌다
  const why = useRef('mount');
  const setPick = (k: string, w = 'click') => { why.current = w; navs.current.set(navKey(), visit(navs.current.get(navKey()) ?? EMPTY_NAV, now.current.pick, k)); setPickRaw(k); };
  /** 뒤로(-1)·앞으로(1) — 기록이 없으면 뒤로는 fallback(위 칸) */
  const step = (dir: -1 | 1, fallback?: string) => {
    const cur = now.current.pick;
    const n = navs.current.get(navKey()) ?? EMPTY_NAV;
    const r = dir < 0 ? goBack(n, cur) : goForward(n, cur);
    why.current = dir < 0 ? 'back' : 'fwd';
    if (r) { navs.current.set(navKey(), r.nav); setPickRaw(r.to); return; }
    if (dir < 0 && fallback && fallback !== cur) { navs.current.set(navKey(), { back: n.back, fwd: [cur, ...n.fwd] }); setPickRaw(fallback); }
  };
  const followed = nav; // 채팅 탭이 바뀌면 아래 switchTo 가 옮긴다
  const orch = orchs.find((o) => o.id === followed.view) ?? chatOrch;
  // 채팅 탭마다 보던 화면을 기억한다 — 탭을 바꾸면 그 참모에서 마지막으로 보던 화면(처음이면 대시보드).
  // 다른 참모가 띄운 파일은 그 참모 탭으로 갈 때 보인다(2026-09-30 사용자 "탭별로 화면이 저장")
  const screens = useRef(new Map<string, { pick: string; modal: DashFile | null; focus?: { path: string; at: ShowAt; key: string } | null; scroll?: number; sheet?: string[] }>());
  const now = useRef({ view: followed.view, pick, modal: null as DashFile | null, sheet: [] as string[] });
  // 탭이 어떻게 바뀌든(누르기·⌘숫자·앱 명령·알림) 떠나는 참모 화면을 적어 두고 가는 참모 화면을 되살린다 — 누를 때만 되살려서
  // 단축키·"그 세션으로 가기"로 바꾸면 대시보드로 갔다(2026-09-30)
  const switchTo = (id: string, w = 'tab') => {
    if (!orchs.some((o) => o.id === id)) return;
    if (id === now.current.view) { setNav((n) => (n.chat === id ? n : { ...n, chat: id })); return; }
    why.current = w;
    // 보던 문서의 스크롤 자리도 같이 — 탭을 바꿨다 오면 맨 위로 올라갔다(2026-10-01 사용자)
    const scrollEl = () => document.querySelector<HTMLElement>('.space .cv-main .cv-doc-scroll');
    if (now.current.view) screens.current.set(now.current.view, { pick: now.current.pick, modal: now.current.modal, scroll: scrollEl()?.scrollTop ?? 0, sheet: now.current.sheet });
    const sv = screens.current.get(id);
    setNav({ view: id, chat: id });
    const to = orchs.find((o) => o.id === id)!;
    const toPick = sv?.pick ?? homeOf(to);
    setPickRaw(toPick); // 탭 바꾸기는 화면 기록이 아니다(기록은 탭마다 따로)
    setModal(sv?.modal ?? null);
    setSheet(sv?.sheet ?? []); // 사무실 위 창도 탭마다
    now.current = { ...now.current, view: id, pick: toPick, modal: sv?.modal ?? null, sheet: sv?.sheet ?? [] }; // 같은 틱에 뒤따르는 것(띄운 파일)이 새 탭 화면을 보게
    setFocus(sv?.focus ?? null); // 그 탭에 가서야 처음 보는 짚은 곳은 그때 반짝(한 번만 — 떠날 때 기억은 focus 없이)
    const want = sv?.scroll ?? 0;
    if (want > 0) {
      // 문서는 글을 읽어 온 뒤에야 길이가 생긴다 — 될 때까지 잠깐 다시 맞춘다(최대 1.5초)
      let tries = 0;
      const put = () => { const el = scrollEl(); if (el && el.scrollHeight - el.clientHeight >= want - 4) { el.scrollTop = want; return; } if (++tries < 15) window.setTimeout(put, 100); };
      window.setTimeout(put, 50);
    }
  };
  // 채팅 칸이 스페이스 참모를 바꿨을 때(App focusedBy) — 탭을 누르지 않았는데 오면 'follow' 로 남는다
  useEffect(() => { if (chatOrch?.id && chatOrch.id !== nav.chat) switchTo(chatOrch.id, 'follow'); }, [chatOrch?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = (e: Event) => { const id = (e as CustomEvent<string>).detail; if (id) switchTo(id); };
    window.addEventListener('chat-tab-pick', on);
    return () => window.removeEventListener('chat-tab-pick', on);
  }, [orchs.map((o) => o.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  // 참모를 바꾸는 순간 — 흐림 + 불러오는 중을 먼저 그려 보여 주고(한 프레임), 무거운 대시보드는 그다음에(2026-09-30 사용자
  // "한참 있다가 스플래시"). 바뀐 걸 그리는 중에 알아채야 첫 화면부터 스플래시다
  // 펫 탭을 연 참모 대시보드(하나만) — 위젯 '더보기'가 돌보는 참모 id 로 연다
  const [petFor, setPetFor] = useState<string | null>(null);
  // 사무실로 둔 참모여도 펫 탭이 보이게 그 참모 대시보드로
  useEffect(() => { if (petReq) { setPetFor(petReq.id); setPick(`o:${petReq.id}`, 'pet'); onPetReq?.(); } }, [petReq]); // eslint-disable-line react-hooks/exhaustive-deps
  const [shownOrch, setShownOrch] = useState(orch?.id);
  const [hold, setHold] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  if (orch?.id && orch.id !== shownOrch) {
    setShownOrch(orch.id);
    setHold(true);
    setSwitching(orch.id);
  }
  useEffect(() => {
    if (!hold) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setHold(false)); });
    // 창이 가려져 있거나 앞에 없으면 웹뷰가 그리기 신호(rAF)를 멈춰, 대시보드가 빈 화면으로 남았다(2026-10-01 사용자) — 시계로도 푼다
    const t = window.setTimeout(() => setHold(false), 200);
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); window.clearTimeout(t); };
  }, [hold]);
  useEffect(() => {
    if (!switching) return;
    const t = window.setTimeout(() => setSwitching(null), 450);
    return () => window.clearTimeout(t);
  }, [switching]);
  const act = useOrchActions();
  // 상태 말은 하나 — 대화 기록까지 본 판단(App liveLines)이 있으면 그것, 아직 못 읽었으면 세션만으로(domain/status)
  const statusOf = (s: Session): ActivityStatus => live[s.id]?.st ?? sessionStatus(s);
  const stateWord = (s: Session) => statusWord(statusOf(s));
  const oname = (o: Session) => act?.nameOf(o) ?? (o.name || assistant());
  const orchIds = orchs.map((o) => o.id);
  const colorOf = orchColor; // 이름으로 — 순서로 고르면 다른 참모가 꺼질 때 색이 바뀐다
  const { saved: avatars } = useAvatars(); // 큐레이션 보내기 고리를 받는 참모 색으로 — 채팅 칸과 같은 색(프사에서 고른 색 먼저)
  // 참모가 작업 기록 없이 띄웠거나 말 건 세션도 그 참모 것으로 — 대화 기록 꼬리에서 15초마다(앱이 켜져 있는 동안 모아 둔다, 2026-10-01 사용자)
  // 한 번 찾은 건 저장해 둔다 — 참모 sessionId 별 {찾은 이름들, 읽은 자리}. 처음엔 기록 전체를 훑고(끝 256KB 만 보면 앞서 띄운 세션을 놓쳤다, 2026-10-01 사용자),
  // 그 뒤로는 늘어난 부분만. 떠 있는 세션으로 풀릴 때만 쓰니 옛 이름은 해가 없다
  // 같은 길에 그 참모가 Agent 도구로 띄운 분신도 모은다(agents, 하루치) — 3 = 분신 줄도 고르게 바꾸며 처음부터 다시 훑기(2026-10-02 사용자)
  const SPAWN_KEY = 'spawnedBy3';
  type SpawnSt = { names: string[]; off: number; agents?: SubAgent[] };
  const spawnStore = useRef<Record<string, SpawnSt>>((() => { try { return JSON.parse(localStorage.getItem(SPAWN_KEY) ?? '{}') as Record<string, SpawnSt>; } catch { return {}; } })());
  const spawned = useRef(new Map<string, Set<string>>());
  const agentsOf = useRef(new Map<string, SubAgent[]>());
  const [spawnTick, setSpawnTick] = useState(0);
  const orchSidKey = orchs.map((o) => `${o.id}:${o.sessionId ?? ''}`).join();
  useEffect(() => {
    let alive = true;
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        let grew = false;
        for (const o of orchs) {
          const sid = o.sessionId;
          if (!sid) continue;
          const st = spawnStore.current[sid] ?? { names: [], off: 0 };
          const set = spawned.current.get(o.id) ?? new Set<string>(st.names);
          if (!spawned.current.has(o.id) && set.size > 0) grew = true;
          const r = await spawnLines(sid, st.off).catch(() => null);
          if (!alive) return;
          let agents = st.agents ?? [];
          if (r) {
            const text = r.lines.join('\n');
            for (const n of transcriptTargets(text)) if (!set.has(n)) { set.add(n); grew = true; }
            const next = pruneAgents(foldAgents(text, agents), Date.now());
            if (JSON.stringify(next) !== JSON.stringify(agents)) grew = true;
            agents = next;
            spawnStore.current[sid] = { names: [...set].slice(-80), off: r.next, agents };
          }
          if (!agentsOf.current.has(o.id) && agents.length > 0) grew = true;
          agentsOf.current.set(o.id, agents);
          spawned.current.set(o.id, set);
        }
        if (grew) {
          setSpawnTick((n) => n + 1);
          try { localStorage.setItem(SPAWN_KEY, JSON.stringify(spawnStore.current)); } catch { /* 이번 실행만 */ }
        }
      } finally { running = false; }
    };
    void tick();
    const t = window.setInterval(() => void tick(), 15_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [orchSidKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const holders = useMemo(() => {
    const resolve = (t: string) => findTarget(sessions, t)?.id;
    return addSpawned(holderMap(events, orchIds, resolve, Date.now()), spawned.current, resolve, orchIds);
  }, [events, orchIds.join(), sessions, spawnTick]); // eslint-disable-line react-hooks/exhaustive-deps
  // 맡긴 세션 — 프로젝트 세션뿐 아니라 그 참모가 띄운 도우미·프로젝트 밖 세션도(harnitor-port 가 대시보드에 안 붙었다, 2026-10-01 사용자)
  const heldBy = (o?: Session) => (o ? [...projectSessions, ...helpers, ...loose].filter((s) => holders.get(s.id)?.includes(o.id)) : []);
  const groups = useMemo(() => projectGroups(projectSessions), [projectSessions]);
  const orphans = orphanSends(events, Date.now());
  // scripts/app focus — 채팅 뷰에선 그 대시보드를 스페이스에(터미널로 넘어가지 않는다, 2026-10-02 사용자)
  useEffect(() => {
    const on = (e: Event) => {
      const plan = (e as CustomEvent<{ session: string } | { project: string }>).detail;
      const k = plan && focusPick(plan, sessions, groups, idle, orchs.map((o) => o.id));
      if (k) { setModal(null); setPick(k, 'focus'); }
    };
    window.addEventListener('space-focus', on);
    return () => window.removeEventListener('space-focus', on);
  });


  // scripts/show 기록 — 3초마다 꼬리. 대시보드 파일·참모 문서가 여기서 나온다
  const [log, setLog] = useState('');
  useEffect(() => {
    let alive = true;
    const tick = () => void readShowLog().then((l) => { if (alive) setLog((p) => (p === l ? p : l)); }).catch(() => {});
    tick();
    const id = window.setInterval(tick, 3000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  // 참모 문서 고정
  const [pins, setPins] = useState(loadPins);
  const pinKey = (o: Session) => o.name || o.id;
  const isPinned = (o: Session, p: string) => (pins[pinKey(o)] ?? []).includes(p);
  const togglePin = (o: Session, p: string) => setPins((all) => {
    const cur = all[pinKey(o)] ?? [];
    const next = { ...all, [pinKey(o)]: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] };
    try { localStorage.setItem(PIN_KEY, JSON.stringify(next)); } catch { /* 이번 실행만 */ }
    return next;
  });

  // 내 페이지
  const [pages, setPages] = useState<string[]>([]);
  const [titles, setTitles] = useState(loadTitles);
  const [pagesRoot, setPagesRoot] = useState('');
  const loadPages = () => invoke<string>('pages_dir').then((d) => { setPagesRoot(d); return invoke<string[]>('list_md_deep', { dir: d }); }).then(setPages).catch(() => {});
  useEffect(() => { void loadPages(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setTitle = (p: string, t: string) => setTitles((all) => {
    if (all[p] === t) return all;
    const next = { ...all, [p]: t };
    try { localStorage.setItem(TITLE_KEY, JSON.stringify(next)); } catch { /* 이번 실행만 */ }
    return next;
  });
  const pageName = (p: string) => titles[p] ?? (p.split('/').pop() ?? p).replace(/\.md$/i, '');
  // 페이지 이름은 첫 줄 # 제목 — 목록을 읽을 때 한 번씩 읽어 둔다(파일 이름이 아니라 제목이 어디서나 보이게)
  useEffect(() => {
    let alive = true;
    void Promise.all(pages.map(async (p) => [p, (await invoke<string>('read_doc_text', { path: p }).catch(() => '')).match(/^#\s+(.+)$/m)?.[1]?.trim()] as const)).then((rows) => {
      if (!alive) return;
      setTitles((all) => { const next = { ...all }; for (const [p, t] of rows) if (t) next[p] = t; try { localStorage.setItem(TITLE_KEY, JSON.stringify(next)); } catch { /* 이번 실행만 */ } return next; });
    });
    return () => { alive = false; };
  }, [pages.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  // 문서 속 하위 페이지 블록을 누르면
  useEffect(() => {
    const on = (e: Event) => { const p = (e as CustomEvent<string>).detail; if (p) openFileRef.current(p); };
    window.addEventListener(OPEN_PAGE, on);
    return () => window.removeEventListener(OPEN_PAGE, on);
  }, []);
  // ⌘[ ⌘](App)·마우스 뒤로/앞으로 단추 — 스페이스 화면 기록으로
  useEffect(() => {
    const on = (e: Event) => step((e as CustomEvent<-1 | 1>).detail);
    const mouse = (e: MouseEvent) => { if (e.button === 3 || e.button === 4) { e.preventDefault(); step(e.button === 3 ? -1 : 1); } };
    window.addEventListener(SPACE_NAV, on);
    window.addEventListener('mouseup', mouse);
    return () => { window.removeEventListener(SPACE_NAV, on); window.removeEventListener('mouseup', mouse); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const newPage = () => void invoke<string>('new_page', { title: tr('새 페이지', 'Untitled') }).then((p) => { void loadPages(); setPick(`d:${p}`); }).catch(() => {});


  // 사무실 켜기·끄기 — 탭(참모)마다 켜기 전 화면을 기억해 거기로 돌아간다
  const beforeOffice = useRef(new Map<string, string>());
  const officeTo = (want: 'office' | 'space' | 'toggle') => {
    if (!office || !orch) return;
    const r = officePick(pick, want, beforeOffice.current.get(orch.id) ?? '', `o:${orch.id}`);
    beforeOffice.current.set(orch.id, r.before);
    if (r.pick !== pick) setPick(r.pick, 'office');
  };
  useEffect(() => { if (officeReq) { officeTo(officeReq === 'open' ? 'office' : officeReq === 'close' ? 'space' : 'toggle'); onOfficeReq?.(); } }, [officeReq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onOfficeShown?.(pick === OFFICE); }, [pick]); // eslint-disable-line react-hooks/exhaustive-deps
  // 마지막에 고른 쪽 기억 — 지금 보는 참모 것으로
  useEffect(() => {
    if (!office || !orch) return;
    const next = rememberSide(sides.current, sideKey(orch), pick);
    if (next === sides.current) return;
    sides.current = next;
    try { localStorage.setItem(SIDE_KEY, JSON.stringify(next)); } catch { /* 이번 실행만 */ }
  }, [pick, orch?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // 사무실 기능을 끄면 사무실 자리는 대시보드로
  useEffect(() => { if (!office && pick === OFFICE && orch) { why.current = 'office-off'; setPickRaw(`o:${orch.id}`); } }, [office, pick, orch?.id]);

  // 참모(또는 그 참모가 맡긴 세션)가 scripts/show 로 띄우면 스페이스 위에 모달로 — md 면 문서 페이지로 연다
  const [modal, setModal] = useState<DashFile | null>(null);
  // 사무실 위 창(오피스 A 1단계) — 책상·띄운 문서를 사무실을 떠나지 않고 연다. 쌓인 순서 = 창 안 뒤로(domain/spaceOffice sheetOpen)
  const [sheet, setSheet] = useState<string[]>([]);
  const openSheet = (k: string) => setSheet((st) => sheetOpen(st, k));
  // 사무실 위에 띄운 미리보기 — 사무실로 들어갈 때 닫는 대상에서 뺀다
  const overOffice = useRef<DashFile | null>(null);
  const showOver = (f: DashFile) => { overOffice.current = f; setModal(f); };
  // 사무실로 가면 다른 화면에서 열려 있던 미리보기는 닫는다 — 웹 미리보기 창(자식 창)이 사무실 위에 그대로 남았다(2026-10-03 QA 9번).
  // 사무실 위에 띄운 것(띄운 파일·창 안 칩)은 그대로. 사무실을 떠나면 사무실 위 창도 닫는다
  useEffect(() => {
    if (pick === OFFICE) setModal((m) => (m && m === overOffice.current ? m : null));
    else setSheet([]);
  }, [pick]);
  // 짚어 보여 주기 — 문서(md)를 열며 반짝일 곳. key 가 바뀌면 다시 반짝
  const [focus, setFocus] = useState<{ path: string; at: ShowAt; key: string } | null>(null);
  const since = useRef(Date.now());
  now.current = { view: followed.view, pick, modal, sheet };
  // 스페이스가 바뀔 때마다 한 줄 — 종류만(경로·번호 없이). <데이터>/space-trace.log
  const traced = useRef<{ pick: string; view?: string } | null>(null);
  useEffect(() => {
    const p = traced.current;
    traced.current = { pick, view: followed.view };
    if (p && p.pick === pick && p.view === followed.view) return;
    void spaceTrace(traceLine({ ts: new Date().toISOString(), why: why.current, from: p?.pick ?? '', to: pick, viewFrom: p ? p.view : undefined, viewTo: followed.view, chat: nav.chat })).catch(() => {});
    why.current = '?';
  }, [pick, followed.view]); // eslint-disable-line react-hooks/exhaustive-deps
  // 다른 참모가 띄운 것 — 보던 화면은 그대로, 알림 한 줄(보기 = 그 참모 탭으로). 12초 뒤 저절로 닫힘
  const [notice, setNotice] = useState<{ id: string; path: string; n: number } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 12_000);
    return () => window.clearTimeout(t);
  }, [notice?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const fresh = newShows(log, null, since.current); // 채팅 뷰는 리더를 안 쓴다 — 누가 띄웠든 여기서
    if (!fresh.length) return;
    const last = fresh[fresh.length - 1]!;
    since.current = Date.parse(last.ts) || Date.now();
    // 띄우면 바로 보이게(2026-09-30 사용자 "띄워주면 바로") — 띄운 참모의 탭에. 하위 세션이 띄웠으면 그 세션을 잡은 참모, 모르면 지금 화면.
    // 다른 참모가 띄운 건 보던 스페이스를 옮기지 않고 그 참모 탭 화면에 넣어 두고 알림만 — 예전엔 채팅 탭·스페이스를 통째로 그 참모로
    // 옮겨서 화면이 저절로 튀었다(2026-10-06 사용자 "사람이 바꾸기 전엔 안 바뀐다")
    const owner = showOwner(last.by, orchIds, holders);
    const md = kindOf(last.path) === 'md';
    const place = showPlace(owner, now.current.view, nav.chat);
    if (place === 'queue' && owner) {
      const o = orchs.find((x) => x.id === owner);
      screens.current.set(owner, queueShow(screens.current.get(owner), o ? homeOf(o) : `o:${owner}`, last, md));
      setNotice({ id: owner, path: last.path, n: Date.now() });
      void spaceTrace(traceLine({ ts: new Date().toISOString(), why: 'show-queued', from: now.current.pick, to: now.current.pick, viewFrom: now.current.view, viewTo: now.current.view, chat: nav.chat })).catch(() => {});
      return;
    }
    if (place === 'chat' && owner) switchTo(owner, 'show');
    // 사무실이면 사무실을 떠나지 않는다 — md 는 사무실 위 창, 그림·시안은 사무실 위 미리보기(예전엔 대시보드로 튕겼다, 오피스 A 1단계)
    const r = showPick(now.current.pick, last.path, md);
    if (md) {
      setModal(null); // 떠 있던 미리보기 창에 문서가 가려지지 않게
      if (r.sheet) openSheet(r.sheet); else setPick(r.pick, 'show');
      setFocus(last.at ? { path: last.path, at: last.at, key: last.ts } : null);
    } else if (r.pick === OFFICE) showOver(last);
    else setModal(last);
  }, [log]); // eslint-disable-line react-hooks/exhaustive-deps

  // 참모 대시보드 파일 — 참모·맡긴 세션이 띄운 것 + 사용자가 채팅에 붙인 그림
  const items = useChatItems(orch?.sessionId);
  const myImages = useMemo(() => items.flatMap((it) => (it.kind === 'user' && it.images ? it.images.map((src) => ({ ts: it.ts, src })) : [])), [items]);
  const who = (id: string) => {
    if (id === 'me') return tr('사용자', 'You');
    const o = orchs.find((x) => x.id === id);
    if (o) return oname(o);
    const s = sessions.find((x) => x.id === id);
    return s ? nameOf(s) : id;
  };
  // 대시보드 세션 칸 — 대화 기록 꼬리를 터미널처럼 몇 줄(보고 있는 대시보드의 세션만 3초마다)
  const [tails, setTails] = useState<Record<string, string[]>>({});
  const tailIds = (() => {
    if (pick.startsWith('o:')) { const o = orchs.find((x) => x.id === pick.slice(2)) ?? orch; return o ? [o, ...heldBy(o)] : []; }
    if (pick.startsWith('p:')) return groups.find((x) => x.root === pick.slice(2))?.sessions ?? [];
    return [];
  })().map((s) => s.sessionId).filter((x): x is string => !!x);
  const tailKey = tailIds.join(',');
  useEffect(() => {
    if (!tailKey) return;
    let alive = true;
    const big = pick.startsWith('p:');
    const tick = () => void readTranscriptTails(tailKey.split(',')).then((m) => {
      if (!alive) return;
      setTails((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(m)) next[k] = termTail(v, big ? 40 : 8);
        return next;
      });
    }).catch(() => {});
    tick();
    const id = window.setInterval(tick, 3000);
    return () => { alive = false; window.clearInterval(id); };
  }, [tailKey, pick.slice(0, 2)]); // eslint-disable-line react-hooks/exhaustive-deps
  // 참모 대시보드 노트 — 참모 할 일 목록(TaskCreate) + HQ starter 최근 결정. 보고 있을 때 5초마다(v11 X)
  const [note, setNote] = useState<NoteBase | null>(null);
  const noteOrch = pick.startsWith('o:') ? orchs.find((x) => x.id === pick.slice(2)) ?? orch : undefined;
  const [hasStarter, setHasStarter] = useState(false);
  useEffect(() => {
    setNote(null);
    if (!noteOrch) return;
    let alive = true;
    const tick = async () => {
      const tasks = noteOrch.sessionId ? await readSessionTasks(noteOrch.sessionId).catch(() => []) : [];
      const md = await invoke<string>('read_doc_text', { path: `${projectRoot(noteOrch.cwd)}/docs/starter.md` }).catch(() => '');
      if (alive) setHasStarter(md !== ''); // 공개판 HQ 엔 starter 가 없다 — 없는 문서를 여는 버튼은 숨긴다(0.2.0 검증)
      if (alive) setNote({ tasks: tasks.map((t) => ({ id: t.id, text: t.subject, done: t.status === 'completed' })), decisions: starterLists(md).decisions });
    };
    void tick();
    const id = window.setInterval(() => void tick(), 5000);
    return () => { alive = false; window.clearInterval(id); };
  }, [noteOrch?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 프로젝트 대시보드 위 목록 — 세션 할 일(지금 하는 것 먼저) + starter "다음 할 일"·"최근 결정". 보고 있을 때 5초마다
  const [plists, setPlists] = useState<DashLists | null>(null);
  const proot = pick.startsWith('p:') ? pick.slice(2) : '';
  useEffect(() => {
    setPlists(null);
    if (!proot) return;
    let alive = true;
    const tick = async () => {
      const g = groups.find((x) => x.root === proot);
      const src = `${proot}/docs/starter.md`;
      const md = await invoke<string>('read_doc_text', { path: src }).catch(() => '');
      const fromStarter = starterLists(md);
      const tasks = (await Promise.all((g?.sessions ?? []).filter((x) => x.sessionId).map(async (x) =>
        (await readSessionTasks(x.sessionId!).catch(() => [])).filter((t) => t.status !== 'completed').map((t) => ({ text: t.status === 'in_progress' && t.activeForm ? t.activeForm : t.subject, doing: t.status === 'in_progress', by: x.workspace ?? tr('본체', 'main') }))))).flat();
      tasks.sort((a, b) => Number(b.doing) - Number(a.doing));
      if (alive) setPlists({ todo: [...tasks, ...fromStarter.todo.map((text) => ({ text }))], decisions: fromStarter.decisions, source: md ? src : undefined });
    };
    void tick();
    const id = window.setInterval(() => void tick(), 5000);
    return () => { alive = false; window.clearInterval(id); };
  }, [proot]); // eslint-disable-line react-hooks/exhaustive-deps
  // 도우미·프로젝트 밖 세션은 프로젝트 이름(=HQ 폴더 이름) 대신 세션 이름으로 — 'honor-orchestrator' 로만 떠서 누가 누군지 몰랐다(2026-10-02)
  const sideIds = new Set([...helpers, ...loose].map((x) => x.id));
  const cardName = (s: Session) => (sideIds.has(s.id) && s.name ? s.name : nameOf(s));
  // 세션 브라우저(참모 브라우저 래퍼 상태) — 세션 칸·세션 화면·참모 대시보드가 브라우저 화면으로(2026-10-03 사용자)
  const lives = useAgentLives();
  const lineOf = (s: Session, name: string): DashLine => ({ id: s.id, name, ...paneState(s, live[s.id]), ...(live[s.id]?.st ? { st: live[s.id]!.st } : {}), line: live[s.id]?.line ?? '', tail: s.sessionId ? tails[s.sessionId] : undefined, browser: liveOf(s, lives) });

  const cur = pick.startsWith('s:') ? sessions.find((s) => s.id === pick.slice(2)) : undefined;
  // 채팅에 붙이기 — 지금 채팅 탭 참모 입력칸에(끌어다 놓기와 같게)
  const attach = (path: string) => {
    if (!chatOrch) return;
    if (!path.startsWith('data:')) { attachToChat(chatOrch.id, [path]); return; }
    // 경로 없는 그림(채팅에 붙인 그림) — 파일로 저장한 뒤 그 경로로 붙인다
    const m = path.match(/^data:image\/(\w+);base64,(.*)$/);
    if (!m) return;
    const bytes = Array.from(Uint8Array.from(atob(m[2]!), (c) => c.charCodeAt(0)));
    void invoke<string>('save_attach', { name: `pasted.${m[1] === 'jpeg' ? 'jpg' : m[1]}`, bytes }).then((p) => attachToChat(chatOrch.id, [p])).catch(() => {});
  };
  // 세션 칸의 진짜 터미널 — 직접 칠 수 있다(대화형 세션은 터미널 뷰에서만)
  const termOf = (id: string) => {
    const s = sessions.find((x) => x.id === id);
    if (!s || s.kind !== 'background') return <div className="cv-blank">{tr('이 세션은 터미널 뷰에서만', 'Terminal view only')}</div>;
    return <TerminalPane key={s.id} command={attachCommand(claudeBin, s.id)} title={nameOf(s)} subtitle={s.name} fontSize={fontSize} linkBase={s.cwd} home={home} />;
  };
  const openFileRef = useRef<(p: string) => void>(() => {});
  const openFile = (path: string, by = '') => {
    const f = { path, ts: new Date().toISOString(), by };
    if (now.current.pick === OFFICE) { if (kindOf(path) === 'md') openSheet(`d:${path}`); else showOver(f); return; } // 사무실 위 창 안에서 연 것도 사무실 위
    if (kindOf(path) === 'md') { setPick(`d:${path}`); return; }
    setModal(f);
  };

  openFileRef.current = (p) => openFile(p);
  // 시안 검토 모드 — 검토용 시안(큐레이션)이 열리면 모달 대신 스페이스 전체로, 닫으면 보던 화면으로
  const beforeCur = useRef('');
  // 하니터 — 탭(참모)마다 열기 전 화면을 따로 기억한다(한 탭에서 연 기억이 다른 탭 닫기에 섞이지 않게)
  const beforeH = useRef(new Map<string, string>());
  // 탭마다 하니터 안에서 고른 것 — 다른 탭 다녀오면 되살린다
  const hSel = useRef(new Map<string, HarnitorSel>());
  const harnitorTo = (req: 'open' | 'close' | 'toggle') => {
    const key = orch?.id ?? '';
    const r = harnitorPick(pick, req, beforeH.current.get(key) ?? '', orch ? `o:${orch.id}` : '');
    beforeH.current.set(key, r.before);
    if (r.pick !== pick) setPick(r.pick, 'harnitor');
    if (pick === 'h:' && r.pick !== 'h:') onHarnitorClosed?.();
  };
  useEffect(() => { if (harnitorReq) { harnitorTo(harnitorReq); onHarnitorReq?.(); } }, [harnitorReq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onHarnitorShown?.(pick === 'h:'); }, [pick]); // eslint-disable-line react-hooks/exhaustive-deps
  // 도구 — 위 막대 아이콘으로(2026-10-05 사용자, 사이드바 줄에서 옮김). 프로젝트 대시보드 안 '도구'(t:<폴더>)도 열린 것으로 친다
  const beforeT = useRef(new Map<string, string>());
  const toolsTo = (req: 'open' | 'close' | 'toggle') => {
    const key = orch?.id ?? '';
    const r = toolsPick(pick, req, beforeT.current.get(key) ?? '', orch ? `o:${orch.id}` : '');
    beforeT.current.set(key, r.before);
    if (r.pick !== pick) setPick(r.pick, 'tools');
    if (pick.startsWith('t:') && !r.pick.startsWith('t:')) onToolsClosed?.();
  };
  useEffect(() => { if (toolsReq) { toolsTo(toolsReq); onToolsReq?.(); } }, [toolsReq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onToolsShown?.(pick.startsWith('t:')); }, [pick]); // eslint-disable-line react-hooks/exhaustive-deps
  // 리뷰 — 위 막대 아이콘으로(2026-10-06 사용자, 사이드바 줄에서 옮김). PR 하나를 고른 화면(rv:<키>)도 열린 것
  const beforeRv = useRef(new Map<string, string>());
  const reviewTo = (req: 'open' | 'close' | 'toggle') => {
    const key = orch?.id ?? '';
    const r = reviewPick(pick, req, beforeRv.current.get(key) ?? '', orch ? `o:${orch.id}` : '');
    beforeRv.current.set(key, r.before);
    if (r.pick !== pick) setPick(r.pick, 'review');
  };
  useEffect(() => { if (reviewReq) { reviewTo(reviewReq); onReviewReq?.(); } }, [reviewReq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onReviewShown?.(pick.startsWith('rv:')); }, [pick]); // eslint-disable-line react-hooks/exhaustive-deps
  // 지금 보는 화면(viewNow) — 왼쪽 스페이스와 그 위 미리보기
  useEffect(() => {
    const names = { orch: (id: string) => orchs.find((o) => o.id === id)?.name, session: (id: string) => sessions.find((x) => x.id === id)?.name, home: home ?? "" };
    // 사무실 위 창도 '위에 뜬 것'으로 — 사용자가 "이거"라고 하면 참모가 창 속 세션·문서를 알아듣게
    const top = pick === OFFICE ? sheet[sheet.length - 1] : undefined;
    reportView({ tab: orchs.find((o) => o.id === nav.chat)?.name ?? chatOrch?.name, space: spaceWord(pick, names), preview: modal ? spaceWord(`d:${modal.path}`, names).replace(/^\S+ /, '') : top ? spaceWord(top, names) : undefined });
  });
  // 검토 결과는 시안을 띄운 참모에게 — 지금 채팅 탭 참모에게 보내니 개발 참모가 띄운 시안 결과가 다른 참모에게 갔다(2026-09-30 사용자 "버그네")
  const curBy = useRef(new Map<string, string>());
  const toCuration = (p: string, by?: string) => { setModal(null); if (by) curBy.current.set(p, by); if (!pick.startsWith('c:')) beforeCur.current = pick; setPick(`c:${p}`); };
  const curOwner = (p: string) => { const by = curBy.current.get(p) ?? ''; const id = orchs.some((o) => o.id === by) ? by : holders.get(by)?.[0]; return orchs.find((o) => o.id === id); };
  /** 문서 화면 — 스페이스 가운데(d:)와 사무실 위 창이 같은 것을 쓴다. onBack = 뒤로(upKey = 위 칸), tail = 머리 끝(창의 크게·닫기) */
  const docPage = (path: string, opt: { onBack?: (upKey: string) => void; tail?: React.ReactNode }) => {
    const owner = orchs.find((o) => isPinned(o, path) || orchDocs(log, o.id, []).recent.includes(path));
    const g = groups.find((x) => path.startsWith(`${x.root}/`));
    // 뒤로 = 상위(노션처럼): 하위 페이지면 부모 페이지, 내 페이지면 내 페이지 첫 화면, 그 밖은 주인 대시보드(2026-09-30 사용자)
    const parentPage = pages.includes(path) ? `${path.replace(/\/[^/]+$/, '')}.md` : '';
    const upKey = parentPage && pages.includes(parentPage) ? `d:${parentPage}` : pages.includes(path) ? 'm:' : owner ? `o:${owner.id}` : g ? `p:${g.root}` : chatOrch ? `o:${chatOrch.id}` : '';
    const upName = parentPage && pages.includes(parentPage) ? pageName(parentPage) : pages.includes(path) ? tr('내 페이지', 'My pages') : owner ? oname(owner) : g ? g.name : path.split('/').slice(-2, -1)[0] ?? '';
    // 문서를 볼 땐 대시보드·사무실 토글을 안 띄운다 — 돌아가기는 왼쪽 '참모 이름' 알약(2026-10-03 사용자)
    return <DocPage key={path} path={path} at={focus?.path === path ? focus.at : undefined} atKey={focus?.path === path ? focus.key : undefined} title={pages.includes(path) ? pageName(path) : undefined} owner={upName} send={send} sendTo={sendTo} onBack={opt.onBack ? () => opt.onBack!(upKey) : undefined} tail={opt.tail}
      pinned={owner ? isPinned(owner, path) : undefined} onPin={owner ? () => togglePin(owner, path) : undefined}
      onTitle={(t) => { if (pages.includes(path)) setTitle(path, t); window.dispatchEvent(new CustomEvent(PAGE_TITLE, { detail: { path, title: t } })); }} onAttach={() => attach(path)}
      onOpenPath={(p) => openFile(p)}
      onNewSubpage={pages.includes(path) ? () => invoke<string>('new_page', { title: tr('새 페이지', 'Untitled'), parent: path }).then((p) => { void loadPages(); return p; }) : undefined} />;
  };
  /** 세션 칸 속 — 진짜 터미널(브라우저 쓰면 브라우저 화면 + 아래 터미널) + 보여 준 파일. 스페이스 세션 화면과 사무실 위 창이 같은 것 */
  const sessionInner = (x: Session) => (
    <>
      {(() => {
        const term = x.kind === 'background'
          ? <div className="cv-term"><TerminalPane key={x.id} command={attachCommand(claudeBin, x.id)} title={nameOf(x)} subtitle={x.name} fontSize={fontSize} linkBase={x.cwd} home={home} /></div>
          : <div className="cv-blank">{tr('이 세션은 터미널 뷰에서만 볼 수 있어요', 'This session can only be viewed in the terminal view')}</div>;
        // 브라우저를 쓰면 화면 크게 + 아래 터미널(직접 칠 수 있는 그대로), 조용해지면 터미널이 다시 크게
        const b = liveOf(x, lives);
        return b ? <AgentBrowser live={b} className="ab-page">{term}</AgentBrowser> : term;
      })()}
      {shownFiles(log, x.id).length > 0 && (
        <div className="cv-chips"><span>{tr('보여 준 파일', 'Shown files')}</span>
          {shownFiles(log, x.id).map((f) => <button key={f.path} {...dragPath(f.path)} className="cv-chip" onClick={() => openFile(f.path, x.id)} title={f.path}>{f.path.split('/').pop()}</button>)}</div>
      )}
    </>
  );
  let main: React.ReactNode = null;
  // 있던 프로젝트(clone)에 이 프로젝트 브라우저가 없으면 — 깔려 있고 안 붙었을 때만 보인다(GitHub #2)
  const browserBtn = (root: string, running: number) => <BrowserAttachButton key={`b:${root}`} dir={root} running={running} className="cv-btn" onDone={(m) => onMessage?.(m)} />;
  const toolsBtn = (root: string) => <button className="cv-btn" onClick={() => setPick(`t:${root}`)} title={tr('MCP·플러그인·스킬', 'MCP, plugins and skills')}>{tr('도구', 'Tools')}</button>;
  // 오케스트레이터 홈 — 머리를 눌렀거나('oh:'), 참모가 하나도 없는데 참모 화면을 보려던 참(2026-10-03 사용자)
  const atHome = pick === HOME || (!orchs.length && (pick === '' || pick.startsWith('o:') || pick === OFFICE));
  const seg = office ? <SideSeg office={pick === OFFICE} onPick={officeTo} /> : null;
  // 그 참모 대시보드·펫·사무실 — 세 칸 하나를 cv-main 오른쪽 위 한 자리에(아래 main 밖에 그린다)
  const side = orch && (office || pet) ? spaceView(pick, petFor, orch.id) : null;
  const pickSide = (want: SpaceSide) => {
    if (!orch) return;
    if (want === 'office') { officeTo('office'); return; }
    setPetFor(want === 'pet' ? orch.id : null);
    if (pick === OFFICE) officeTo('space');
    if (pick !== `o:${orch.id}` && pick !== OFFICE) setPick(`o:${orch.id}`);
  };
  const viewSeg = side && !atHome ? <ViewSeg side={side} pet={!!pet} office={!!office} onPick={pickSide} /> : null;
  if (atHome && orchHome) {
    main = orchHome((id) => { const o = orchs.find((x) => x.id === id); if (!o) return; setPick(homeOf(o)); setNav({ view: id, chat: id }); onChatTab?.(id); });
  } else if (pick === OFFICE && office && orch) {
    // 책상·카드 = 사무실 위 창에 그 세션 칸(사무실을 떠나지 않음, 오피스 A 1단계), 참모 책상 = 그 참모 채팅 탭. 지금 탭 참모가 시킨 세션만 이름표·현황판 진하게
    const mine = new Set([orch.id, ...heldBy(orch).map((s) => s.id)]);
    const top = sheet[sheet.length - 1];
    main = (
      <div className="cv-office">
        {office((id) => { const t = deskTarget(id, orchIds, orch.id); if (!t) return; if ('tab' in t) onChatTab?.(t.tab); else setSheet([t.sheet]); }, (id) => !mine.has(id))}
        {top && (() => {
          const icons = <SheetIcons onBack={sheet.length > 1 ? () => setSheet(sheetBack) : undefined} onBig={() => setPick(top)} onClose={() => setSheet([])} />;
          const s = top.startsWith('s:') ? sessions.find((x) => x.id === top.slice(2)) : undefined;
          const body = top.startsWith('d:') ? docPage(top.slice(2), { tail: icons })
            : s ? (
              <div className="cv-session">
                <header className="osh-bar">
                  <b>{nameOf(s)}</b><StateMark st={statusOf(s)} /><span className="osh-meta">{[s.name && s.name !== nameOf(s) ? s.name : '', stateWord(s)].filter(Boolean).join(' · ')}</span>
                  <span className="cv-sp" />{icons}
                </header>
                {sessionInner(s)}
              </div>
            ) : <div className="cv-session"><header className="osh-bar"><span className="osh-meta">{tr('세션이 꺼졌어요', 'Session ended')}</span><span className="cv-sp" />{icons}</header></div>;
          return <OfficeSheet key={top} label={s ? nameOf(s) : top.slice(2).split('/').pop() ?? ''} onClose={() => setSheet([])}>{body}</OfficeSheet>;
        })()}
      </div>
    );
  } else if (pick.startsWith('o:')) {
    const o = orchs.find((x) => x.id === pick.slice(2)) ?? orch;
    const held = heldBy(o);
    const files = o ? dashFiles(log, o.id, held.map((s) => s.id), o.id === orch?.id ? myImages : []).slice(0, 40).map((f) => ({ ...f, byName: who(f.by) })) : [];
    main = o ? (
      <DashboardView key={o.id} browser={(() => { const b = liveOf(o, lives); return b ? { live: b, tail: o.sessionId ? tails[o.sessionId] : undefined } : undefined; })()} pet={pet ? { on: petFor === o.id, node: pet((id) => { const x = orchs.find((y) => y.id === id); return x ? { name: x.name || '', color: colorOf(x.name || '') } : null; }) } : undefined}
        title={oname(o)} titleNode={<OrchName s={o} />} avatar={act ? (
        <button className="oa-btn" onClick={() => act.askAvatar(o, colorOf(o.name || ''))} aria-label={tr(`${oname(o)} 프로필 바꾸기`, `Change ${oname(o)}'s avatar`)}>
          <OrchAvatar name={o.name || ''} size={44} state={avatarState(o)} color={colorOf(o.name || '')} label={oname(o)} /><span className="oa-change" aria-hidden="true">{tr('바꾸기', 'Change')}</span>
        </button>
      ) : <OrchAvatar name={o.name || ''} size={44} state={avatarState(o)} color={colorOf(o.name || '')} label={oname(o)} />} onTitleEdit={act ? () => act.askRename(o) : undefined}
        under={<AgentList key={o.id} sid={o.sessionId} agents={agentsOf.current.get(o.id) ?? []} />}
        aside={<NotePanel base={note} storeKey={`noteEdits:${o.name || o.id}`} sendTo={oname(o)} onOpenStarter={hasStarter ? () => setPick(`d:${projectRoot(o.cwd)}/docs/starter.md`) : undefined}
          send={async (text) => { window.dispatchEvent(new CustomEvent('chat-pending', { detail: { id: o.id, text } })); await sendTextToSession(o.id, text); }} />}
        meta={[orchRoleOf(o.name || '')?.text, tr(`${stateWord(o)} · 맡긴 세션 ${held.length}`, `${stateWord(o)} · ${held.length} delegated`)].filter(Boolean).join(' · ') /* 맡은 일이 맨 앞(이름 밑 회색 줄, 2026-10-04) */} 
        files={files} lines={held.map((s) => lineOf(s, cardName(s)))}
        onStop={act ? (id) => { const s = held.find((x) => x.id === id); if (s) act.askStop(s, cardName(s)); } : undefined}
        hint={<>
          <div className="cv-hints">
            {tasks && <UnclosedTasks cards={unclosedOf(tasks.orphaned, events, o.id, tasks.known)} nameOf={(t) => targetLabel(t, tasks.known)} canResume={tasks.canResume} onResume={tasks.onResume} onFinish={tasks.onFinish} />}
          </div>
          {orphans.length > 0 && (
          <div className="cv-orphans">
            <div className="cv-orphans-head"><b>{tr(`누가 시켰는지 모르는 일 ${orphans.length}`, `${orphans.length} tasks with no owner`)}</b>
              <span>{tr(`기록에 시킨 ${josa(assistant(), '이', '가')} 안 남은 옛 일이야 — 이 ${assistant()} 것으로 붙이거나 끝난 걸로 정리해 줘`, 'Old tasks with no recorded owner — claim them or mark done')}</span></div>
            {orphans.map((x) => (
              <div key={x.task} className="cv-orphan">
                <b>{x.target}</b><span>{x.title ?? ''}</span><em>{new Date(x.ts).toTimeString().slice(0, 5)}</em>
                <button onClick={() => void appendTaskEvent({ ts: new Date().toISOString(), type: 'own', task: x.task, from: o.id }).catch(() => {})}>{tr(`${o.name || '참모'} 일로`, `Claim for ${o.name || 'assistant'}`)}</button>
                <button onClick={() => void appendTaskEvent({ ts: new Date().toISOString(), type: 'done', task: x.task, note: tr('사용자가 대시보드에서 정리', 'Tidied from dashboard') }).catch(() => {})}>{tr('끝난 걸로', 'Mark done')}</button>
              </div>
            ))}
          </div>
          )}
        </>}
        onOpenSession={(id) => setPick(id === o.id ? `o:${id}` : `s:${id}`)} onOpenDoc={(p) => setPick(`d:${p}`)} onAttach={attach} onSendText={send} onCuration={toCuration} term={termOf}
        emptyText={tr(`아직 없어요 — ${josa(assistant(), '이나', '나')} 맡긴 세션이 띄워 주면 여기 모여요`, 'Nothing yet — shown files gather here')} />
    ) : null;
  } else if (pick.startsWith('p:')) {
    const g = groups.find((x) => x.root === pick.slice(2));
    const files = g ? g.sessions.flatMap((s) => shownFiles(log, s.id).map((f) => ({ ...f, by: s.id, byName: s.workspace ?? s.project }))).sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 40) : [];
    main = g ? (
      <DashboardView key={g.root} work title={g.name} meta={tr(`세션 ${g.sessions.length} · ${g.root}`, `${g.sessions.length} sessions · ${g.root}`)}
        headAction={<>{toolsBtn(g.root)}{browserBtn(g.root, g.sessions.length)}{onNewSession && <button className="cv-btn" onClick={() => onNewSession(g.root, g.name)}>{tr('새 세션', 'New session')}</button>}</>}
        onStop={act ? (id) => { const s = g.sessions.find((x) => x.id === id); if (s) act.askStop(s, s.workspace ? `${g.name} / ${s.workspace}` : tr(`${g.name} 본체`, `${g.name} (main)`)); } /* 세션이 여럿이면 어느 것인지 보이게 */ : undefined}
        files={files} lines={g.sessions.map((s) => lineOf(s, s.workspace ?? tr('본체', 'main')))}
        lists={plists ?? undefined} onOpenSession={(id) => setPick(`s:${id}`)} onOpenDoc={(p) => setPick(`d:${p}`)} onAttach={attach} onSendText={send} onCuration={toCuration} term={termOf} emptyText={tr('이 프로젝트 세션이 보여 준 파일이 여기 모여요', "Files this project's sessions show gather here")} />
    ) : (() => {
      // 세션이 안 떠 있는 프로젝트 — 할 일·결정은 그대로 보고, 꺼진 세션 이어서 켜기·새 세션
      const root = pick.slice(2);
      const name = idle.find((x) => x.root === root)?.name ?? root.split('/').pop() ?? root;
      const off = stopped.filter((x) => projectRoot(x.cwd) === root);
      return (
        <DashboardView key={root} work title={name} meta={tr(`쉬는 중 · ${root}`, `Idle · ${root}`)} headAction={<>{toolsBtn(root)}{browserBtn(root, 0)}</>} files={[]} lines={[]} lists={plists ?? undefined}
          onOpenSession={() => {}} onOpenDoc={(p) => setPick(`d:${p}`)} emptyText=""
          hint={
            <div className="cv-idle">
              <div className="cv-idle-row"><b>{tr('떠 있는 세션이 없어요', 'No running sessions')}</b>
                {onNewSession && <button className="cv-btn solid" onClick={() => onNewSession(root, name)}>{tr('새 세션 열기', 'Start a session')}</button>}</div>
              {off.map((x) => (
                <div key={x.id} className="cv-idle-row off"><span>{x.name || x.project}{x.workspace ? ` / ${x.workspace}` : ''}</span><em>{x.reason === 'failed' ? tr('비정상 종료', 'Crashed') : x.reason === 'done' ? tr('끝남', 'Done') : tr('끔', 'Stopped')}</em>
                  {onResume && <button className="cv-btn" onClick={() => onResume(x)}>{tr('이어서 켜기', 'Resume')}</button>}</div>
              ))}
            </div>
          } />
      );
    })();
  } else if (pick === 'rv:' || pick.startsWith('rv:')) {
    // 리뷰 — 세션 열기는 스페이스 안에서 그 세션 화면으로
    main = reviewPage?.(pick.slice(3) || undefined, (k) => setPick(`rv:${k}`), (t) => { const s = findTarget(sessions, t); if (s) setPick(orchs.some((o) => o.id === s.id) ? `o:${s.id}` : `s:${s.id}`); }) ?? null;
  } else if (pick.startsWith('r:')) {
    main = routinePage?.(pick.slice(2), () => setPick(chatOrch ? `o:${chatOrch.id}` : ''), chatOrch ? (text) => window.dispatchEvent(new CustomEvent(CHAT_INSERT, { detail: { id: chatOrch.id, text } })) : undefined) ?? null; // 지우면 참모 화면으로 — '찾을 수 없어요'에 남지 않게
  } else if (pick.startsWith('t:')) {
    // 도구 — 기준 폴더는 고른 프로젝트, 없으면 채팅 탭 참모 HQ(2026-10-04 사용자)
    const root = pick.slice(2) || chatOrch?.cwd || orchCwd;
    const hq = orchCwd ? [{ name: tr(`${assistant()} HQ`, `${assistant()} HQ`), root: orchCwd }] : [];
    const roots = [...hq, ...groups.map((g) => ({ name: g.name, root: g.root })), ...idle].filter((r, i, a) => a.findIndex((x) => x.root === r.root) === i);
    main = <ToolsPage key={root} root={root} roots={roots} onRoot={(r) => setPick(`t:${r}`)}
      sessions={sessions.filter((s) => s.cwd === root || s.cwd.startsWith(`${root}/`))}
      onInvoke={chatOrch ? (name) => window.dispatchEvent(new CustomEvent(CHAT_INSERT, { detail: { id: chatOrch.id, text: `/${name}` } })) : undefined}
      onOpen={(p) => setPick(`d:${p}`)} computerUse={computerUse} />;
  } else if (pick === 'm:') {
    main = <PagesHome pages={pages} titleOf={pageName} onOpen={(p) => setPick(`d:${p}`)} onNew={newPage} />;
  } else if (pick.startsWith('d:')) {
    main = docPage(pick.slice(2), { onBack: (upKey) => step(-1, upKey) });
  } else if (cur) {
    main = (
      <div className="cv-session">
        <header className="cv-page-head small">
          <div className="cv-titles"><h1>{nameOf(cur)} <StateMark st={statusOf(cur)} /></h1><p>{cur.name} · {stateWord(cur)} · {cur.cwd}</p></div>
          {seg && <div className="cv-head-act">{seg}</div>}
        </header>
        {sessionInner(cur)}
      </div>
    );
  } else {
    main = <div className="cv-blank">{tr('왼쪽 메뉴에서 골라 줘', 'Pick something from the menu')}</div>;
  }

  return (
    <div className="space cv">
      {menuOpen && (
        <SpaceNav statusOf={statusOf} orchPins={orchPins} onNewOrch={onNewOrch} routines={routines} onTrashPage={(p) => void invoke('trash_page', { path: p }).then(() => { if (pick === `d:${p}` || pick.startsWith(`d:${p.replace(/\.md$/, '')}/`)) setPick('m:'); loadPages(); }).catch(() => {})} idle={idle} offOrchs={stoppedOrchs(stopped, orchCwd, orchs)} stoppingIds={stoppingIds} startingOrchs={startingOrchs} helpers={helpers} loose={loose} onChatTab={onChatTab} ctxOf={ctxOf} onAddProject={onAddProject} onResume={onResume} onRemoveStopped={onRemoveStopped ? (x) => sameOrchSlot(stopped, x, orchCwd).forEach((y) => onRemoveStopped(y)) : undefined} orchs={orchs} viewId={orch?.id} colorOf={colorOf} projects={groups} holders={holders} pick={pick}
          onPick={(k, orchId) => { const o = orchId ? orchs.find((x) => x.id === orchId) : undefined; setPick(navPick(k, orchId, orch?.id, o ? homeOf(o) : k)); if (orchId) setNav((n) => ({ ...n, view: orchId })); }}
          orchDocsOf={(o) => orchDocs(log, o.id, pins[pinKey(o)] ?? [])} isPinned={isPinned} onTogglePin={togglePin}
          pagesRoot={pagesRoot} pages={pages} pageTitle={pageName} onNewPage={newPage}
          onOpenFile={(p) => (kindOf(p) === 'md' ? setPick(`d:${p}`) : openFile(p))} /* 메뉴는 '그 화면으로 가기' — 사무실에서 눌러도 문서 페이지로 */ selectedFile={pick.startsWith('d:') ? pick.slice(2) : modal?.path} />
      )}
      <main className={`cv-main ${viewSeg && !hold ? 'has-viewseg' : ''}`}>
        {hold ? null : main}
        {hold ? null : viewSeg}
        {notice && (() => {
          const o = orchs.find((x) => x.id === notice.id);
          if (!o) return null;
          return (
            <div className="cv-notice" role="status">
              <span>{tr(`${josa(oname(o), '이', '가')} 띄웠어`, `${oname(o)} opened`)} · <b>{notice.path.split('/').pop()}</b></span>
              <button className="cv-btn" onClick={() => { setNotice(null); switchTo(o.id, 'notice'); onChatTab?.(o.id); }}>{tr('보기', 'Open')}</button>
              <button className="ib" onClick={() => setNotice(null)} aria-label={tr('닫기', 'Dismiss')} title={tr('닫기', 'Dismiss')}><IconClose /></button>
            </div>
          );
        })()}
        {switching && <div className="cv-switch" aria-live="polite"><span className="cv-spin" /><b>{tr(`${oname(orchs.find((x) => x.id === switching) ?? orch!)} 불러오는 중`, `Loading ${switching}`)}</b></div>}
      </main>
      {modal && <Preview f={modal} onClose={() => setModal(null)} onAttach={() => attach(modal.path)} onSendText={send} onCuration={toCuration} />}
      {pick.startsWith('c:') && (() => { const own = curOwner(pick.slice(2)); const to = own ?? chatOrch; return <CurationMode key={pick} path={pick.slice(2)} sendTo={own ? oname(own) : sendTo ?? assistant()} color={to ? bodyColor(avatars, to.name || '', colorOf(to.name || '')) : undefined}
        onSend={own ? async (text) => { window.dispatchEvent(new CustomEvent('chat-pending', { detail: { id: own.id, text } })); await sendTextToSession(own.id, text); } : send} onClose={() => setPick(beforeCur.current || (orch ? `o:${orch.id}` : ''))} />; })()}
      {pick === 'h:' && <HarnitorPanel key={orch?.id} onClose={() => harnitorTo('close')} restore={hSel.current.get(orch?.id ?? '')} onView={(v) => hSel.current.set(orch?.id ?? '', v)} />}
    </div>
  );
}
