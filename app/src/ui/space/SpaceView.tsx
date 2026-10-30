import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { appendTaskEvent, readSessionTasks, readTranscriptTails, sendTextToSession, spaceTrace, spawnLines } from '../../data/tauri';
import { craftTarget, keepScroll, queueShow, restoreTop, SCROLL_PANES, scrollKey, showBatch, traceLine } from '../../domain/spaceJump';
import { dashFiles, ownBrowserLine, paneState, type DashFile } from '../../domain/dashboard';
import { findTarget } from '../../domain/inbox';
import { isSheet, kindOf, spacePage, titleOf } from '../../domain/reader';
import { seenName, type Session } from '../../domain/session';
import { sameOrchSlot, stoppedOrchs } from '../../domain/stopped';
import { foldAgents, pruneAgents, type SubAgent } from '../../domain/subAgents';
import { addSpawned, dashToggle, leaveHomeFor, ownPick, screenBeforeHome, featureOf, featurePick, focusPick, focusTab, holderMap, legacyPick, newShows, sidePick, type FeatureKey, orphanSends, shownFiles, showOwner, transcriptTargets } from '../../domain/spaceNav';
import { orchDocs, pinPaths, projectGroups, remapPins } from '../../domain/spaceTree';
import { holdRelease, spaceSwapDelay } from '../../domain/switchHold';
import { docKeepLimit } from '../../domain/docKeep';
import { folderChip } from '../../domain/drop';
import { useDocKeep } from './docKeep';
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
import type { DashLine, DashLists, LiveLine } from './DashboardView';
import { AgentList } from './AgentList';
import { DocPage } from './DocPage';
import { SheetPage } from './SheetPage';
import type { ShowAt } from '../../domain/showAt';
import { ToolsPage } from './ToolsPage';
import { CurationMode } from './CurationMode';
import { HarnitorPanel } from '../HarnitorPanel';
import type { HarnitorSel } from '../../domain/harnitor';
import { pathWord, spaceWord } from '../../domain/viewNow';
import { reportView } from '../viewReport';
import { OPEN_PAGE, PAGE_TITLE } from './PageBlock';
import { Preview } from './Preview';
import { CHAT_INSERT, dragPath } from './dragPath';
import { useShowLog } from './useShowLog';
import { CraftPane } from '../craft/CraftPane';
import { BrowserPane } from './BrowserPane';
import { browserDock, browserKey, browserOfPick, closeAsk, dockTitleOf, hqBrowserHome, paneTarget, stillClosed, wentAway, type BrowserDockItem } from '../../domain/browserDock';
import { Confirm } from '../OrchDialogs';
import { CraftDrawer } from '../craft/CraftDrawer';
import { APPS_KEY, BROWSER_ICON_SMALL } from '../../domain/craftDrawer';
import { craftOwner, forgetCraftOwner, setCraftOwner } from '../craftOwner';
import { craftAppOf, craftGone, craftKey, craftBase, dropCraftEverywhere, GONE_TICKS, leftCraft } from '../../domain/craftTab';
import { craftToTeam, fromTeamCraft } from '../../domain/teamCraft';
import { craftOwnerOf, dockFor, dockLetter, dockNo, dockTitle, drawerOpen, recentLabel, type DockItem } from '../../domain/craftDock';
import { CHAT_FILE_OPEN, imageFile } from '../chat/openChatFile';
import { craftFirst } from '../../domain/craftOpen';
import { openInCraft, sayCraftErr } from '../craft/openInCraft';
import { cardMoves } from '../../domain/chatFiles';
import { attachToChat } from '../fileDrop';
import { StateMark } from './StateMark';
import { sessionStatus, statusWord, type ActivityStatus } from '../../domain/status';
import { useOrchActions } from '../orchActions';
import { orchRoleOf, useOrchRoleData } from '../orchRoleStore';
import { NotePanel } from './NotePanel';
import { ModeHome, ModeLayer, ModePanel, useModeRows } from '../mode/ModePanel';
import { HomeView } from './HomeView';
import { HomeProgress } from '../GoalProgress';
import { setModeChatHere, setModeDashHere } from '../mode/modeBus';
import type { NoteBase } from '../../domain/noteEdits';
import { projectRoot } from '../../domain/spaceTree';
import './space.css';
import { attachCommand } from '../../domain/termCommand';
import type { RoutineItem } from '../../domain/routine';
import { bodyColor, orchColor } from '../../domain/avatar';
import { OrchAvatar, avatarState, useAvatars } from '../avatar';
import { EMPTY_NAV, goBack, goForward, keyFallback, visit, type Nav } from '../../domain/navHistory';
import { SPACE_CMD, SPACE_NAV, type SpaceCmd } from './navSignal';
import { TabZoomBar } from './TabZoomBar';
import { FIT } from '../../domain/readerZoom';
import { fitZoom, nextTabZoom, parseTabZooms, tabZoomable, tabZoomOf, TAB_ZOOM_KEY, withTabZoom, type TabZooms, type ZoomCmd } from '../../domain/tabZoom';
import { markAnchor, useWheelZoom } from '../zoomAnchor';
import { keyLabel } from '../../domain/keys';
import { IS_WIN } from '../../domain/reader';
import { deskTarget, homeDeskTarget, homeOfficeOrch, OFFICE, officePick, rememberSide, sheetBack, sheetOpen, showPick, spaceView, startPick, type Side, type SpaceSide } from '../../domain/spaceOffice';
import { OfficeSheet, SheetIcons } from '../office/OfficeSheet';
import { HOME_PICK as HOME } from '../../domain/orchHome';
import type { HomeGo } from './HomeDash';
import { IconClose, IconDashboard, IconDownload, IconFolder, IconHome, IconOffice, IconPet, IconApps } from '../Icons';
import { isTeamCache } from '../../domain/teamLocker';
import { attachWhenReady, publishRoster, useGivePath, type GiveReq } from '../team/teamGive';
import { BubbleFloatCtx, publishFace, useOrchBubble, type BubbleOrch } from './OrchBubble';
import { bubbleFace } from '../../domain/orchBubble';
import { IconButton } from '../kit/IconButton';
import { BrowserAttachButton } from '../BrowserAttach';
import { every } from '../poll';
import { editedAfterOpen } from '../../domain/locker';
import { lkPick, isLockerOpen, parseLkPick, userFolders, type LkPlace } from '../../domain/lockerTree';
import { lockerLog } from '../../domain/lockerLog';
import { closeCurrentTab, closeTab, leaveFolder, newDocFolder, openReview, openTab, reclickPick, reviewKey, swapHold, pathLine, showInTab, tabPick, tabRow, type LkHold } from '../../domain/lockerTabs';
import { isCurationHtml } from '../../domain/curation';
import { projectOf } from '../../domain/lockerLog';
import { FileTab } from './FileTab';
import { TabStrip } from './TabStrip';
import { ActivityBar } from './ActivityBar';
import { LockerPage, type CardActs, type ChipProject } from './LockerPage';
import type { TeamSpace } from '../team/useTeamMode';
import { lockerMenu } from '../../domain/lockerMenu';
import { menuItems } from './lockerMenuItems';
import { dotKind, worstDot, type DotKind } from '../../domain/dot';
import { OrchRail, type RailAvatar } from './OrchRail';
import { ChatLink } from './ChatLink';
import { phaseWord, railRows, type RailRow } from '../../domain/railRows';
import { orchDisplay } from '../orchLabels';
import { RoutineList } from './RoutineList';
import { railWidth } from '../../domain/sessionDock';
import { SessionPage } from './SessionPage';
import { lockerApi, LOCKER_CHAT_ATTACH, LOCKER_DROP, LOCKER_MOVE, useLockerTree } from './useLocker';
import { motionOn } from '../calm';

const nameOf = (s: Session) => (s.workspace ? `${s.project} / ${s.workspace}` : s.project);

// 참모 문서 고정 — 참모 이름 기준(세션이 바뀌어도 남는다, v10 R1)
const PIN_KEY = 'spacePins';
const loadPins = (): Record<string, string[]> => { try { return JSON.parse(localStorage.getItem(PIN_KEY) ?? '{}') as Record<string, string[]>; } catch { return {}; } };
// 내 페이지 제목(첫 줄 # 제목) — 파일 이름보다 이게 메뉴에 보인다
// 참모마다 사무실/스페이스 중 마지막에 고른 쪽 — 참모 이름 기준(앱을 다시 켜도, 2026-10-03 사용자)
const SIDE_KEY = 'spaceOfficeSide';
const RAIL_KEY = 'railWidth';
const loadSides = (): Record<string, Side> => { try { return JSON.parse(localStorage.getItem(SIDE_KEY) ?? '{}') as Record<string, Side>; } catch { return {}; } };
// 기억 키 = 세션 짧은 번호(이름을 바꿔도·/clear 해도 그대로) — 예전 키(이름)도 읽는다(2026-10-03 QA 8번)
const sideKey = (o: Session) => o.id;
const sideKeys = (o: Session) => [o.id, ...(o.name ? [o.name] : [])];

/** 스페이스 ↔ 사무실 두 칸 — 지금 쪽이 칠해진다(시안 office-chat v1 A) */
/** 사라질 때 한 번 — 홈 안 사무실을 닫으면 그 위 창도 닫는다 */
function OnGone({ run }: { run: () => void }) {
  const r = useRef(run);
  r.current = run;
  useEffect(() => () => r.current(), []);
  return null;
}

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
/** 진행 칸 — 일하는 중 세션의 할 일 목록 끝난 비율(다 끝나면 Claude 가 목록을 지워 빈 목록 = 모름) */
const sessionFill = (sessionId: string) => readSessionTasks(sessionId).then((t) => (t.length ? t.filter((x) => x.status === 'completed').length / t.length : undefined));

/** 스페이스 팀 탭(팀 보관함) 자리 */

export function SpaceView({ homeDash, chat, railTop, far, team, fns, onReorderOrch, onMenuToggle, orchPins = [], orchOrder = [], pet, office, officeReq = null, onOfficeReq, onOfficeShown, harnitorReq = null, onHarnitorReq, onHarnitorShown, onHarnitorClosed, toolsReq = null, onToolsReq, onToolsShown, onToolsClosed, reviewReq = null, onReviewReq, onReviewShown, replayReq = null, onReplayReq, onReplayShown, replayPage, computerUse, orchs, stoppingIds, startingOrchs, orch: chatOrch, projectSessions, sessions, events, claudeBin, fontSize, home, orchHome, send, sendTo, live = {}, menuOpen = true, idle = [], stopped = [], orchCwd = '', onResume, onWakeOrch, onRemoveStopped, onNewSession, onNewOrch, routines, routinePage, reviewPage, ctxOf, onAddProject, onChatTab, helpers = [], loose = [], tasks, onMessage, bubble }: {
  /** 고정한 참모(대화 id, 고정한 순서) — 사이드바 줄 순서·압정 표시 */
  orchPins?: string[];
  /** 프사 띠에서 참모를 끌어 옮겼다(ids = 지금 순서, from 을 to 자리로) — 채팅 탭 끌기와 같은 길(App reorderOrchPanes) */
  onReorderOrch?: (ids: string[], from: string, to: string) => void;
  /** 홈 대시보드(띠 맨 위 홈) — App 이 데이터를 들고 그린다, go = 누르면 갈 곳(스페이스 길) */
  homeDash?: (go: HomeGo) => React.ReactNode;
  /** 채팅 칸(App) — 띠 바로 다음에 그린다(띠 | 채팅 | 스페이스, 2026-10-12 사용자 시안 v2 Q1 A) */
  chat?: React.ReactNode;
  /** 띠 맨 위 다른 기기 단추(peer-panel) */
  railTop?: React.ReactNode;
  /** 다른 기기를 보는 중 — 띠·스페이스를 그 기기 것으로 바꿔 끼운다(이 맥 화면 상태는 그대로 두고 덮기만, 돌아오면 그대로) */
  far?: { rail: React.ReactNode; main: React.ReactNode; color: string; none?: boolean; cut?: boolean };
  /** 팀 모드(ui/team/useTeamMode, 시안 team-space A) — 띠 아래 팀 칸. on 이면 화면 전체가 팀: 가운데는 팀 대화(chat 칸이 덮음), 스페이스는 팀 것(space.view)이라 참모 프사 고름을 내린다 */
  team?: { rail: React.ReactNode; railOn: string | null; on?: boolean; color?: string; onLeave: () => void; space?: TeamSpace; add?: { label: string; open: () => void; room?: { label: string; open: () => void } }; /** 메신저 접음 — 팀 모드면 채팅 칸을 숨기기만(스페이스가 넓게) */ fold?: boolean };
  /** 띠 맨 아래 펼치기·접기(⌘B 와 같다) — 펼친 패널 = 넓은 띠(2026-10-12 패널 하나로 P1 A) */
  onMenuToggle?: () => void;
  /** 기록·음성·도구·하니터·리뷰 — 접힌 패널 둘째 세로줄(col), 펼친 패널 맨 아래 가로줄(row). 위 막대에서 옮겨 옴(2026-10-11 사용자 180.png) */
  /** pop = 띠 더보기 펼침 안 판(기본 title), dot = 더보기에 점(볼 것 있음) */
  fns?: { col: React.ReactNode; row: React.ReactNode; pop?: React.ReactNode; dot?: boolean };
  /** 참모 순서(대화 id, domain/orchOrder) — 사이드바 오케스트레이터 칸이 채팅 탭과 같은 줄로 */
  orchOrder?: string[];
  /** 세션이 안 떠 있는 프로젝트(예전 사이드바처럼 흐리게) */
  idle?: { name: string; root: string }[];
  /** 하니터 열기·닫기 요청(탑바·⌘·scripts/app) — 받아 처리하면 onHarnitorReq 로 비운다. 하니터는 탭마다 기억되는 화면('h:')이라
   *  지금 탭에 열리고, 다른 탭으로 가면 그 탭 화면이 보인다(2026-10-02 사용자). 열려 있으면 스페이스 칸을 덮는다(채팅 열은 그대로) */
  /** 참모가 키우는 펫 — 참모 대시보드의 '펫' 탭(다마고치 기능을 끄면 없음) */
  pet?: (who: (id: string) => { name: string; color: string } | null) => React.ReactNode;
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
  /** 띠의 쉬는 참모 깨우기 — 이어서 켜고 떠오르면 그 참모(채팅 탭까지)로(App resumeFromHome, 오케스트레이터 홈과 같은 길) */
  onWakeOrch?: (s: StoppedSession) => void;
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
  /** 하루 리플레이 — 앱 전체 화면이던 것을 스페이스 기능 화면으로(2026-10-11 사용자 "화면 전체가 바뀌어서 돌아갈 수가 없다") */
  replayReq?: 'open' | 'close' | 'toggle' | null;
  onReplayReq?: () => void;
  onReplayShown?: (open: boolean) => void;
  replayPage?: () => React.ReactNode;
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
  /** 떠 있는 참모 배지(시안 orch-bubble A) — 없으면 바탕 배지가 그릴 얼굴을 안 적는다(설정 > 기능에서 끔) */
  bubble?: { onHide: () => void } | null;
}) {
  useOrchRoleData(); // 맡은 일이 바뀌면 대시보드 머리도 다시
  // 메뉴에서 보는 참모 — 채팅 탭을 바꾸면 따라오고, 메뉴에서 고르면 채팅 탭은 그대로(2026-09-30 사용자)
  const [nav, setNav] = useState<{ view?: string; chat?: string }>({ view: chatOrch?.id, chat: chatOrch?.id });
  const sides = useRef(loadSides());
  // 참모를 누르면 첫 화면 = 보관함 받은 것(대시보드는 폴더 첫 화면으로 녹였다 — 띠 맨 아래 펼치기로 간다, 보관함 v4)
  // 참모 첫 화면 = 홈(홈·모드 v1 1 — 처음 여는 참모는 홈, 그 뒤엔 마지막에 본 줄을 switchTo 가 되살린다)
  const homeOf = (o: Session) => (office ? startPick(sides.current, sideKeys(o), lkPick(o.id, { kind: 'home' })) : lkPick(o.id, { kind: 'home' }));
  const [pick, setPickState] = useState<string>(() => (chatOrch ? homeOf(chatOrch) : ''));
  // 홈 기능 서랍 속 자리(리뷰 PR·예약 하나·도구 폴더) — 홈을 떠나지 않고 서랍 안에서만
  const [fnSub, setFnSub] = useState<{ k: FeatureKey; v: string } | null>(null);
  // 옛 대시보드 키(o:/p:)는 새 자리로(2026-10-12 패널 하나로 — domain/spaceNav legacyPick). 모든 화면 바꾸기가 이 길을 지난다
  const petRef = useRef<string | null>(null);
  const fixPick = (k: string) => legacyPick(k, { petFor: petRef.current, view: now.current.view, sessionOf: (root) => {
    const g = groups.find((x) => x.root === root);
    const o = orchs.find((x) => x.id === now.current.view);
    return (g?.sessions.find((x) => heldBy(o).some((h) => h.id === x.id)) ?? g?.sessions[0])?.id;
  } });
  const setPickRaw = (k: string) => setPickState(fixPick(k));
  // 지나온 화면 — 참모 탭(채팅 탭)마다 따로. 문서 "뒤로"·⌘[·마우스 뒤로 = 왔던 곳, ⌘] = 앞으로(없으면 위 칸).
  // 예전 문서 뒤로는 '위 칸'이라 링크 타고 간 뒤 누르면 오케스트레이터 홈으로 튕겼다(2026-10-04 QA D2)
  const navs = useRef(new Map<string, Nav>());
  const navKey = () => now.current.view ?? '';
  // 기록은 상태 갱신 함수 밖에서 바꾼다 — 개발판(StrictMode)은 갱신 함수를 두 번 돌려 뒤로가 두 칸 갔다
  // 스페이스를 바꾼 길 — 바뀔 때마다 종류만 기록(domain/spaceJump traceLine). 이름 없이 바뀌면 '?' 로 남아 다음에 또 튀면 잡힌다
  const why = useRef('mount');
  // 문서 스크롤 자리 — 참모 탭 + 화면마다(domain/spaceJump keepScroll). 떠날 때 적고 그 화면에 돌아오면 되살린다
  const docScroll = useRef(new Map<string, number>());
  const scrollEl = () => document.querySelector<HTMLElement>(SCROLL_PANES.map((c) => `.space .cv-main ${c}`).join(', '));
  const leaveScroll = () => { const el = scrollEl(); if (el) keepScroll(docScroll.current, scrollKey(now.current.view, now.current.pick), el.scrollTop); };
  const setPick = (k0: string, w = 'click') => {
    const k = fixPick(k0);
    if (now.current.view && screenBeforeHome(now.current.pick, k)) screens.current.set(now.current.view, { pick: now.current.pick, modal: now.current.modal, sheet: now.current.sheet });
    leaveScroll(); why.current = w; navs.current.set(navKey(), visit(navs.current.get(navKey()) ?? EMPTY_NAV, now.current.pick, k));
    // 세션으로 가면 그 참모 탭 줄에 세션 탭(패널 하나로 S4 — 크게 = 가운데 탭)
    // 연 곳은 지금 잡는다 — 업데이터는 다음 그리기에서 돌아 그때 now.current.pick 은 벌써 새 화면이다(닫으면 연 곳으로, 10-26)
    const [view, here] = [now.current.view, now.current.pick];
    if (k.startsWith('s:') && view) setLkHold((h) => openTab(h, view, here, k));
    setPickRaw(k);
  };
  /** 뒤로(-1)·앞으로(1) — 기록이 없으면 뒤로는 fallback(위 칸) */
  const step = (dir: -1 | 1, fallback?: string) => {
    const cur = now.current.pick;
    leaveScroll();
    const n = navs.current.get(navKey()) ?? EMPTY_NAV;
    const r = dir < 0 ? goBack(n, cur) : goForward(n, cur);
    why.current = dir < 0 ? 'back' : 'fwd';
    if (r) { navs.current.set(navKey(), r.nav); setPickRaw(r.to); return; }
    if (dir < 0 && fallback && fallback !== cur) { navs.current.set(navKey(), { back: n.back, fwd: [cur, ...n.fwd] }); setPickRaw(fallback); }
  };
  // 메신저 팀을 고를 때마다(nonce) 따라가기가 켜져 있으면 팀 탭으로(시안 v2 P2 — 고리로 끔)
  const followed = nav; // 채팅 탭이 바뀌면 아래 switchTo 가 옮긴다
  const orch = orchs.find((o) => o.id === followed.view) ?? chatOrch;
  // 채팅 탭마다 보던 화면을 기억한다 — 탭을 바꾸면 그 참모에서 마지막으로 보던 화면(처음이면 대시보드).
  // 다른 참모가 띄운 파일은 그 참모 탭으로 갈 때 보인다(2026-09-30 사용자 "탭별로 화면이 저장")
  const screens = useRef(new Map<string, { pick: string; modal: DashFile | null; focus?: { path: string; at: ShowAt; key: string } | null; scroll?: number; sheet?: string[] }>());
  const now = useRef({ view: followed.view, pick, modal: null as DashFile | null, sheet: [] as string[] });
  const holds = useRef(new Map<string, LkHold>()); // 참모마다 열어 둔 탭 줄(domain/lockerTabs swapHold)
  // 탭 확대·축소·맞춤(2026-10-12 사용자) — 배율은 파일(경로)마다 기억(domain/tabZoom). 명령은 단축키·머리 단추·휠·핀치가 같은 길로
  const [tabZooms, setTabZooms] = useState<TabZooms>(() => { try { return parseTabZooms(localStorage.getItem(TAB_ZOOM_KEY)); } catch { return {}; } });
  useEffect(() => { try { localStorage.setItem(TAB_ZOOM_KEY, JSON.stringify(tabZooms)); } catch { /* 이번엔 된다 */ } }, [tabZooms]);
  // 탭이 어떻게 바뀌든(누르기·⌘숫자·앱 명령·알림) 떠나는 참모 화면을 적어 두고 가는 참모 화면을 되살린다 — 누를 때만 되살려서
  // 단축키·"그 세션으로 가기"로 바꾸면 대시보드로 갔다(2026-09-30)
  const switchTo = (id: string, w = 'tab') => {
    if (!orchs.some((o) => o.id === id)) return;
    if (id === now.current.view) { setNav((n) => (n.chat === id ? n : { ...n, chat: id })); return; }
    why.current = w;
    // 보던 문서의 스크롤 자리도 같이 — 탭을 바꿨다 오면 맨 위로 올라갔다(2026-10-01 사용자). 되살리기는 아래 [pick, view] 효과
    leaveScroll();
    if (now.current.view && now.current.pick !== HOME) screens.current.set(now.current.view, { pick: now.current.pick, modal: now.current.modal, sheet: now.current.sheet });
    setLkHold(swapHold(holds.current, lkRef.current.hold, id)); // 열어 둔 탭·보관함 자리도 참모마다 — 돌아오면 그대로
    const sv = screens.current.get(id);
    setNav({ view: id, chat: id });
    const to = orchs.find((o) => o.id === id)!;
    const toPick = ownPick(sv?.pick, id, homeOf(to)); // 남의 보관함 자리가 박혀 있었으면 이 참모 홈으로
    setPickRaw(toPick); // 탭 바꾸기는 화면 기록이 아니다(기록은 탭마다 따로)
    setModal(sv?.modal ?? null);
    setSheet(sv?.sheet ?? []); // 사무실 위 창도 탭마다
    now.current = { ...now.current, view: id, pick: toPick, modal: sv?.modal ?? null, sheet: sv?.sheet ?? [] }; // 같은 틱에 뒤따르는 것(띄운 파일)이 새 탭 화면을 보게
    setFocus(sv?.focus ?? null); // 그 탭에 가서야 처음 보는 짚은 곳은 그때 반짝(한 번만 — 떠날 때 기억은 focus 없이)
  };
  // 화면에 돌아오면 그 문서에서 보던 자리로 — 탭 바꾸기·⌘[ 뒤로·⌘] 앞으로·메뉴 다 같은 길(2026-10-11, 예전엔 탭마다 하나라 같은 탭 뒤로는 맨 위)
  useEffect(() => {
    const want = restoreTop(docScroll.current.get(scrollKey(nav.view, pick)), !!scrollEl()?.matches('.lk-page-wrap'));
    if (want === null) return;
    if (want === 0) { scrollEl()!.scrollTop = 0; return; }
    // 문서는 글을 읽어 온 뒤에야 길이가 생긴다 — 될 때까지 잠깐 다시 맞춘다(최대 1.5초)
    let tries = 0;
    let t = 0;
    const put = () => { const el = scrollEl(); if (el && el.scrollHeight - el.clientHeight >= want - 4) { el.scrollTop = want; return; } if (++tries < 15) t = window.setTimeout(put, 100); };
    t = window.setTimeout(put, 50);
    return () => window.clearTimeout(t);
  }, [pick, nav.view]); // eslint-disable-line react-hooks/exhaustive-deps
  // 채팅 칸이 스페이스 참모를 바꿨을 때(App focusedBy) — 탭을 누르지 않았는데 오면 'follow' 로 남는다
  useEffect(() => { if (chatOrch?.id && chatOrch.id !== nav.chat) switchTo(chatOrch.id, 'follow'); }, [chatOrch?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // ⌘숫자·탭 고르기 — 홈을 보는 중 지금 탭 참모를 고르면 홈을 닫고 그 참모가 보던 화면으로(domain/spaceNav leaveHomeFor).
  // 받는 함수는 ref 로 늘 최신 — 귀는 한 번만 단다(매 그리기 다시 달면 같은 커밋에 탭 줄 효과가 쏜 사건이 떼어 둔 사이에 떨어진다)
  const onTabPick = useRef((_id: string) => {});
  // 떠 있는 배지 대화창이 열린 동안 채팅 탭이 바뀌면(머리 얼굴·탭 보기 격자) 보던 화면(홈·팀)은 그대로 — 채팅 탭만
  const quietTabs = useRef(false);
  onTabPick.current = (id: string) => {
    if (quietTabs.current) { setNav((n) => (n.chat === id ? n : { ...n, chat: id })); return; }
    const o = orchs.find((x) => x.id === id);
    if (o && leaveHomeFor(now.current.pick, now.current.view, id)) {
      const to = ownPick(screens.current.get(id)?.pick, id, homeOf(o));
      setPick(to, 'tab');
      now.current = { ...now.current, pick: to }; // 같은 틱에 한 번 더 와도(App ⌘숫자 + 탭 줄) 홈 기록이 두 번 안 쌓이게
      return;
    }
    switchTo(id);
  };
  useEffect(() => {
    const on = (e: Event) => { const id = (e as CustomEvent<string>).detail; if (id) onTabPick.current(id); };
    window.addEventListener('chat-tab-pick', on);
    return () => window.removeEventListener('chat-tab-pick', on);
  }, []);
  // 참모를 바꾸는 순간 — 흐림 + 불러오는 중을 먼저 그려 보여 주고(한 프레임), 무거운 대시보드는 그다음에(2026-09-30 사용자
  // "한참 있다가 스플래시"). 바뀐 걸 그리는 중에 알아채야 첫 화면부터 스플래시다
  // 펫 탭을 연 참모 대시보드(하나만). 위젯 '더보기'는 이제 모달(ui/tama/PetModal)이라 여기로 안 온다
  const [petFor, setPetFor] = useState<string | null>(null);
  petRef.current = petFor;
  const [shownOrch, setShownOrch] = useState(orch?.id);
  // hold = 기다리는 바꾸기 번호(0 = 안 기다림) — 바꿀 때마다 늘 커지는 새 번호라 풀기와 합쳐져도 값이 바뀌어 푸는 타이머가 꼭 다시 걸린다(domain/switchHold holdRelease)
  const [hold, setHold] = useState(0);
  const holdSeq = useRef(0);
  const [switching, setSwitching] = useState<string | null>(null);
  // 바뀐 걸 알아챈 이 렌더는 버려지고 hold 로 다시 그린다 — 이 렌더에서 옛 화면 자리(shownMain)를 새 화면으로 덮으면 안 된다
  const swapping = !!orch?.id && orch.id !== shownOrch;
  // 최근 참모 문서 살려 두기(ui/space/docKeep) — 움직이는 동안엔 새 문서를 만들지 않는다
  const keep = useDocKeep();
  const held = hold > 0 || swapping;
  keep.begin(held);
  if (swapping) {
    setShownOrch(orch.id);
    holdSeq.current += 1;
    setHold(holdSeq.current);
    setSwitching(orch.id);
  }
  // 기다리는 동안은 옛 화면을 덮개 아래 그대로 — 비우면(null) 옛 편집기를 부수는 일(~110ms)이 이음 탭 움직임 첫 프레임에 깔렸다(2026-10-12 사용자 "참모 바꿀 때 렉").
  // 움직임이 끝난 뒤(domain/switchHold) 한 번에 바꿔 끼운다. 움직임을 줄였으면 예전처럼 두 프레임 뒤
  const shownMain = useRef<React.ReactNode>(null);
  useEffect(() => {
    if (!hold) return;
    const mine = hold;
    const wait = spaceSwapDelay(motionOn());
    let r2 = 0;
    const r1 = wait ? 0 : requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setHold((s) => holdRelease(s, mine))); });
    // 창이 가려져 있거나 앞에 없으면 웹뷰가 그리기 신호(rAF)를 멈춰, 대시보드가 빈 화면으로 남았다(2026-10-01 사용자) — 시계로도 푼다
    const t = window.setTimeout(() => setHold((s) => holdRelease(s, mine)), wait || 200);
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
    const stop = every(() => void tick(), 15_000);
    return () => { alive = false; stop(); };
  }, [orchSidKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const holders = useMemo(() => {
    const resolve = (t: string) => findTarget(sessions, t)?.id;
    return addSpawned(holderMap(events, orchIds, resolve, Date.now()), spawned.current, resolve, orchIds);
  }, [events, orchIds.join(), sessions, spawnTick]); // eslint-disable-line react-hooks/exhaustive-deps
  // 맡긴 세션 — 프로젝트 세션뿐 아니라 그 참모가 띄운 도우미·프로젝트 밖 세션도(harnitor-port 가 대시보드에 안 붙었다, 2026-10-01 사용자)
  const heldBy = (o?: Session) => (o ? [...projectSessions, ...helpers, ...loose].filter((s) => holders.get(s.id)?.includes(o.id)) : []);
  const groups = useMemo(() => projectGroups(projectSessions), [projectSessions]);
  const orphans = orphanSends(events, Date.now());
  // scripts/app focus — 채팅 뷰에선 그 대시보드를 스페이스에(터미널로 넘어가지 않는다, 2026-10-02 사용자). 참모면 채팅 탭도 그 참모로(focusTab)
  useEffect(() => {
    const on = (e: Event) => {
      const plan = (e as CustomEvent<{ session: string } | { project: string }>).detail;
      const k = plan && focusPick(plan, sessions, groups, idle, orchs.map((o) => o.id));
      if (!k) return;
      setModal(null);
      const t = focusTab(k);
      if (t) { switchTo(t, 'focus'); if (t !== nav.chat) onChatTab?.(t); }
      setPick(k, 'focus');
    };
    window.addEventListener('space-focus', on);
    return () => window.removeEventListener('space-focus', on);
  });
  // Craft 맥 앱 — 기본 자리는 지금 보는 참모 탭 줄의 Craft 탭(k:<앱>). 끄면 탭도 닫는다, 따로 창으로 가면 탭은 '따로 창에 떠 있어' 안내
  const craftNames = useRef(new Map<string, string>());
  // Craft 독 — 떠 있는 Craft 앱(2초마다). 떠 있는 게 없으면 빈 목록이라 아이콘도 없다
  const [dock, setDock] = useState<DockItem[]>([]);
  // 꺼진 앱 칸 — 모든 참모 탭 줄·보던 화면에서 거두고 지금 참모 줄도 닫는다. 지금 참모 줄만 닫아서 안 보던 참모로 돌아오면 칸이 남았다(2026-10-21 사용자)
  const dropCraft = useRef((_key: string, _goneFor?: number) => {});
  dropCraft.current = (key: string, goneFor = 0) => {
    forgetCraftOwner(craftAppOf(key), Date.now(), goneFor);
    dropCraftEverywhere(key, holds.current, screens.current);
    setLkHold((h) => {
      if (!h || !h.tabs.includes(key)) return h;
      const r = closeTab(h, key, now.current.pick);
      if (r.pick) setPick(r.pick, 'craft');
      return r.hold;
    });
  };
  // 인스턴스 주인 참모(2026-10-21 사용자) — 띄운 세션을 맡은 참모 → 칸이 놓인 참모 → 없음(아무 참모). 칸·독·서랍은 주인 참모 스페이스에만
  const craftOwnerOfKey = (by: string | undefined, app: string) => craftOwnerOf(by, app, (b) => showOwner(b, orchIds, holders), craftOwner, orchIds);
  // 띄운 세션으로 주인이 정해진 칸이 다른 참모 탭 줄에 있으면 거둔다(넘겨받기·주인 없을 때 남이 연 칸) — 한 인스턴스가 두 참모에 붙어 있었다
  const strayCraft = useRef((_it: DockItem) => {});
  strayCraft.current = (it: DockItem) => {
    const o = it.by ? showOwner(it.by, orchIds, holders) : null;
    if (!o) return;
    const key = craftKey(it.app);
    const stray = (!!lkHold && lkHold.orch !== o && lkHold.tabs.includes(key)) || [...holds.current].some(([k, h]) => k !== o && h.tabs.includes(key));
    if (!stray) return;
    dropCraftEverywhere(key, holds.current, screens.current, o);
    // 주인 참모 탭 줄로 옮긴다(띄운 세션의 주인이 늦게 정해졌을 때 — 거두기만 하면 보던 칸이 그냥 사라졌다, 리뷰). __craftSpace 의 queue 길과 같게 + 프사 점
    const owner = orchs.find((x) => x.id === o);
    if (owner && o !== now.current.view && !holds.current.get(o)?.tabs.includes(key)) {
      const sv = screens.current.get(o) ?? { pick: homeOf(owner), sheet: [] };
      screens.current.set(o, { ...sv, pick: key, modal: null });
      holds.current.set(o, openTab(holds.current.get(o) ?? null, o, sv.pick, key));
      setNewFor((x) => (x.has(o) ? x : new Set(x).add(o)));
    }
    setLkHold((h) => {
      if (!h || h.orch === o || !h.tabs.includes(key)) return h;
      const r = closeTab(h, key, now.current.pick);
      if (r.pick) setPick(r.pick, 'craft');
      return r.hold;
    });
  };
  const dockSeen = useRef<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    const tick = () => void invoke<DockItem[]>('craft_dock').then((d) => {
      if (!alive) return;
      d.forEach((it) => craftNames.current.set(it.app, it.name));
      setDock((old) => (JSON.stringify(old) === JSON.stringify(d) ? old : d));
      // 보이던 앱이 사라지면 꺼짐 — 사람이 앱을 직접 끄거나 죽으면 closed 알림이 안 온다
      const r = craftGone(dockSeen.current, d.map((it) => it.app));
      dockSeen.current = r.track;
      r.gone.forEach((a) => dropCraft.current(craftKey(a), GONE_TICKS * 2000)); // 그만큼 전부터 안 보였다 — 그 뒤에 적힌 주인은 같은 키의 새 인스턴스 것
      d.forEach((it) => strayCraft.current(it));
    }, () => {});
    tick();
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const craftLatest = useRef({ orchs, chatOrch, switchTo, orchIds, holders, team });
  craftLatest.current = { orchs, chatOrch, switchTo, orchIds, holders, team }; // 구독은 한 번 — 참모 목록·바꾸기는 늘 최신으로(처음 렌더의 빈 목록을 붙잡지 않게)
  useEffect(() => {
    // Rust 가 window.__craftSpace(...) 를 eval 로 부른다 — 이 앱은 capabilities 가 없어 이벤트 listen 이 막혀 있다(appctl 과 같은 길)
    const w = window as unknown as { __craftSpace?: (p: { app: string; name?: string; place: string; by?: string }) => void };
    w.__craftSpace = ({ app, name, place, by }) => {
      const { orchs, chatOrch, switchTo, orchIds, holders, team } = craftLatest.current;
      const key = craftKey(app);
      if (name) craftNames.current.set(app, name);
      if (place === 'space') {
        // 팀 화면에서 연 것 — 팀 탭 줄에, 주인 참모 없이(domain/teamCraft). 팀 모드는 참모 고름을 그대로 두어 들어오기 직전 참모가 주인이 됐다(10-28 사용자)
        const src = team?.on ? fromTeamCraft(app) : null;
        if (team?.on && team.space && craftToTeam(true, src !== null, by)) { team.space.craft(key, src ?? ''); return; }
        // 띄운 세션(by)을 맡긴 참모 탭에 — show 와 같은 주인 판단. 서랍·셸에서 띄웠으면 지금 보는 참모 → 대표(2026-10-19 사람이 보면서 따라가게)
        const v = now.current.view ?? null;
        const owner = craftOwnerOf(by, app, (b) => showOwner(b, orchIds, holders), craftOwner, orchIds);
        const t = craftTarget(owner, v && orchs.some((o) => o.id === v) ? v : undefined, nav.chat, chatOrch?.id ?? orchs[0]?.id);
        // 놓인 참모를 기억 — 주인을 알거나 세션이 띄웠으면(주인 모르는 세션도 그 칸이 놓인 참모 것). 사람이 연 것(by 없음)을 재시작 때 되살릴 땐
        // 안 적는다: 다 그때 보던 참모 것으로 박혔다(리뷰). 그 칸을 보게 되면 아래 pick 효과가 그 참모로 적는다
        if ((owner || by) && t.to) setCraftOwner(app, t.to);
        if (t.queue) { // 다른 참모 몫 — 보던 화면은 그대로, 그 참모 탭 줄 끝에 넣고 프사에 점(show-queued 와 같은 길)
          const o = orchs.find((x) => x.id === t.to)!;
          const sv = screens.current.get(t.to!) ?? { pick: homeOf(o), sheet: [] };
          screens.current.set(t.to!, { ...sv, pick: key, modal: null });
          holds.current.set(t.to!, openTab(holds.current.get(t.to!) ?? null, t.to!, sv.pick, key));
          setNewFor((x) => (x.has(t.to!) ? x : new Set(x).add(t.to!)));
          setCurNote(tr(`${josa(oname(o), '이', '가')} 맡긴 세션이 ${craftNames.current.get(app) ?? app} 를 띄웠어`, `A session ${oname(o)} delegated opened ${craftNames.current.get(app) ?? app}`));
          return;
        }
        const to = t.to;
        if (!to) { void invoke('craft_move', { app, to: 'window' }).catch(() => {}); return; } // 탭 줄을 둘 참모가 없으면 따로 창
        if (team?.on) team.onLeave(); // 맡긴 세션이 띄운 칸 — 팀 모드면 참모 화면으로 돌아가 보여 준다(show 와 같은 길)
        const here = now.current.view === to ? now.current.pick : ''; // 다른 참모로 옮기면 연 곳은 없다(닫으면 예전처럼 마지막 탭)
        if (now.current.view !== to) switchTo(to, 'craft');
        setModal(null);
        setLkHold((h) => openTab(h, to, here, key));
        setPick(key, 'craft');
      } else if (place === 'closed') { // 꺼짐 — 모든 참모·팀 탭 줄에서
        dropCraft.current(key);
        team?.space?.dropCraft(key);
      } else if (place === 'hidden') { // 숨김 — 지금 탭만 닫는다(독 아이콘은 남는다). 팀 칸이면 팀 탭 줄에서
        team?.space?.dropCraft(key);
        setLkHold((h) => {
          if (!h || !h.tabs.includes(key)) return h;
          const r = closeTab(h, key, now.current.pick);
          if (r.pick) setPick(r.pick, 'craft');
          return r.hold;
        });
      }
    };
    return () => { delete w.__craftSpace; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  // scripts/show 기록 — 3초마다 꼬리(채팅 안 파일 카드와 같이 읽는다). 대시보드 파일·참모 문서가 여기서 나온다
  const log = useShowLog();

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
  // 고정한 문서가 닫힌 워크트리 안이면 본 폴더 새 자리로(show 기록 풀기와 같은 규칙) — 켤 때·1분마다. 예전엔 고정이 없는 파일을 가리켰다
  const pinsNow = useRef(pins);
  pinsNow.current = pins;
  useEffect(() => {
    let alive = true;
    const fix = () => {
      const paths = pinPaths(pinsNow.current);
      if (!paths.length) return;
      void invoke<Record<string, string>>('moved_paths', { paths }).then((moved) => {
        if (!alive || !Object.keys(moved).length) return;
        setPins((all) => {
          const next = remapPins(all, moved);
          if (!next) return all;
          try { localStorage.setItem(PIN_KEY, JSON.stringify(next)); } catch { /* 이번 실행만 */ }
          return next;
        });
      }, () => {});
    };
    fix();
    const stop = every(fix, 60_000);
    return () => { alive = false; stop(); };
  }, []);

  // 내 페이지는 보관함으로 흡수(홈·모드 ⑧) — 옛 <데이터>/pages 는 첫 참모 보관함 '페이지' 폴더로 한 번 옮겨진다(Rust migrate_pages)
  // 문서 속 하위 페이지 블록을 누르면
  useEffect(() => {
    const on = (e: Event) => { const p = (e as CustomEvent<string>).detail; if (p) openFileRef.current(p); };
    window.addEventListener(OPEN_PAGE, on);
    return () => window.removeEventListener(OPEN_PAGE, on);
  }, []);
  // ⌘[ ⌘](App)·마우스 뒤로/앞으로 단추 — 스페이스 화면 기록으로. 기록이 없으면 문서 '뒤로' 버튼처럼 위 칸으로(예전엔 아무 일도 없었다)
  useEffect(() => {
    const back = (dir: -1 | 1) => step(dir, keyFallback(dir, now.current.pick, docUp.current));
    const on = (e: Event) => back((e as CustomEvent<-1 | 1>).detail);
    const mouse = (e: MouseEvent) => { if (e.button === 3 || e.button === 4) { e.preventDefault(); back(e.button === 3 ? -1 : 1); } };
    window.addEventListener(SPACE_NAV, on);
    window.addEventListener('mouseup', mouse);
    return () => { window.removeEventListener(SPACE_NAV, on); window.removeEventListener('mouseup', mouse); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  // 사무실 켜기·끄기 — 탭(참모)마다 켜기 전 화면을 기억해 거기로 돌아간다
  const beforeOffice = useRef(new Map<string, string>());
  // 홈에서 마지막으로 다룬 참모(미니 대화 열기·보내기) — 홈에 들어올 때마다 비운다
  const homeTouched = useRef<string | undefined>(undefined);
  useEffect(() => { if (pick === HOME) homeTouched.current = undefined; }, [pick === HOME]); // eslint-disable-line react-hooks/exhaustive-deps
  const officeTo = (want: 'office' | 'space' | 'toggle') => {
    if (!office) return;
    // 홈에서 켜면 홈에서 다룬 참모 → 지금 탭 → 첫 참모(domain/spaceOffice homeOfficeOrch). 홈은 탭을 안 골라서 늘 첫 참모로 켜졌다(2026-10-25 사용자)
    const id = pick === HOME ? homeOfficeOrch(homeTouched.current, now.current.view, orchs.map((o) => o.id)) : orch?.id;
    if (!id) return;
    const from = pick;
    if (id !== now.current.view) { switchTo(id, 'home'); onChatTab?.(id); }
    const r = officePick(from, want, beforeOffice.current.get(id) ?? '', `o:${id}`);
    beforeOffice.current.set(id, r.before);
    if (r.pick !== now.current.pick) setPick(r.pick, 'office');
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
  // 띄운 파일을 지금 참모 탭 줄 새 탭에 — 홈·기능 화면에서도(10/12). 보는 참모가 없거나 시안 검토 중이면 예전 길: md 는 가운데 페이지, 그림·시안은 미리보기
  const present = (f: DashFile) => {
    if (team?.on) team.onLeave(); // 참모가 띄운 것 — 팀 모드면 참모 화면으로 돌아가 보여 준다
    // 보여 주기는 화면을 안 옮긴다(홈·모드 v2 A) — 지금 보는 참모 탭 줄에 새 탭(끝에 프로젝트 이름표, 잠깐 테두리), 나무·보던 탭은 그대로.
    // 시안(큐레이션) html 은 검토 탭(c:<경로>) — html 탭으로 열면 그 탭이 시안을 알아보고 검토 탭으로 바뀐다(domain/lockerTabs openReview)
    const v = now.current.view ?? null;
    const tabOrch = v && orchs.some((o) => o.id === v) ? v : null;
    if (showInTab(now.current.pick, tabOrch) && !f.path.startsWith('data:')) {
      const toTab = () => {
        setModal(null);
        const here = now.current.pick; // 닫으면 연 곳으로 — 업데이터 안에서 읽으면 벌써 새 탭 주소다
        setLkHold((h) => openTab(h, tabOrch!, here, f.path));
        setFreshTab(f.path);
        setPick(`d:${f.path}`, 'show');
        docScroll.current.delete(scrollKey(now.current.view, `d:${f.path}`));
        setFocus(f.at ? { path: f.path, at: f.at, key: f.ts } : null);
      };
      if (f.by) curBy.current.set(f.path, f.by); // html 탭으로 먼저 열려 탭이 시안을 알아봐도 띄운 이가 남게
      if (/\.html?$/i.test(f.path)) void invoke<string>('read_doc_text', { path: f.path }).then((t) => (isCurationHtml(t) ? toCuration(f.path, f.by) : toTab()), toTab);
      else toTab();
      return;
    }
    // 보는 참모가 없다(꺼진 참모 화면에 남음 등) — 띄운 참모(모르면 채팅 탭 참모)로 옮겨 그 탭 줄에. 미리보기 모달로 덮지 않는다(2026-10-15)
    const to = !f.path.startsWith('data:') && now.current.pick !== OFFICE ? (orchs.find((o) => o.id === showOwner(f.by, orchIds, holders)) ?? chatOrch ?? orchs[0]) : undefined;
    if (to) { switchTo(to.id, 'show'); if (now.current.view === to.id) { present(f); return; } }
    const md = spacePage(f.path); // md 문서·엑셀은 가운데 페이지
    const r = showPick(now.current.pick, f.path, md);
    if (md) {
      setModal(null); // 떠 있던 미리보기 창에 문서가 가려지지 않게
      if (r.sheet) openSheet(r.sheet); else { setPick(r.pick, 'show'); docScroll.current.delete(scrollKey(now.current.view, r.pick)); } // 새로 띄운 건 맨 위(또는 짚은 곳)부터
      setFocus(f.at ? { path: f.path, at: f.at, key: f.ts } : null);
    } else if (r.pick === OFFICE) showOver(f);
    else setModal(f);
  };
  // 채팅 안 파일 카드를 누르면 — 그 참모 탭으로 가서 show 와 같은 길로 다시 연다(짚은 곳도 다시 반짝)
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ path: string; at?: ShowAt; by: string }>).detail;
      if (!d?.path) return;
      if (team?.on && team.space) { team.space.open(d.path); return; } // 팀 모드에서 누른 파일(팀 대화 풍선·팀 보관함) — 팀 탭 줄에
      const m = cardMoves(d.by, { view: now.current.view ?? '', chat: nav.chat ?? '' }); // 쌓아 보기 다른 참모 카드면 채팅 탭도 그 참모로
      if (m.space) switchTo(m.space, 'chatfile');
      if (m.tab) onChatTab?.(m.tab);
      present({ path: d.path, ts: new Date().toISOString(), by: d.by, ...(d.at ? { at: d.at } : {}) });
    };
    window.addEventListener(CHAT_FILE_OPEN, on);
    return () => window.removeEventListener(CHAT_FILE_OPEN, on);
  });
  // 다른 참모가 띄운 것 — 그 참모 탭 줄 새 탭으로(domain/spaceJump queueShow). 보던 화면은 그대로, 스페이스 아래 한 줄 알림만(시안 검토와 같은 규칙, 2026-10-15)
  const queueTo = (owner: string, show: DashFile) => {
    const o = orchs.find((x) => x.id === owner);
    const home0 = o ? homeOf(o) : lkPick(owner, { kind: 'home' });
    const sv = screens.current.get(owner);
    const q = show.path.startsWith('data:') ? { screen: { ...(sv ?? { pick: home0, sheet: [] }), modal: show }, hold: null } : queueShow(sv, holds.current.get(owner) ?? null, owner, home0, show);
    screens.current.set(owner, q.screen);
    if (q.hold) holds.current.set(owner, q.hold);
    const fname = show.path.startsWith('data:') ? '' : ` — ${show.path.split('/').pop()}`;
    if (o) setCurNote(tr(`${josa(oname(o), '이', '가')} 파일을 띄웠어${fname}`, `${oname(o)} opened a file${fname}`));
    if (/\.html?$/i.test(show.path)) void invoke<string>('read_doc_text', { path: show.path }).then((t) => { if (isCurationHtml(t)) queueReview(owner, show); }, () => {});
    docScroll.current.delete(scrollKey(owner, q.screen.pick)); // 새로 띄운 건 맨 위부터
    setNewFor((x) => (x.has(owner) ? x : new Set(x).add(owner)));
    void spaceTrace(traceLine({ ts: new Date().toISOString(), why: 'show-queued', from: now.current.pick, to: now.current.pick, viewFrom: now.current.view, viewTo: now.current.view, chat: nav.chat })).catch(() => {});
  };
  // 다른 참모가 띄운 것 — 보던 화면은 그대로, 띄움 띠 없이 그 참모 프사에 점만(알림 N1 — 소식은 제자리 점, 2026-10-11). 그 참모 화면에 가면 지운다
  const [newFor, setNewFor] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const fresh = newShows(log, null, since.current); // 채팅 뷰는 리더를 안 쓴다 — 누가 띄웠든 여기서
    if (!fresh.length) return;
    since.current = Date.parse(fresh[fresh.length - 1]!.ts) || Date.now();
    // 띄우면 바로 보이게(2026-09-30 사용자 "띄워주면 바로") — 띄운 참모의 탭에. 하위 세션이 띄웠으면 그 세션을 잡은 참모, 모르면 지금 화면.
    // 다른 참모가 띄운 건 보던 스페이스를 옮기지 않고 그 참모 탭 화면에 넣어 두고 알림만 — 예전엔 채팅 탭·스페이스를 통째로 그 참모로
    // 옮겨서 화면이 저절로 튀었다(2026-10-06 사용자 "사람이 바꾸기 전엔 안 바뀐다"). 한 번에 여럿 오면 하나하나(domain/spaceJump showBatch)
    const b = showBatch(fresh, (by) => showOwner(by, orchIds, holders), now.current.view, nav.chat);
    if (b.go) switchTo(b.go, 'show'); // 먼저 옮긴다 — 떠난 참모 탭 줄이 저장된 뒤라야 그 참모 몫(queue)이 거기 쌓인다
    for (const { owner, show } of b.queue) queueTo(owner, show);
    for (const h of b.here) present(h.show);
  }, [log]); // eslint-disable-line react-hooks/exhaustive-deps

  // Craft 인스턴스를 띄운 세션 별명 — 같은 앱이 세션마다 떠도 독·칸에서 누구 것인지(by = 세션 id, 사람이 연 것은 없음)
  const craftWho = (by?: string) => {
    if (!by) return undefined;
    const o = orchs.find((x) => x.id === by || x.id.startsWith(by));
    if (o) return oname(o);
    const s = findTarget(sessions, by);
    return s ? s.name || nameOf(s) : undefined;
  };
  // 팀 칸의 참모 앱 — 주인 참모가 없어 이름표(whoOf)도 없다(domain/teamCraft). TeamSpace 가 lk-doc-body 로 감싼다
  const craftPaneOf = (k: string) => <CraftPane key={k} app={craftAppOf(k)} place="space" />;
  const who = (id: string) => {
    if (id === 'me') return tr('나', 'You');
    const o = orchs.find((x) => x.id === id);
    if (o) return oname(o);
    const s = sessions.find((x) => x.id === id);
    return s ? nameOf(s) : id;
  };
  // 대시보드 세션 칸 — 대화 기록 꼬리를 터미널처럼 몇 줄(보고 있는 대시보드의 세션만 3초마다)
  const [tails, setTails] = useState<Record<string, string[]>>({});
  const tailIds = (() => {
    return orch ? [orch, ...heldBy(orch)] : []; // 세션 독 칸 — 지금 참모(자기 브라우저 칸)와 잡은 세션
  })().map((s) => s.sessionId).filter((x): x is string => !!x);
  const tailKey = tailIds.join(',');
  useEffect(() => {
    if (!tailKey) return;
    let alive = true;
    const tick = () => void readTranscriptTails(tailKey.split(',')).then((m) => {
      if (!alive) return;
      setTails((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(m)) next[k] = termTail(v, 8);
        return next;
      });
    }).catch(() => {});
    tick();
    const stop = every(tick, 3000);
    return () => { alive = false; stop(); };
  }, [tailKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // 참모 노트(홈 곁 줄) — 참모 할 일 목록(TaskCreate) + HQ starter 최근 결정. 홈을 보고 있을 때 5초마다(v11 X)
  const [note, setNote] = useState<NoteBase | null>(null);
  const homeLp = parseLkPick(pick);
  const noteOrch = homeLp?.place.kind === 'home' ? orchs.find((x) => x.id === homeLp.orch) : undefined;
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
    const stop = every(() => void tick(), 5000);
    return () => { alive = false; stop(); };
  }, [noteOrch?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 세션 탭 오른쪽 목록 — 그 프로젝트 세션 할 일(지금 하는 것 먼저) + starter "다음 할 일"·"최근 결정". 보고 있을 때 5초마다
  const [plists, setPlists] = useState<DashLists | null>(null);
  // 세션 탭이면 그 세션 프로젝트의 할 일·최근 결정(패널 하나로 S4)
  const proot = pick.startsWith('s:') ? projectRoot(sessions.find((x) => x.id === pick.slice(2))?.cwd ?? '') : '';
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
    const stop = every(() => void tick(), 5000);
    return () => { alive = false; stop(); };
  }, [proot]); // eslint-disable-line react-hooks/exhaustive-deps
  // 도우미·프로젝트 밖 세션은 프로젝트 이름(=HQ 폴더 이름) 대신 세션 이름으로 — 'honor-orchestrator' 로만 떠서 누가 누군지 몰랐다(2026-10-02)
  const sideIds = new Set([...helpers, ...loose].map((x) => x.id));
  const cardName = (s: Session) => (sideIds.has(s.id) && s.name ? s.name : nameOf(s));
  // 세션 브라우저(참모 브라우저 래퍼 상태) — 세션 칸·세션 화면·참모 대시보드가 브라우저 화면으로(2026-10-03 사용자)
  const lives = useAgentLives();
  // 사람이 끈 브라우저(프로필 → 그 크롬 pid) — 래퍼가 알아채기 전에도 탭 줄·칸에서 바로 뺀다(domain/browserDock stillClosed)
  const [closedB, setClosedB] = useState<Record<string, number>>({});
  // 독 X 로 끌 브라우저 — 앱 확인 창을 띄운 동안(10-28 사용자 "닫으면 브라우저 자체가 닫히게, 대신 경고")
  const [closingB, setClosingB] = useState<BrowserDockItem | null>(null);
  const liveB = (profile: string) => lives.find((l) => l.profile === profile && !stillClosed(closedB, l));
  const seenB = useRef<string | null>(null);
  // 참모 브라우저 프로필(HQ 폴더 이름) — 세션 없이 띄운 것도 참모 독에(hq_browser)
  const [hqB, setHqB] = useState<string | null>(null);
  useEffect(() => { void invoke<string | null>('hq_browser_profile').then(setHqB, () => {}); }, []);
  // 참모들이 나눠 쓰는 HQ 프로필 — 쥔 세션의 참모 독에만, 사람이 서랍에서 연 건 누른 참모 한 곳에 '내가 연 것'(domain/browserDock hqBrowserHome)
  const [hqOpener, setHqOpener] = useState<string>();
  const hqLive = hqB ? lives.find((l) => l.profile === hqB) : undefined;
  const hqHome = hqBrowserHome(hqLive, orchs.map((o) => ({ id: o.id, own: liveOf(o, lives), held: heldBy(o).map((x) => liveOf(x, lives)) })), hqOpener);
  const hqHomeOf = (lo: Session) => (!liveOf(lo, lives) && hqHome?.id === lo.id ? hqHome : null);
  const ownLive = (lo: Session) => liveOf(lo, lives) ?? (hqHomeOf(lo) ? hqLive : undefined);
  const lineOf = (s: Session, name: string): DashLine => ({ id: s.id, name, ...paneState(s, live[s.id]), ...(live[s.id]?.st ? { st: live[s.id]!.st } : {}), line: live[s.id]?.line ?? '', tail: s.sessionId ? tails[s.sessionId] : undefined, browser: liveOf(s, lives) });

  const cur = pick.startsWith('s:') ? sessions.find((s) => s.id === pick.slice(2)) : undefined;
  // 채팅에 붙이기 — 지금 채팅 탭 참모 입력칸에(끌어다 놓기와 같게)
  const attach = (path: string) => {
    if (!chatOrch) return;
    // 경로 없는 그림(채팅에 붙인 그림) — 파일로 저장한 뒤 그 경로로 붙인다(말풍선 그림 열기와 같은 저장)
    void imageFile(path).then((p) => attachToChat(chatOrch.id, [p])).catch(() => {});
  };
  // 붙이기 받는 참모(지금 채팅 탭) — 보내기 단추가 그 참모 색 말풍선(채팅 칸과 같은 색, 프사에서 고른 색 먼저)
  const attachTo = chatOrch ? { name: oname(chatOrch), color: bodyColor(avatars, chatOrch.name || '', colorOf(chatOrch.name || '')) } : null;
  // 팀 보관함·대화 파일에서 연 것(풀어 둔 평문)은 지금 채팅 탭 참모가 아니라 '내 참모에게 보내기' — 누른 자리에서 참모를 고른다(10-26 사용자 "누구한테 보낼지 정해져 있지 않다")
  const teamGive = useGivePath((m) => onMessage?.(m));
  const attachOf = (path: string) => (isTeamCache(path) ? (e?: React.MouseEvent<HTMLElement>) => teamGive.open(path, e) : () => attach(path));
  const attachToOf = (path: string) => (isTeamCache(path) ? teamGive.to : attachTo);
  // 세션 칸의 진짜 터미널 — 직접 칠 수 있다(대화형 세션은 터미널 뷰에서만)
  const termOf = (id: string) => {
    const s = sessions.find((x) => x.id === id);
    if (!s || s.kind !== 'background') return <div className="cv-blank">{tr('이 세션은 터미널 뷰에서만', 'Terminal view only')}</div>;
    return <TerminalPane key={s.id} command={attachCommand(claudeBin, s.id)} title={nameOf(s)} subtitle={s.name} fontSize={fontSize} linkBase={s.cwd} home={home} />;
  };
  const openFileRef = useRef<(p: string) => void>(() => {});
  const openFile = (path: string, by = '') => {
    const f = { path, ts: new Date().toISOString(), by };
    if (now.current.pick === OFFICE) { if (spacePage(path)) openSheet(`d:${path}`); else showOver(f); return; } // 사무실 위 창 안에서 연 것도 사무실 위
    if (spacePage(path)) { setPick(`d:${path}`); return; }
    setModal(f);
  };

  openFileRef.current = (p) => openFile(p);
  // 기능 화면(하니터·도구·리뷰·하루 리플레이) — 스페이스의 한 자리에서 켜고 끈다. 다시 누르면 닫고 열기 전 화면으로(2026-10-11 사용자).
  // 탭(참모)마다 열기 전 화면을 따로 기억한다(한 탭에서 연 기억이 다른 탭 닫기에 섞이지 않게)
  const beforeF = useRef(new Map<string, string>());
  // 탭마다 하니터 안에서 고른 것 — 다른 탭 다녀오면 되살린다
  const hSel = useRef(new Map<string, HarnitorSel>());
  const fnHome = orch ? `o:${orch.id}` : '';
  /** at = 열 때 그 기능 안 자리(프로젝트 도구 t:<폴더>) */
  const featureTo = (key: FeatureKey, req: 'open' | 'close' | 'toggle', at?: string) => {
    if (req !== 'close' && team?.on) team.onLeave(); // 기능 화면은 참모 화면 — 팀 모드에서 열면 참모로 돌아간다
    const k = orch?.id ?? '';
    const r = featurePick(key, pick, req, beforeF.current.get(k) ?? '', fnHome);
    beforeF.current.set(k, r.before);
    const to = at && featureOf(r.pick) === key ? at : r.pick;
    if (to !== pick) setPick(to, 'feature');
    const was = featureOf(pick);
    if (was && !featureOf(to)) { if (was === 'h:') onHarnitorClosed?.(); if (was === 't:') onToolsClosed?.(); }
  };
  useEffect(() => { if (harnitorReq) { featureTo('h:', harnitorReq); onHarnitorReq?.(); } }, [harnitorReq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (toolsReq) { featureTo('t:', toolsReq); onToolsReq?.(); } }, [toolsReq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (reviewReq) { featureTo('rv:', reviewReq); onReviewReq?.(); } }, [reviewReq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (replayReq) { featureTo('rp:', replayReq); onReplayReq?.(); } }, [replayReq]); // eslint-disable-line react-hooks/exhaustive-deps
  // 켜짐(기능 아이콘 검은 면) — 프로젝트 도구(t:<폴더>)·PR 하나(rv:<키>)도 열린 것
  useEffect(() => {
    const f = featureOf(pick);
    onHarnitorShown?.(f === 'h:'); onToolsShown?.(f === 't:'); onReviewShown?.(f === 'rv:'); onReplayShown?.(f === 'rp:');
  }, [pick]); // eslint-disable-line react-hooks/exhaustive-deps
  // 지금 보는 화면(viewNow) — 왼쪽 스페이스와 그 위 미리보기
  useEffect(() => {
    const names = { orch: (id: string) => orchs.find((o) => o.id === id)?.name, session: (id: string) => sessions.find((x) => x.id === id)?.name, home: home ?? "" };
    // 사무실 위 창도 '위에 뜬 것'으로 — 사용자가 "이거"라고 하면 참모가 창 속 세션·문서를 알아듣게
    const top = pick === OFFICE ? sheet[sheet.length - 1] : undefined;
    reportView({ tab: orchs.find((o) => o.id === nav.chat)?.name ?? chatOrch?.name, space: spaceWord(pick, names), preview: modal ? pathWord(modal.path, home ?? '') : top ? spaceWord(top, names) : undefined });
  });
  // 참모 모드 — 켠 모드 목록(패널·대시보드 칸·미리보기·꽉 채우기가 같이 본다), 메뉴 '지금 대시보드 칸으로'가 쓸 지금 대시보드
  const modeRows = useModeRows();
  // 참모 첫날 맛보기 권유는 뺐다(2026-10-15 사용자) — 앱이 참모 입력칸에 [앱] 줄을 넣어 참모가 대화와 상관없이 갑자기 권했다. 권유는 홈 빈 칸(모드 고르기)만 조용히
  useEffect(() => {
    const o = pick.startsWith('o:') ? orchs.find((x) => x.id === pick.slice(2)) : undefined;
    setModeDashHere(o?.name || (pick.startsWith('p:') ? pick.slice(2) : '') || orch?.name || chatOrch?.name || null);
    setModeChatHere(chatOrch?.id ?? null);
  });
  // 검토 결과는 시안을 띄운 참모에게 — 지금 채팅 탭 참모에게 보내니 개발 참모가 띄운 시안 결과가 다른 참모에게 갔다(2026-09-30 사용자 "버그네")
  const curBy = useRef(new Map<string, string>());
  // 시안 검토 = 지금 참모 탭 줄의 검토 탭(c:<경로>) — 창 전체를 덮어 채팅을 가리고 X 로 안 닫히던 검토 모드 대신(2026-10-12 사용자).
  // 창 전체로 키우는 건 머리 '크게'를 누를 때만(curBig)
  const [curBig, setCurBig] = useState(false);
  useEffect(() => { if (!pick.startsWith('c:')) setCurBig(false); }, [pick]);
  useEffect(() => setCurBig(false), [nav.view]); // 참모를 바꾸면 그 참모 검토는 탭 안에서
  const toCuration = (p: string, by?: string) => {
    setModal(null);
    if (by) curBy.current.set(p, by);
    const here = now.current.pick;
    const k = reviewKey(p);
    const v = now.current.view;
    if (v && orchs.some((o) => o.id === v)) { setLkHold((h) => openReview(h, v, here, p)); setFreshTab(k); }
    // html 탭(d:<경로>)이 시안을 알아본 것이면 그 화면을 바꿔 끼운다 — 기록에 html 탭을 남기면 ⌘[ 뒤로가 또 검토로 튄다
    if (here === `d:${p}`) { why.current = 'review'; setPickRaw(k); } else setPick(k, 'review');
  };
  /** 검토 닫기(X·Esc·탭 닫기) — 검토 탭을 닫고 앞 탭으로(없으면 보관함). 같은 시안의 html 탭은 openReview 가 이미 바꿔 끼워서 다시 튀지 않는다 */
  const closeReview = (p: string) => {
    setCurBig(false);
    const k = reviewKey(p);
    const h = lkRef.current.hold;
    if (h && h.tabs.includes(k)) { const r = closeTab(h, k, now.current.pick); setLkHold(r.hold); if (r.pick) setPick(r.pick, 'close'); return; }
    if (now.current.pick === k) setPick(h?.back ?? (orch ? lkPick(orch.id, { kind: 'home' }) : ''), 'close');
  };
  // 다른 참모가 띄운 시안 — 그 참모 탭 줄에 검토 탭으로 넣어 두고(보던 참모는 그대로) 알림 한 줄. 지금 그 참모를 보고 있으면 미리보기가 알아서 검토 탭으로
  const queueReview = (owner: string, f: DashFile) => {
    if (owner === now.current.view) return;
    if (f.by) curBy.current.set(f.path, f.by);
    const sv = screens.current.get(owner);
    const o = orchs.find((x) => x.id === owner);
    const back = sv?.pick ?? (o ? homeOf(o) : `l:${owner}`);
    screens.current.set(owner, { ...(sv ?? { modal: null, sheet: [] }), pick: reviewKey(f.path), modal: sv?.modal?.path === f.path ? null : sv?.modal ?? null });
    holds.current.set(owner, openReview(holds.current.get(owner) ?? null, owner, back, f.path));
    if (o) setCurNote(tr(`${josa(oname(o), '이', '가')} 시안을 띄웠어`, `${oname(o)} opened a draft for review`));
  };
  // 그 알림 한 줄 — 스페이스 위에 잠깐(경고 띠가 아니라 소식)
  const [curNote, setCurNote] = useState<string | null>(null);
  useEffect(() => { if (!curNote) return; const t = window.setTimeout(() => setCurNote(null), 4500); return () => window.clearTimeout(t); }, [curNote]);
  const curOwner = (p: string) => { const by = curBy.current.get(p) ?? ''; const id = orchs.some((o) => o.id === by) ? by : holders.get(by)?.[0]; return orchs.find((o) => o.id === id); };
  // 검토 머리의 띄운 이 — 참모면 그 프사·이름, 세션이면 그 세션을 맡긴 참모 프사 + 세션 이름
  const byTag = (p: string) => {
    const by = curBy.current.get(p);
    if (!by || by === 'me') return undefined;
    const o = curOwner(p);
    return { name: who(by), avatar: o ? <OrchAvatar name={o.name || ''} size={18} state={avatarState(o, statusOf(o))} color={colorOf(o.name || '')} label={oname(o)} /> : null };
  };
  const curationEl = (p: string, big: boolean) => {
    const own = curOwner(p);
    const to = own ?? chatOrch;
    return <CurationMode key={p} path={p} big={big} onBig={() => setCurBig((b) => !b)} by={byTag(p)} sendTo={own ? oname(own) : sendTo ?? assistant()} color={to ? bodyColor(avatars, to.name || '', colorOf(to.name || '')) : undefined}
      onSend={own ? async (text) => { window.dispatchEvent(new CustomEvent('chat-pending', { detail: { id: own.id, text } })); await sendTextToSession(own.id, text); } : send} onClose={() => closeReview(p)} />;
  };
  /** 문서 화면 — 스페이스 가운데(d:)와 사무실 위 창이 같은 것을 쓴다. onBack = 뒤로(upKey = 위 칸), tail = 머리 끝(창의 크게·닫기) */
  /** 가운데 문서의 위 칸 — ⌘[ 가 기록이 없을 때 문서 뒤로 버튼과 같은 곳으로 */
  const docUp = useRef('');
  // 탭 확대 — 지금 가운데에 떠 있는 파일 탭(모달이 떠 있으면 모달이 받는다). 머리 단추는 가운데 탭에만(사무실 위 창엔 없다).
  // 팀 모드면 팀 스페이스에서 보던 탭(10-30 사용자 — 팀챗 미리보기엔 확대 칸이 없었다)
  const zoomPath = modal ? '' : team?.on && team.space ? team.space.cur : pick.startsWith('d:') ? pick.slice(2) : '';
  const canZoom = !!zoomPath && tabZoomable(zoomPath);
  const zoomOf = (path: string) => tabZoomOf(tabZooms, path);
  /** 한 명령 — 처리했으면 true(아니면 App 이 터미널 글자 크기로) */
  const zoomCmd = (cmd: ZoomCmd, at?: { x: number; y: number }): boolean => {
    if (!canZoom) return false;
    const z = zoomOf(zoomPath);
    let shown: number | undefined;
    let fitTo: number | undefined;
    if (kindOf(zoomPath) === 'image') {
      // 핀치·휠은 커서 아래, 키보드·단추는 보이는 가운데가 제자리에 — FileTab 이 다시 그린 뒤 스크롤을 맞춘다
      markAnchor(document.querySelector<HTMLElement>('.space .cv-main .ft-body .pv-image'), at);
      const img = document.querySelector<HTMLImageElement>('.space .cv-main .ft-body img');
      if (z === FIT && img?.naturalWidth) shown = Math.round((img.getBoundingClientRect().width / (img.naturalWidth / (window.devicePixelRatio || 1))) * 100);
    }
    if (cmd === 'fit') {
      const el = document.querySelector<HTMLElement>('.space .cv-main .cv-doc-scroll, .space .cv-main .cv-sheet-body');
      if (el) fitTo = fitZoom(el.clientWidth, el.scrollWidth, z);
    }
    setTabZooms((m) => withTabZoom(m, zoomPath, nextTabZoom(zoomPath, z, cmd, { shown, fitTo })));
    return true;
  };
  /** 그림 두 번 누르기 — 새 배율을 바로 적는다(누른 곳이 제자리에) */
  const zoomTo = (path: string, z: number, at: { x: number; y: number }) => {
    if (!tabZoomable(path) || kindOf(path) !== 'image') return;
    markAnchor(document.querySelector<HTMLElement>('.space .cv-main .ft-body .pv-image'), at);
    setTabZooms((m) => withTabZoom(m, path, z));
  };
  const zoomUi = (path: string) => (path === zoomPath && canZoom ? <TabZoomBar z={zoomOf(path)} onCmd={(c) => zoomCmd(c)} /> : null);
  const docPage = (path: string, opt: { onBack?: (upKey: string) => void; tail?: React.ReactNode; where?: string; keepFor?: string }) => {
    const owner = orchs.find((o) => isPinned(o, path) || orchDocs(log, o.id, []).recent.includes(path));
    const g = groups.find((x) => path.startsWith(`${x.root}/`));
    // 뒤로 = 상위(노션처럼): 하위 페이지면 부모 페이지, 내 페이지면 내 페이지 첫 화면, 그 밖은 주인 대시보드(2026-09-30 사용자)
    const upKey = owner ? `o:${owner.id}` : g ? `p:${g.root}` : chatOrch ? `o:${chatOrch.id}` : '';
    if (opt.onBack) docUp.current = upKey; // 가운데 문서만(사무실 위 창 문서는 뒤로가 없다)
    const upName = owner ? oname(owner) : g ? g.name : path.split('/').slice(-2, -1)[0] ?? '';
    if (isSheet(path)) {
      return <SheetPage key={path} path={path} owner={upName} where={opt.where} onBack={opt.onBack ? () => opt.onBack!(upKey) : undefined} tail={<>{zoomUi(path)}{opt.tail}</>} zoom={zoomOf(path)}
        pinned={owner ? isPinned(owner, path) : undefined} onPin={owner ? () => togglePin(owner, path) : undefined} onAttach={attachOf(path)} attachTo={attachToOf(path)}
        onPreview={() => setModal({ path, ts: new Date().toISOString(), by: '' })} send={send} sendTo={sendTo}
        whoOf={(by) => { const o = orchs.find((x) => x.id === showOwner(by, orchIds, holders)); return o ? { name: o.name, color: colorOf(o.name) } : null; }} />;
    }
    // 문서를 볼 땐 대시보드·사무실 토글을 안 띄운다 — 돌아가기는 왼쪽 '참모 이름' 알약(2026-10-03 사용자)
    const page = <DocPage key={path} path={path} where={opt.where} at={focus?.path === path ? focus.at : undefined} atKey={focus?.path === path ? focus.key : undefined} owner={upName} send={send} sendTo={sendTo} onBack={opt.onBack ? () => opt.onBack!(upKey) : undefined} tail={<>{zoomUi(path)}{opt.tail}</>} zoom={zoomOf(path)}
      pinned={owner ? isPinned(owner, path) : undefined} onPin={owner ? () => togglePin(owner, path) : undefined}
      onTitle={(t) => { window.dispatchEvent(new CustomEvent(PAGE_TITLE, { detail: { path, title: t } })); }} onAttach={attachOf(path)} attachTo={attachToOf(path)}
      onOpenPath={(p) => openFile(p)} />;
    // 가운데 문서는 참모마다 살려 둔다 — 바꿨다 돌아와도 편집기를 다시 안 만든다(움직이는 동안엔 null — 옛 화면이 덮여 있다)
    return opt.keepFor ? keep.slot(opt.keepFor, path, page, docKeepLimit(null)) : page;
  };
  // 팀 보관함·대화 파일에서 연 것(데이터 폴더에 풀어 둔 평문) — 탭 머리 내려받기: 다운로드 폴더로 복사하고 파인더에서 보인다(10-26 사용자 292.png)
  const teamDl = (path: string) => (isTeamCache(path) ? (
    <IconButton label={tr('내려받기', 'Download')} title={tr('다운로드 폴더에 저장', 'Save to Downloads')} onClick={() => void invoke<string>('team_locker_download', { path }).catch(lockerFail)}><IconDownload /></IconButton>
  ) : null);
  /** 가운데 파일 화면 — md·엑셀은 편집 페이지, 그 밖(그림·영상·html·pdf…)은 탭 안 미리보기 */
  const filePage = (path: string, opt: { onBack?: (upKey: string) => void; where?: string; keepFor?: string }) => (spacePage(path) ? docPage(path, { ...opt, tail: teamDl(path) }) : (
    <FileTab key={path} path={path} where={opt.where ?? pathLine(path, lockerTree.dir, home ?? '')} onBig={() => setModal({ path, ts: new Date().toISOString(), by: '' })}
      onCuration={(p) => { if (now.current.pick === `d:${p}`) toCuration(p); }} onAttach={attachOf(path)} attachTo={attachToOf(path)} zoom={zoomOf(path)} zoomUi={<>{zoomUi(path)}{teamDl(path)}</>} onZoom={(z, at) => zoomTo(path, z, at)} />
  ));
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
  // 세션 브라우저 칸 열기(시안 A) — 사람 부름·'크게 보기'가 모달 대신 그 브라우저를 독에 둔 참모 스페이스 칸으로(AgentAskHost 가 부른다).
  // 그 참모가 없으면 false — 모달로 물러난다. 구독은 한 번, 목록·바꾸기는 늘 최신으로
  const paneLatest = useRef({ orchs, lives, heldBy, switchTo, team });
  paneLatest.current = { orchs, lives, heldBy, switchTo, team };
  useEffect(() => {
    const w = window as unknown as { __browserPane?: (profile: string, dry?: boolean, orch?: string) => boolean };
    // dry = 갈 수 있나만(모달이 그릴 때 — 한 프레임도 안 번쩍이게). orch = 눌린 카드가 놓인 참모(채팅 맨 아래 카드 — 독 규칙과 갈려도 그 참모 칸으로)
    w.__browserPane = (profile, dry, orch) => {
      const { orchs, lives, heldBy, switchTo, team } = paneLatest.current;
      const to = paneTarget(profile, orchs.map((o) => ({ id: o.id, own: liveOf(o, lives), held: heldBy(o).map((x) => liveOf(x, lives)) })), orch);
      if (!to || dry) return !!to;
      if (team?.on) team.onLeave();
      if (now.current.view !== to) switchTo(to, 'browser');
      setModal(null);
      setPick(browserKey(profile), 'browser');
      return true;
    };
    return () => { delete w.__browserPane; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 파일 보관함 v4(2026-10-11 사용자 "추천대로") — 참모마다 진짜 폴더(~/Documents/Chammo/<참모>, Rust locker_fs). 참모를 누르면 첫 화면.
  // 자리: l:<참모>(받은 것) · l:<참모>#d:<자리>(내 폴더) · l:<참모>#p:<뿌리>(프로젝트 폴더). 보관함에서 연 md·엑셀은 띠·나무 그대로 가운데 문서 탭
  const projectRoots = useMemo(() => [...groups.map((g) => ({ name: g.name, root: g.root })), ...idle], [groups, idle]);
  const ownerKey = (o: Session) => o.name || o.id;
  const lockerOwner = (o: Session) => ({ id: o.id, name: ownerKey(o) });
  const lockerReport = (r: { errors: string[] }) => { if (r.errors.length) onMessage?.(r.errors.join('\n')); };
  const lockerFail = (e: unknown) => onMessage?.(tr(`보관함: ${String(e)}`, `Locker: ${String(e)}`));
  // 왼쪽(보관함 칸·메뉴)은 기능 화면이 떠 있는 동안 열기 전 화면을 따른다 — 기능 단추가 제자리에 남아 다시 눌러 닫는다
  const leftPick = sidePick(pick, beforeF.current.get(orch?.id ?? '') ?? '', fnHome);
  const lp = parseLkPick(leftPick);
  const [lkHold, setLkHold] = useState<LkHold | null>(null);
  // 방금 보여 줘서 새로 열린 탭 — 잠깐 테두리(홈·모드 v2 A)
  const [freshTab, setFreshTab] = useState<string | null>(null);
  useEffect(() => { if (!freshTab) return; const t = window.setTimeout(() => setFreshTab(null), 2400); return () => window.clearTimeout(t); }, [freshTab]);
  const docPath = leftPick.startsWith('d:') ? leftPick.slice(2) : '';
  const holdOn = !!lkHold && !!docPath && lkHold.tabs.includes(docPath);
  // 나무는 늘 — 보관함 밖 화면(세션·기능)에서도 지금 보는 참모 보관함 나무(2026-10-12 패널 하나로)
  const lockerOrchId = lp?.orch ?? (holdOn && lkHold ? lkHold.orch : orch?.id ?? '');
  const lockerOrch = lockerOrchId ? orchs.find((x) => x.id === lockerOrchId) ?? null : null;
  // Craft 탭이 이 참모 스페이스에 떠 있다 — 돌려받음 [앱] 줄을 이 참모에게(ui/craftOwner)
  useEffect(() => { if (pick.startsWith('k:') && lockerOrch) setCraftOwner(craftAppOf(pick), lockerOrch.id); }, [pick, lockerOrch?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // 브라우저가 꺼지면 칸은 바로 닫고 직전 탭(없으면 그 참모 홈)으로 — 빈 안내 칸에 남지 않게, 안내는 아래 한 줄만(10-28 사용자)
  const leaveBrowser = (note: string) => {
    seenB.current = null;
    step(-1, lockerOrch ? lkPick(lockerOrch.id, { kind: 'home' }) : HOME);
    setCurNote(note);
  };
  const closedBrowser = (profile: string, pid: number) => {
    setClosedB((c) => ({ ...c, [profile]: pid }));
    if (browserOfPick(now.current.pick) === profile) leaveBrowser(tr('브라우저를 껐어', 'Closed the browser'));
  };
  useEffect(() => {
    const p = browserOfPick(pick);
    if (p === null) { seenB.current = null; return; }
    const present = !!liveB(p);
    if (present) { seenB.current = p; return; }
    if (!wentAway(seenB.current === p, present)) return;
    // 2초 넘게 없을 때만 — 세션 크롬이 다시 뜨는 사이(목록에서 잠깐 빠짐)에 칸이 닫히지 않게
    const t = window.setTimeout(() => leaveBrowser(tr('브라우저가 꺼졌어 — 세션이 다시 쓰면 탭 줄에 다시 생겨', 'The browser closed — it comes back in the tab row when the session uses it again')), 2000);
    return () => window.clearTimeout(t);
  }, [pick, lives, closedB]); // eslint-disable-line react-hooks/exhaustive-deps
  // Craft 글자 탭이 없다(독 아이콘이 탭, 2026-10-19 사용자) — 칸을 떠나면 숨기기(10분 뒤 저장·끄기), 들어오면 숨김 풀기
  const prevPick = useRef(pick);
  useEffect(() => {
    const gone = leftCraft(prevPick.current, pick);
    if (gone) void invoke('craft_leave', { app: gone }).catch(() => {});
    if (pick.startsWith('k:') && pick !== APPS_KEY && pick !== prevPick.current) void invoke('craft_enter', { app: craftAppOf(pick) }).catch(() => {});
    prevPick.current = pick;
  }, [pick]);
  const lockerTree = useLockerTree(lockerOrch ? lockerOwner(lockerOrch) : null, 5000, isLockerOpen(lp));
  const place: LkPlace = lp?.place ?? (lkHold ? parseLkPick(lkHold.back)?.place ?? { kind: 'root' } : { kind: 'root' });
  const lkRef = useRef({ tree: lockerTree, hold: lkHold });
  lkRef.current = { tree: lockerTree, hold: lkHold };
  // 그 참모 화면에 오면 프사 점을 지운다
  useEffect(() => {
    if (lockerOrchId && newFor.has(lockerOrchId)) setNewFor((x) => { const n = new Set(x); n.delete(lockerOrchId); return n; });
  }, [lockerOrchId, newFor]);
  // 옛 보관함(이름표 기록 locker.jsonl) → 진짜 폴더, 앱을 켜고 참모 목록이 잡히면 한 번(두 번째부턴 Rust 가 표시 파일을 보고 건너뜀).
  // 보관함을 시작하기 전(처음 열기 전)엔 기다린다 — 처음 열 때 스크린샷 연결과 한 줄 안내(맥 권한 창이 설명 없이 뜨지 않게, 0.3.0)
  const migrated = useRef(false);
  useEffect(() => {
    if (migrated.current || !orchs.length || !lockerTree.started) return;
    migrated.current = true;
    void lockerApi.migrate(orchs.map((o) => ({ key: ownerKey(o), id: o.id, name: ownerKey(o) }))).then((r) => {
      if (r.pages) onMessage?.(tr(`내 페이지 ${r.pages}개를 보관함 '페이지' 폴더로 옮겼어요. 옛 위치는 데이터 폴더의 pages.bak에 그대로 있어요`, `Moved ${r.pages} pages into the locker's 'Pages' folder. The old folder stays as pages.bak`));
      if (r.shots) onMessage?.(tr("스크린샷 폴더를 보관함에 '스크린샷'으로 연결했어요. 새로 찍으면 바로 보여요. 필요 없으면 연결을 풀 수 있어요(원본은 그대로)", "Linked your screenshots folder as 'Screenshots' in the locker. New shots show up right away. You can unlink any time (the originals stay)"));
      if (r.inbox) onMessage?.(tr(`'받은 것'을 없애고 안에 있던 ${r.inbox}개를 보관함 맨 위로 옮겼어 — 주고받은 기록에 그대로 보여`, `Removed 'Received' and moved its ${r.inbox} items to the top of the locker`));
      if (r.moved || r.gone) onMessage?.(tr(`보관함을 진짜 폴더로 옮겼어 — ${r.moved}개${r.gone ? `, 원본이 없어 못 옮긴 것 ${r.gone}개` : ''}`, `Moved the locker into real folders — ${r.moved}${r.gone ? `, ${r.gone} missing originals` : ''}`));
    }, () => {});
  }, [orchs.length, lockerTree.started]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const cur = () => {
      const l = parseLkPick(now.current.pick);
      const id = l?.orch ?? lkRef.current.hold?.orch;
      return id ? orchs.find((x) => x.id === id) : undefined;
    };
    // 파인더에서 보관함 칸·폴더에 놓은 파일 — 어디서 왔나로 복사/바로가기(Rust 가 정한다)
    const onDrop = (e: Event) => {
      const d = (e as CustomEvent<{ paths: string[]; folder: string }>).detail;
      const o = cur();
      if (o && d?.paths?.length) void lockerApi.put(lockerOwner(o), d.paths, d.folder ?? '').then(lockerReport, lockerFail);
    };
    // 카드·폴더를 왼쪽 폴더에 끌어 놓았다(홈·모드 ⑤) — 내 폴더 안 것은 진짜 옮기기(정리), 기록(보관함 맨 위 낱 파일·보여 준 파일)은
    // 바로가기만(기록은 그대로 남고 '→ 폴더'가 붙는다). 기록을 보관함 줄에 놓으면 — 밖 파일만 보관함 맨 위로 넣기
    const onMove = (e: Event) => {
      const d = (e as CustomEvent<{ path: string; folder: string }>).detail;
      const o = cur();
      if (!o || !d?.path) return;
      const dir = lkRef.current.tree.dir;
      const to = d.folder ?? '';
      const rel = dir && d.path.startsWith(`${dir}/`) ? d.path.slice(dir.length + 1) : null;
      const ent = rel !== null ? lkRef.current.tree.entries.find((x) => x.rel === rel) : undefined;
      const isDir = !!ent?.dir;
      // 맥 폴더 연결 안 파일(읽기 전용) — 옮기지 않는다. 폴더에 놓으면 바로가기, 보관함 맨 위에 놓으면 복사해 넣기
      if (ent?.ro) {
        if (ent.dir) return;
        if (to) void lockerApi.alias(lockerOwner(o), d.path, to).catch(lockerFail);
        else void lockerApi.put(lockerOwner(o), [d.path], '').then(lockerReport, lockerFail);
      } else if (rel !== null && (rel.includes('/') || isDir)) void lockerApi.move(lockerOwner(o), rel, to).catch(lockerFail);
      else if (to) void lockerApi.alias(lockerOwner(o), d.path, to).catch(lockerFail);
      else if (rel === null) void lockerApi.put(lockerOwner(o), [d.path], '').then(lockerReport, lockerFail);
    };
    // 채팅에 붙인 그림(앱 첨부 폴더 — 집이 따로 없는 것)만 그 참모 보관함에. 맥 파일은 원본 그대로 두고 참모가 그걸 고친다
    const onChat = (e: Event) => {
      const d = (e as CustomEvent<{ session: string; paths: string[] }>).detail;
      const o = orchs.find((x) => x.id === d?.session);
      const pasted = (d?.paths ?? []).filter((p) => /\/attach\/\d+-[^/]+$/.test(p));
      if (o && pasted.length) void lockerApi.put(lockerOwner(o), pasted).catch(() => {});
    };
    window.addEventListener(LOCKER_DROP, onDrop);
    window.addEventListener(LOCKER_MOVE, onMove);
    window.addEventListener(LOCKER_CHAT_ATTACH, onChat);
    return () => { window.removeEventListener(LOCKER_DROP, onDrop); window.removeEventListener(LOCKER_MOVE, onMove); window.removeEventListener(LOCKER_CHAT_ATTACH, onChat); };
  }, [orchs]); // eslint-disable-line react-hooks/exhaustive-deps
  // 보관함에서 연 파일을 맥 앱(키노트·한글 등)으로 고쳐 저장하면 그 참모 입력칸에 한 줄(보내기는 사람이) — md·엑셀은 스페이스 편집 고리가 따로
  const lockerOpened = useRef(new Map<string, number>());
  const lockerTold = useRef(new Map<string, number>());
  useEffect(() => {
    if (!lockerOrch || !lockerTree.dir) return;
    const items = lockerTree.entries.filter((e) => !e.dir).map((e) => ({ path: `${lockerTree.dir}/${e.rel}`, mtime: e.mtime ?? null, gone: e.gone, name: e.name }));
    for (const it of editedAfterOpen(items, lockerOpened.current, lockerTold.current)) {
      window.dispatchEvent(new CustomEvent(CHAT_INSERT, { detail: { id: lockerOrch.id, text: tr(`고침: ${it.name} — ${it.path}`, `Edited: ${it.name} — ${it.path}`) } }));
    }
  }, [lockerTree]); // eslint-disable-line react-hooks/exhaustive-deps
  // 프로젝트 줄 점 — 그 프로젝트 세션 중 가장 급한 것(기다림 > 일함 > 쉼, domain/dot)
  const dotOf = (ss: Session[]): DotKind => worstDot(ss.map((s) => dotKind(lineOf(s, ''))));
  const lockerSide = (() => {
    if (!lockerOrch) return null;
    const lo = lockerOrch;
    const held = heldBy(lo);
    // 진행 중 칩 = 이 참모가 맡긴 프로젝트 중 일하는·기다리는 것, 모든 프로젝트 = 그 밖(쉼·꺼짐)까지(홈·모드 v2 B·D)
    const dotFor = (root: string): DotKind => { const g = groups.find((x) => x.root === root); return g ? dotOf(g.sessions) : 'off'; };
    const whatOf = (root: string, name: string) => {
      const g = groups.find((x) => x.root === root);
      const names = new Set([name, ...(g?.sessions ?? []).flatMap((s) => [s.name ?? '', nameOf(s)])].filter(Boolean));
      return [...events].reverse().find((e) => e.type === 'send' && ((e.target && names.has(e.target)) || e.project === name))?.title ?? '';
    };
    const all: ChipProject[] = projectRoots.map((p) => { const g = groups.find((x) => x.root === p.root); return { root: p.root, name: p.name, dot: dotFor(p.root), what: whatOf(p.root, p.name), session: (g?.sessions.find((x) => held.some((h) => h.id === x.id)) ?? g?.sessions[0])?.id }; });
    const mine = groups.filter((g) => g.sessions.some((s) => held.some((h) => h.id === s.id))).map((g) => g.root);
    const active = all.filter((p) => mine.includes(p.root) && (p.dot === 'run' || p.dot === 'ask'));
    const shown = dashFiles(log, lo.id, held.map((s) => s.id), []);
    const items = lockerLog(shown, lockerTree.entries, lockerTree.dir, projectRoots);
    const to = (p: LkPlace) => setPick(lkPick(lo.id, p));
    return {
      held, items, chips: { active, all }, rootNew: items.length > 0 && newFor.has(lo.id),
    };
  })();
  // 펼친 띠 폭 — 앱 전체 한 값(191.png: 맡은 일 글로 490px 까지 늘었다)
  const [railW, setRailW] = useState(() => { try { const v = localStorage.getItem(RAIL_KEY); return railWidth(v === null ? null : Number(v)); } catch { return railWidth(null); } });
  // 참모 프사 띠(접힌 참모 패널) — 채팅 칸 위 탭 줄 대신 여기서 참모를 바꾼다(2026-10-11 사용자). 누르면 그 참모가 마지막에 보던 화면 + 채팅 탭도 그 참모로
  const pip = (o: Session): 'ask' | 'new' | 'run' | 'rest' | null => {
    const d = dotOf([o, ...heldBy(o)]);
    return d === 'ask' ? 'ask' : newFor.has(o.id) ? 'new' : d === 'off' ? null : d;
  };
  const railOn = lockerOrch?.id ?? orch?.id;
  // 홈 대시보드(띠 맨 위 홈, 2026-10-24) — 참모 채팅 없이 전체 한눈에. 홈을 보는 동안 참모 프사 고름·채팅 칸을 내린다
  const atHomePick = pick === HOME;
  const teamOn = !!(team?.on && team.space);
  // 켜는 중·끄는 중도 띠 위 줄에 자리 그대로(2026-10-12 사용자 "뿅 나왔다 뿅 사라진다") — 끄는 중은 잠들며 제자리, 깨우는 쉬는 참모는 위 줄로 올라와 깨어남
  const railPrev = useRef<RailRow[]>([]);
  const rows = railRows({ live: orchs, stopping: new Set(stoppingIds), starting: startingOrchs ?? [], prev: railPrev.current, order: orchOrder, pins: orchPins });
  // 새로 만든 참모는 '켜는 중' 칸(new:<이름>)과 다른 칸으로 뜬다 — 처음 그릴 때 깨어남 마무리를 한 번(woke)
  const creatingSeen = useRef(new Set<string>());
  for (const r of rows) if (r.phase === 'starting' && r.key.startsWith('new:')) creatingSeen.current.add(r.name);
  useEffect(() => {
    railPrev.current = rows;
    for (const r of rows) if (r.phase === 'live') creatingSeen.current.delete(r.name);
  });
  const railAvatar = (r: RailRow): RailAvatar => {
    const text = phaseWord(r.phase, r.waking);
    if (r.phase === 'starting' || !r.live) {
      const x = r.off!;
      const nm = orchDisplay(x) || x.name;
      return { id: `start:${r.key}`, label: nm, on: false, color: bodyColor(avatars, x.name, colorOf(x.name)), pinned: orchPins.includes(r.key), phase: 'starting', phaseText: text, flip: r.key,
        node: <OrchAvatar name={x.name} size={32} state="off" phase="starting" color={colorOf(x.name)} label={nm} /> };
    }
    const o = r.live;
    const stopping = r.phase === 'stopping';
    return { id: o.id, label: oname(o), role: orchRoleOf(o.name || '')?.text, on: o.id === railOn && !team?.railOn && !atHomePick, color: bodyColor(avatars, o.name || '', colorOf(o.name || '')), pinned: !!o.sessionId && orchPins.includes(o.sessionId), pip: stopping ? null : pip(o),
      phase: stopping ? 'stopping' : undefined, phaseText: text, flip: r.key, flipAlt: `new:${o.name}`,
      node: <OrchAvatar name={o.name || ''} size={32} state={stopping ? 'off' : avatarState(o, statusOf(o))} phase={stopping ? 'stopping' : undefined} woke={creatingSeen.current.has(o.name)} color={colorOf(o.name || '')} label={oname(o)} /> };
  };
  const railList = rows.map(railAvatar);
  // 내 참모에게(팀 보관함·메신저 @ 메뉴·넘기기) — 고를 참모 목록을 메신저 따로 창에도(세션 이름 = 프사, 별명). 켜는 중·끄는 중은 뺀다
  useEffect(() => publishRoster(railList.flatMap((a) => {
    const o = !a.phase ? orchs.find((x) => x.id === a.id) : undefined;
    return o ? [{ id: o.id, owner: ownerKey(o), name: o.name || a.label, label: a.label, color: a.color, busy: a.pip === 'run', pip: a.pip ?? null }] : [];
  })));
  // 받기 — 팀 모드를 끄고 그 참모 채팅으로 바꾼 뒤 입력칸에 #file 칩 + 커서(보내기는 사람이). 따로 창에서 준 것은 Rust 가 이 창을 앞으로 가져와 부른다
  const giveRef = useRef<(r: GiveReq) => void>(() => {});
  giveRef.current = ({ orch: id, paths }) => {
    if (!orchs.some((x) => x.id === id) || !paths?.length) return;
    // 떠 있는 배지가 있으면 팀 화면은 그대로 두고 그 참모 대화창에 붙인다(시안 orch-bubble F, 10-28)
    if (bubble && teamOn && !far) { bub.openWith(id); attachWhenReady(id, paths); return; }
    team?.onLeave();
    if (id !== now.current.view) switchTo(id, 'give');
    if (id !== nav.chat) onChatTab?.(id);
    attachWhenReady(id, paths);
  };
  useEffect(() => {
    const w = window as unknown as { __teamGive?: (r: GiveReq) => void };
    w.__teamGive = (r) => giveRef.current(r);
    return () => { delete w.__teamGive; };
  }, []);
  // 참모 고르기 — 띠 프사 누름과 배지 대화창 '참모 화면으로'가 같은 길
  const pickOrch = (id: string) => {
    const o = orchs.find((x) => x.id === id);
    if (!o) return;
    team?.onLeave(); // 메신저 대화를 보던 중이면 가운데를 다시 이 참모 채팅으로
    // 지금 참모를 또 누르면 — 남의 보관함 자리가 박혀 있으면(옛 화면이 눌렸다) 이 참모 홈으로, 이 참모 탭 줄 문서·세션은 그대로(domain/lockerTabs reclickPick)
    if (id === now.current.view) { const to = pick === HOME ? ownPick(screens.current.get(id)?.pick, id, homeOf(o)) : reclickPick(lkHold, id, pick, homeOf(o)); if (to) setPick(to); }
    else switchTo(id, 'rail');
    if (id !== nav.chat) onChatTab?.(id);
  };
  // 앱 안 대화창(시안 orch-bubble F) — 참모 채팅 칸이 가려진 화면(팀 모드·홈)에서 놓은·준 파일은 그 칸이 대화창으로 뜬다. 배지는 바탕 배지 창 하나(DeskBubble)
  const bubOrchs: BubbleOrch[] = railList.flatMap((a) => {
    const o = !a.phase ? orchs.find((x) => x.id === a.id) : undefined;
    if (!o) return [];
    const av = (size: number) => <OrchAvatar name={o.name || ''} size={size} state={avatarState(o, statusOf(o))} color={colorOf(o.name || '')} label={a.label} />;
    return [{ id: o.id, label: a.label, color: a.color, pip: a.pip, node: av(44), small: av(28) }];
  });
  const bub = useOrchBubble({ orchs: bubOrchs, face: bubbleFace(bubOrchs, nav.chat ?? chatOrch?.id), covered: teamOn || atHomePick, onPick: (id) => {
      // 칸이 가려진 화면(팀 모드·홈)에선 채팅 탭만 — 보던 화면(홈)이 그 참모 화면으로 따라가지 않게 nav.chat 을 먼저 맞춘다(아래 'follow' 효과가 안 돈다)
      if (teamOn || atHomePick) { setNav((n) => (n.chat === id ? n : { ...n, chat: id })); onChatTab?.(id); } else pickOrch(id);
    }, onGo: pickOrch });
  quietTabs.current = bub.open;
  // 바탕 배지 창이 읽는 얼굴 · 바탕 배지 '앱에서 열기'는 Rust 가 메인 창을 앞으로 가져와 __orchGo 로 그 참모 화면
  const faceId = bubble && chat && !far ? bubbleFace(bubOrchs, nav.chat ?? chatOrch?.id)?.id ?? null : null;
  useEffect(() => publishFace(faceId), [faceId]);
  const goRef = useRef(pickOrch);
  goRef.current = pickOrch;
  useEffect(() => {
    const w = window as unknown as { __orchGo?: (r: { orch: string }) => void };
    w.__orchGo = (r) => { if (r?.orch) goRef.current(r.orch); };
    return () => { delete w.__orchGo; };
  }, []);
  const railEl = (
    <OrchRail
      home={{ on: atHomePick && !teamOn, onOpen: () => { team?.onLeave(); setPick(HOME, 'home'); } }}
      onTeam={team?.add} moreDot={!!fns?.dot} popFns={fns?.pop}
      top={railTop}
      avatars={railList}
      extra={team?.rail}
      onPick={pickOrch}
      onMenu={act ? (e, id) => { const o = orchs.find((x) => x.id === id); if (o) act.menu(e, o, colorOf(o.name || '')); } : undefined}
      onRename={act ? (id) => { const o = orchs.find((x) => x.id === id); if (o) act.askRename(o); } : undefined}
      onMove={onReorderOrch ? (from, to) => onReorderOrch(orchs.map((o) => o.id), from, to) : undefined}
      onNew={onNewOrch} fns={menuOpen ? fns?.row : fns?.col} wide={menuOpen} joined={!!chat && (!atHomePick || teamOn) && !(teamOn && team?.fold)} width={railW} onWidth={(w) => { const v = railWidth(w); setRailW(v); try { localStorage.setItem(RAIL_KEY, String(v)); } catch { /* 이번 실행만 */ } }} groupNames={[...helpers, ...loose].map((h) => h.name || h.id).join(' · ')}
      group={(() => {
        // 도우미 묶음(P3) — 이 HQ 에서 띄운 도우미 + 프로젝트 밖 세션. 누르면 목록, 고르면 그 세션
        const hs = [...helpers, ...loose];
        return { count: hs.length, label: tr(`도우미 ${hs.length}`, `Helpers ${hs.length}`), onOpen: (e: React.MouseEvent) => act?.openMenu(e, hs.map((h) => ({ label: `${h.name || h.id} · ${stateWord(h)}`, run: () => { team?.onLeave(); setPick(`s:${h.id}`); } }))) };
      })()}
      resting={stoppedOrchs(stopped, orchCwd, orchs).map((x) => {
        // 쉬는 참모(P2) — 누르면 이어서 켜기, 오른쪽 = 켜기·목록에서 지우기(옛 메뉴 그대로)
        const nm = orchDisplay(x) || x.name;
        return { key: x.sessionId || x.id, label: nm, node: <OrchAvatar name={x.name} size={26} state="off" color={colorOf(x.name)} label={nm} />, onWake: () => (onWakeOrch ?? onResume)?.(x),
          onMenu: act ? (e: React.MouseEvent) => act.openMenu(e, [
            ...(onWakeOrch ?? onResume ? [{ label: tr('이어서 켜기', 'Resume'), run: () => (onWakeOrch ?? onResume)?.(x) }] : []),
            ...(onRemoveStopped ? [{ label: tr('목록에서 지우기', 'Remove from list'), danger: true, run: () => act.confirm({ title: tr(`${nm} 지울까?`, `Remove ${nm}?`), body: tr('꺼진 세션 목록에서 빼 — 같은 이름으로 쌓인 옛 기록도 같이(대화 기록 파일은 남아).', 'Removes it from stopped sessions, with older ones under the same name (transcript files stay).'), ok: tr('지우기', 'Remove'), run: () => sameOrchSlot(stopped, x, orchCwd).forEach((y) => onRemoveStopped(y)) }) }] : []),
          ]) : undefined };
      })}
      sched={routines ? { on: featureOf(pick) === 'r:' && !teamOn, onToggle: () => featureTo('r:', 'toggle') } : undefined}
      onExpand={() => onMenuToggle?.()} />
  );
  // 다른 기기를 보는 중이면 띠·이음 색이 그 기기 것(peer-panel) — 이 맥 띠는 안 그릴 뿐 상태는 그대로
  const rail = far ? far.rail : railEl;
  const linkColor = far ? far.color : team?.railOn ? team.color : railList.find((a) => a.on)?.color;
  // 홈 곁가지(옛 참모 대시보드에서 옮김, 패널 하나로 7) — 위 알림 = 닫히지 않은 일·주인 없는 일, 오른쪽 = 참모 할 일·결정·분신
  const homeHint = (o: Session) => {
    const un = tasks ? unclosedOf(tasks.orphaned, events, o.id, tasks.known) : [];
    if (!un.length && !orphans.length) return undefined;
    return (
      <>
        {tasks && un.length > 0 && <div className="cv-hints"><UnclosedTasks cards={un} nameOf={(t) => targetLabel(t, tasks.known)} canResume={tasks.canResume} onResume={tasks.onResume} onFinish={tasks.onFinish} /></div>}
        {orphans.length > 0 && (
          <div className="cv-orphans">
            <div className="cv-orphans-head"><b>{tr(`누가 시켰는지 모르는 일 ${orphans.length}`, `${orphans.length} tasks with no owner`)}</b>
              <span>{tr(`맡긴 ${josa(assistant(), '이', '가')} 기록에 없는 옛 일이에요. 이 ${assistant()} 일로 붙이거나 끝난 걸로 정리하세요`, 'Old tasks with no recorded owner — claim them or mark done')}</span></div>
            {orphans.map((x) => (
              <div key={x.task} className="cv-orphan">
                <b>{x.target}</b><span>{x.title ?? ''}</span><em>{new Date(x.ts).toTimeString().slice(0, 5)}</em>
                <button onClick={() => void appendTaskEvent({ ts: new Date().toISOString(), type: 'own', task: x.task, from: o.id }).catch(() => {})}>{tr(`${seenName(o.name) || '참모'} 일로`, `Claim for ${seenName(o.name) || 'assistant'}`)}</button>
                <button onClick={() => void appendTaskEvent({ ts: new Date().toISOString(), type: 'done', task: x.task, note: tr('대시보드에서 정리', 'Tidied from dashboard') }).catch(() => {})}>{tr('끝난 걸로', 'Mark done')}</button>
              </div>
            ))}
          </div>
        )}
      </>
    );
  };
  const homeAside = (o: Session) => (
    <>
      <NotePanel base={note} storeKey={`noteEdits:${o.name || o.id}`} sendTo={oname(o)} onOpenStarter={hasStarter ? () => setPick(`d:${projectRoot(o.cwd)}/docs/starter.md`) : undefined}
        send={async (text) => { window.dispatchEvent(new CustomEvent('chat-pending', { detail: { id: o.id, text } })); await sendTextToSession(o.id, text); }} />
      <AgentList key={o.id} sid={o.sessionId} agents={agentsOf.current.get(o.id) ?? []} />
    </>
  );
  // 가운데 + 아래 세션 독(패널 하나로 S1, 어디서나) — 독 끝은 조용한 상태(대화 %, 60% 넘을 때만). framed = 이번 화면이 이미 독으로 감쌌나
  let framed = false;
  const lockerFrame = (lo: Session, center: React.ReactNode) => {
    framed = true;
    const ctx = ctxOf?.(lo);
    const held = heldBy(lo);
    const b = liveOf(lo, lives); // 참모 자기 브라우저 — 독 맨 앞 칸
    const lines = [...(b ? [ownBrowserLine(oname(lo), { live: b, tail: lo.sessionId ? tails[lo.sessionId] : undefined })] : []), ...held.map((s) => lineOf(s, cardName(s)))];
    return (
      <div className="lk-main">
        <div className="lk-center">{center}</div>
        <ActivityBar lines={lines} quiet={ctx !== undefined && ctx >= 60 ? tr(`대화 ${ctx}%`, `Context ${ctx}%`) : undefined}
          onOpenSession={(id) => setPick(`s:${id}`)} term={termOf} on={pick.startsWith('s:') ? pick.slice(2) : null}
          onMenu={act ? (e, id) => { const s = held.find((x) => x.id === id); if (!s) return; act.openMenu(e, [
            { label: tr('크게 보기', 'Open large'), run: () => setPick(`s:${id}`) },
            { label: tr('세션 끄기', 'Stop session'), danger: true, sep: true, run: () => act.askStop(s, cardName(s), 'dock') },
          ]); } : undefined} />
      </div>
    );
  };
  // 보관함 파일을 열거나 붙이기 직전 — iCloud 로 빠졌으면 먼저 내려받는다(보관함 밖 파일은 맥에 맡김)
  const fetched = (p: string) => (lockerTree.dir && p.startsWith(`${lockerTree.dir}/`) ? lockerApi.fetch(p).catch((e: unknown) => { lockerFail(e); return false; }) : Promise.resolve(false));
  const lockerActs = (lo: Session): CardActs => ({
    // 무엇이든 탭으로 연다 — md·엑셀은 편집 페이지, 그림·영상·html·pdf 는 탭 안 미리보기(2026-10-11 사용자). 모달은 '띄워 보기'·탭의 '크게 보기'
    onOpen: (p) => void fetched(p).then(() => {
      if (craftFirst(p)) { void openInCraft(p).catch(sayCraftErr); return; } // .ai·.psd·.dwg … 는 참모 앱으로(미리보기는 '띄워 보기', domain/craftOpen)
      if (!spacePage(p)) lockerOpened.current.set(p, Date.now());
      setLkHold((h) => openTab(h, lo.id, pick, p));
      setPick(`d:${p}`);
    }),
    onFloat: (p) => void fetched(p).then(() => { if (!spacePage(p)) lockerOpened.current.set(p, Date.now()); setModal({ path: p, ts: new Date().toISOString(), by: '' }); }),
    onSend: (p) => void fetched(p).then(() => attach(p)),
    sendTo: attachTo,
    onRename: (rel, name) => void lockerApi.rename(lockerOwner(lo), rel, name).catch(lockerFail),
    onTrash: (rel) => void lockerApi.trash(lockerOwner(lo), rel).catch(lockerFail),
    onReveal: (p) => void lockerApi.reveal(p).catch(lockerFail),
    onBack: (p) => void lockerApi.back(p).catch(lockerFail),
    onKeep: (p) => void lockerApi.put(lockerOwner(lo), [p]).then(lockerReport, lockerFail),
    loadVers: (p) => lockerApi.versions(p),
    onRestore: (p, n) => void lockerApi.restore(p, n).catch(lockerFail),
    findOrig: (p) => lockerApi.find(p),
    onRelink: (p, t) => void lockerApi.relink(p, t).catch(lockerFail),
    onAlias: (p, folder) => void lockerApi.alias(lockerOwner(lo), p, folder).catch(lockerFail),
    onMove: (rel, to) => void lockerApi.move(lockerOwner(lo), rel, to).catch(lockerFail),
    onReconnect: (rel) => void lockerApi.reconnect(lockerOwner(lo), rel).catch(lockerFail),
    onDisconnect: (rel) => void lockerApi.disconnect(lockerOwner(lo), rel).catch(lockerFail),
    onSendMany: (ps) => void Promise.all(ps.map(fetched)).then(() => { if (chatOrch) attachToChat(chatOrch.id, ps); }),
    onSendFolder: (p) => attach(folderChip(p)),
    onAliasMany: (ps, folder) => void lockerApi.aliasMany(lockerOwner(lo), ps, folder).catch(lockerFail),
    onMoveMany: (rels, to) => void lockerApi.moveMany(lockerOwner(lo), rels, to).catch(lockerFail),
    onTrashMany: (rels, foldersOk) => void lockerApi.trashMany(lockerOwner(lo), rels, foldersOk).catch(lockerFail),
    planTrash: (rels) => lockerApi.trashPlan(lockerOwner(lo), rels),
    onEmptyOut: (rels, to) => void lockerApi.emptyOut(lockerOwner(lo), rels, to).catch(lockerFail),
    onUndoTrash: () => void lockerApi.trashUndo().then((u) => { if (u.errors.length) lockerFail(u.errors.join('\n')); }, lockerFail),
  });
  // 단축키 — ⌘W 탭 닫기 · ⌘T 새 문서 · ⌘⇧H 홈 · ⌘⇧L 보관함 (App 이 SPACE_CMD 로 넘긴다, 2026-10-12 사용자). 최신 상태는 cmd 가 매 그리기에 새로 잡힌다.
  // 탭만 닫고 입력 초안(채팅 입력칸)은 건드리지 않는다 — 초안은 입력칸이 바뀔 때마다 따로 저장돼 있다
  const goHome = (lo: Session) => { if (tabRow(lkHold, lo.id, pick).homeOn) return; setLkHold((x) => leaveFolder(x, lo.id, pick)); setPick(lkPick(lo.id, { kind: 'home' })); };
  const goFolder = (lo: Session) => { const row = tabRow(lkHold, lo.id, pick); if (!row.folderOn) setPick(row.folderTo); };
  const cmd = (c: SpaceCmd) => {
    if (c === 'dash') { setPick(HOME, 'home'); return; }
    if (c === 'dashToggle') { setPick(dashToggle(pick, orch ? ownPick(screens.current.get(orch.id)?.pick, orch.id, homeOf(orch)) : ''), 'home'); return; }
    const lo = orch;
    if (!lo) return;
    if (c === 'closeTab') { const r = closeCurrentTab(lkHold, lo.id, pick); if (!r) return; setLkHold(r.hold); if (r.pick) setPick(r.pick); return; }
    if (c === 'newDoc') { void lockerApi.newDoc(lockerOwner(lo), newDocFolder(pick), 'md').then((p) => lockerActs(lo).onOpen(p), lockerFail); return; }
    if (c === 'home') goHome(lo); else goFolder(lo);
  };
  const cmdRef = useRef(cmd);
  cmdRef.current = cmd;
  useEffect(() => {
    const on = (e: Event) => cmdRef.current((e as CustomEvent<SpaceCmd>).detail);
    window.addEventListener(SPACE_CMD, on);
    return () => window.removeEventListener(SPACE_CMD, on);
  }, []);
  // 확대 명령 받기 — App 의 ⌘+ ⌘- ⌘0 ⌘9 가 window.__tabZoom 을 먼저 부른다, ⌘/Ctrl/Alt+휠·트랙패드 핀치(ctrlKey 붙은 wheel)·사파리 핀치(gesturechange)는 useWheelZoom 이 커서 자리와 같이
  const zoomRef = useRef(zoomCmd);
  zoomRef.current = zoomCmd;
  const canZoomRef = useRef(false);
  canZoomRef.current = canZoom;
  useEffect(() => {
    const w = window as unknown as { __tabZoom?: (c: ZoomCmd) => boolean };
    w.__tabZoom = (c) => zoomRef.current(c);
    return () => { delete w.__tabZoom; };
  }, []);
  useWheelZoom(() => (canZoomRef.current ? document.querySelector('.space .cv-main') : null), (dir, at) => zoomRef.current(dir, at));
  // 탭 줄 — 맨 왼쪽 고정 탭 둘(홈 집 · 보관함 폴더, 닫기 없음), 그 뒤로 연 파일. 연 탭이 없어도 늘 보인다(2026-10-12 사용자 — 나무 머리 켜기가 설정 토글로 착각됐다)
  const myDock = (orchId: string | undefined) => dockFor(dock, orchId, (it) => craftOwnerOfKey(it.by, it.app));
  const lockerTabs = (lo: Session, rootNew = false) => {
    const row = tabRow(lkHold, lo.id, pick);
    const h = lkHold && lkHold.orch === lo.id ? lkHold : null;
    const go = (p: string) => { if (h && pick.startsWith('l:')) setLkHold(leaveFolder(h, lo.id, pick)); setPick(tabPick(p)); };
    const close = (p: string) => { if (!h) return; const r = closeTab(h, p, pick); setLkHold(r.hold); if (r.pick) setPick(r.pick); };
    // 탭 오른쪽 클릭 — 크게·보내기 / 파인더(보관함 안) 또는 보관함에 넣기(밖) / 닫기
    const tabMenu = (e: React.MouseEvent, p: string) => {
      const a = lockerActs(lo);
      act?.openMenu(e, menuItems(lockerMenu({ kind: 'tab', inLocker: !!lockerTree.dir && p.startsWith(`${lockerTree.dir}/`) }), {
        big: { run: () => setModal({ path: p, ts: new Date().toISOString(), by: '' }) },
        send: { run: () => a.onSend(p), label: attachTo?.name ? tr(`${attachTo.name}에게 보내기`, `Send to ${attachTo.name}`) : undefined },
        reveal: { run: () => a.onReveal?.(p) },
        keep: { run: () => a.onKeep?.(p) },
        close: { run: () => close(p) },
      }));
    };
    return (
      <nav className="lk-tabs" aria-label={tr('열린 파일', 'Open files')}>
        <button className={`lk-tab home ${row.homeOn ? 'on' : ''}`} aria-pressed={row.homeOn} onClick={() => goHome(lo)}
          aria-label={tr('홈', 'Home')} title={`${tr('홈', 'Home')} ${keyLabel('⌘⇧H', IS_WIN)}`}><IconHome /></button>
        <button className={`lk-tab folder ${row.folderOn ? 'on' : ''}`} aria-pressed={row.folderOn} onClick={() => goFolder(lo)}
          data-locker-folder="" data-locker-drop="" aria-label={tr('보관함', 'Locker')} title={`${tr('보관함', 'Locker')} ${keyLabel('⌘⇧L', IS_WIN)}`}><IconFolder />{rootNew && <i className="lk-newdot" aria-label={tr('새 것 있음', 'New items')} />}</button>
        {/* 윈도우도(2026-10-21) — 0.3.4 땐 Rust 가 scripts/craft 를 바로 띄워 오류 원문만 떴다, 이제 python 으로 부른다(craft_window::craft_cmd) */}
        <button className={`lk-tab folder ${pick === APPS_KEY ? 'on' : ''}`} aria-pressed={pick === APPS_KEY} onClick={() => setPick(APPS_KEY)}
          aria-label={tr('Craft 앱', 'Craft apps')} title={tr('Craft 앱 — 사진·영상·문서·표 편집기', 'Craft apps — photo, video, document and spreadsheet editors')}><IconApps /></button>
        {/* 홈·보관함·앱은 늘 왼쪽에 — 독·파일 탭만 스크롤(2026-10-22 사용자 "넘치면 고정 탭이 같이 밀려난다") */}
        <TabStrip on={pick}>
        {myDock(lo.id).map((it, _i, mine) => {
          // Craft 독 아이콘 = 그 앱의 탭(글자 탭은 없다, 2026-10-19 사용자) — 누르면 그 칸, 지금 보는 앱은 선택 표시, 오른쪽 클릭 = 따로 창·꺼내기·끄기·최근 문서.
          // 이 참모 것만(주인 없는 것 포함) — 남의 참모 앱은 그 참모 독에(2026-10-21 사용자)
          const title = dockTitle(it, craftWho(it.by));
          const no = dockNo(mine, it);
          const on = pick === craftKey(it.app);
          const menu = act ? (e: React.MouseEvent) => act.openMenu(e, [
            { label: tr('따로 창으로', 'Open in its own window'), run: () => void invoke('craft_move', { app: it.app, to: 'window' }).catch(() => {}) },
            { label: tr('맥 앱으로 꺼내기 — 저장하고 내 화면에 다시 열기', 'Pop out to the macOS app — save and reopen on my screen'), run: () => void invoke('craft_win_act', { app: it.app, act: 'eject' }).catch(() => {}) },
            { label: tr('끄기 — 바뀐 게 있으면 저장하고', 'Quit — saves first if anything changed'), run: () => void invoke('craft_win_act', { app: it.app, act: 'close' }).catch(() => {}) },
            ...it.recent.map((f, i) => ({ label: recentLabel(f), sep: i === 0, run: () => void invoke('craft_open_file', { app: it.app, path: f }).catch(() => {}) })),
          ]) : undefined;
          return (
            <button key={`dock-${it.app}`} className={`lk-tab dock ${on ? 'on' : ''}`} aria-pressed={on} aria-label={title} title={title}
              onClick={() => void invoke('craft_show', { app: it.app }).catch(() => {})} onContextMenu={menu}>
              {it.icon ? <img src={it.icon} alt="" /> : <span className="lk-dock-letter">{dockLetter(it)}</span>}
              {it.dot && <i className={`lk-dock-dot ${it.dot}`} aria-hidden="true" />}
              {no && <b className="lk-dock-no" aria-hidden="true">{no}</b>}
            </button>
          );
        })}
        {browserDock({ name: oname(lo), live: ownLive(lo), who: hqHomeOf(lo)?.who }, heldBy(lo).map((s) => ({ name: cardName(s), live: liveOf(s, lives) }))).filter((it) => !stillClosed(closedB, it.live)).map((it) => {
          // 세션 브라우저 아이콘(2026-10-27 인앱 브라우저 시안 A) — 그 참모가 맡은 세션 것만, 세션 글자 배지. 누르면 스페이스 칸 전체가 그 브라우저.
          // 보는 중이면 올렸을 때 X = 숨기기(크롬·세션은 그대로), 오른쪽 클릭 = 브라우저 끄기(10-28 사용자 "아예 닫는 게 너무 어렵다")
          const title = dockTitleOf(it);
          const on = pick === browserKey(it.profile);
          const menu = act ? (e: React.MouseEvent) => act.openMenu(e, [
            ...(on ? [] : [{ label: tr('열기', 'Open'), run: () => setPick(browserKey(it.profile)) }]),
            { label: it.live.sessionPid > 0 ? tr('브라우저 끄기 — 세션이 다시 쓰면 새로 떠', 'Close the browser — it reopens when the session uses it') : tr('브라우저 끄기', 'Close the browser'), danger: true, sep: !on,
              run: () => void invoke('agent_close_browser', { profile: it.profile }).then(() => closedBrowser(it.profile, it.pid), () => {}) },
          ]) : undefined;
          return (
            <span key={`bdock-${it.profile}`} className={`lk-bdock-wrap ${on ? 'on' : ''}`}>
              <button className={`lk-tab bdock ${on ? 'on' : ''}`} aria-pressed={on} aria-label={title} title={title} onClick={() => setPick(browserKey(it.profile))} onContextMenu={menu}>
                <img src={BROWSER_ICON_SMALL} alt="" /><b className="lk-bdock-letter" aria-hidden="true">{it.letter}</b>
                {it.dot && <i className={`lk-bdock-dot ${it.dot}`} aria-hidden="true" />}
              </button>
              {on && <IconButton size="s" className="lk-bdock-x" label={tr(`${it.name} 브라우저 닫기`, `Close the ${it.name} browser`)} onClick={() => setClosingB(it)}><IconClose /></IconButton>}
            </span>
          );
        })}
        {row.tabs.map(({ path: p, on }) => {
          if (p.startsWith('c:')) {
            // 시안 검토 탭 — 파일 이름 + '검토' 표, 오른쪽 클릭 = 크게·닫기
            const fp = p.slice(2);
            return (
              <span key={p} className={`lk-tab ${on ? 'on' : ''} ${freshTab === p ? 'fresh' : ''}`} role="tab" aria-selected={on} tabIndex={0} onClick={() => go(p)} title={fp}
                onKeyDown={(e) => { if (e.key === 'Enter') go(p); }}
                onContextMenu={act ? (e) => act.openMenu(e, [{ label: tr('크게', 'Large'), run: () => { go(p); setCurBig(true); } }, { label: tr('탭 닫기', 'Close tab'), run: () => closeReview(fp) }]) : undefined}>
                <span>{fp.split('/').pop()}</span><i className="lk-tab-rv">{tr('검토', 'Review')}</i>
                <IconButton size="s" label={tr('탭 닫기', 'Close tab')} onClick={(e) => { e.stopPropagation(); closeReview(fp); }}><IconClose /></IconButton>
              </span>
            );
          }
          // Craft 칸(k:<앱>)은 글자 탭을 안 그린다 — 독 아이콘이 탭이다(2026-10-19 사용자 "앱 아이콘이 이미 탭 줄에 있고 앱 안 탭으로 문서가 나뉘니 겹친다")
          if (p.startsWith('k:')) return null;
          if (p.startsWith('s:')) {
            // 세션 탭 — 점 + 이름(꺼졌으면 흐리게), 오른쪽 클릭 = 닫기·세션 끄기
            const ss = sessions.find((x) => x.id === p.slice(2));
            const nm = ss ? cardName(ss) : tr('꺼진 세션', 'Ended session');
            return (
              <span key={p} className={`lk-tab sess ${on ? 'on' : ''} ${ss ? '' : 'gone'}`} role="tab" aria-selected={on} tabIndex={0} onClick={() => go(p)} title={ss ? `${nm} — ${ss.cwd}` : nm}
                onKeyDown={(e) => { if (e.key === 'Enter') go(p); }}
                onContextMenu={act ? (e) => act.openMenu(e, [{ label: tr('탭 닫기', 'Close tab'), run: () => close(p) }, ...(ss ? [{ label: tr('세션 끄기', 'Stop session'), danger: true, sep: true, run: () => act.askStop(ss, nm, 'tab') }] : [])]) : undefined}>
                {ss && <span className={`lk-dot d-${dotKind(lineOf(ss, nm))}`} aria-hidden="true" />}<span>{nm}</span>
                <IconButton size="s" label={tr('탭 닫기', 'Close tab')} onClick={(e) => { e.stopPropagation(); close(p); }}><IconClose /></IconButton>
              </span>
            );
          }
          const pj = projectOf(p, projectRoots);
          return (
          <span key={p} className={`lk-tab ${on ? 'on' : ''} ${freshTab === p ? 'fresh' : ''}`} role="tab" aria-selected={on} tabIndex={0} onClick={() => go(p)} title={p}
            onKeyDown={(e) => { if (e.key === 'Enter') go(p); }} onContextMenu={act ? (e) => tabMenu(e, p) : undefined}>
            <span>{titleOf(p)}</span>{pj && <i className="lk-tab-pj">{pj}</i>}
            <IconButton size="s" label={tr('탭 닫기', 'Close tab')} onClick={(e) => { e.stopPropagation(); close(p); }}><IconClose /></IconButton>
          </span>
          );
        })}
        </TabStrip>
      </nav>
    );
  };
  // 사무실 + 사무실 위 창 — 참모 탭 사무실(pick OFFICE)과 홈 안 사무실(홈 사무실 칸)이 같이 쓴다. dim = 흐리게 그릴 책상(지금 탭 참모가 안 시킨 세션)
  const officeView = (onDesk: (id: string) => void, dim?: (id: string) => boolean) => {
    if (!office) return null;
    const top = sheet[sheet.length - 1];
    return (
      <div className="cv-office">
        {office(onDesk, dim)}
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
  };
  let main: React.ReactNode = null;
  // 있던 프로젝트(clone)에 이 프로젝트 브라우저가 없으면 — 깔려 있고 안 붙었을 때만 보인다(GitHub #2)
  const browserBtn = (root: string, running: number) => <BrowserAttachButton key={`b:${root}`} dir={root} running={running} className="cv-btn" onDone={(m) => onMessage?.(m)} />;
  const toolsBtn = (root: string) => <button className="cv-btn" onClick={() => featureTo('t:', 'open', `t:${root}`)} title={tr('MCP·플러그인·스킬', 'MCP, plugins and skills')}>{tr('도구', 'Tools')}</button>;
  // 오케스트레이터 홈 — 머리를 눌렀거나('oh:'), 참모가 하나도 없는데 참모 화면을 보려던 참(2026-10-03 사용자)
  const atHome = pick === HOME || (!orchs.length && (pick === '' || pick.startsWith('o:') || pick === OFFICE));
  const seg = office ? <SideSeg office={pick === OFFICE} onPick={officeTo} /> : null;
  // 그 참모 대시보드·펫·사무실 — 세 칸 하나를 cv-main 오른쪽 위 한 자리에(아래 main 밖에 그린다)
  const side = orch && (office || pet) ? spaceView(pick, petFor, orch.id) : null;
  const pickSide = (want: SpaceSide) => {
    if (!orch) return;
    if (want === 'office') { officeTo('office'); return; }
    // 펫 = o:<참모>(펫 자리만 남았다), 대시보드 칸 = 그 참모 홈(옛 대시보드 자리, 2026-10-12 패널 하나로)
    const pet = want === 'pet' ? orch.id : null;
    petRef.current = pet;
    setPetFor(pet);
    setPick(pet ? `o:${orch.id}` : lkPick(orch.id, { kind: 'home' }));
  };
  const viewSeg = side && !atHome && !teamOn ? <ViewSeg side={side} pet={!!pet} office={!!office} onPick={pickSide} /> : null;
  const feat = featureOf(pick);
  if (feat === 'rv:') {
    // 리뷰 — 세션 열기는 스페이스 안에서 그 세션 화면으로
    main = reviewPage?.(pick.slice(3) || undefined, (k) => setPick(`rv:${k}`), (t) => { const s = findTarget(sessions, t); if (s) setPick(orchs.some((o) => o.id === s.id) ? `o:${s.id}` : `s:${s.id}`); }) ?? null;
  } else if (feat === 't:') {
    // 도구 — 기준 폴더는 고른 프로젝트, 없으면 채팅 탭 참모 HQ(2026-10-04 사용자)
    const root = pick.slice(2) || chatOrch?.cwd || orchCwd;
    const hq = orchCwd ? [{ name: tr(`${assistant()} HQ`, `${assistant()} HQ`), root: orchCwd }] : [];
    const roots = [...hq, ...groups.map((g) => ({ name: g.name, root: g.root })), ...idle].filter((r, i, a) => a.findIndex((x) => x.root === r.root) === i);
    main = <ToolsPage key={root} root={root} roots={roots} onRoot={(r) => setPick(`t:${r}`)}
      sessions={sessions.filter((s) => s.cwd === root || s.cwd.startsWith(`${root}/`))}
      onInvoke={chatOrch ? (name) => window.dispatchEvent(new CustomEvent(CHAT_INSERT, { detail: { id: chatOrch.id, text: `/${name}` } })) : undefined}
      onOpen={(p) => setPick(`d:${p}`)} computerUse={computerUse} />;
  } else if (feat === 'r:') {
    // 예약(P4) — r: = 목록, r:<이름> = 그 예약. 지우면 목록으로
    main = pick === 'r:' ? <RoutineList routines={routines ?? []} onOpen={(n) => setPick(`r:${n}`)} />
      : routinePage?.(pick.slice(2), () => setPick('r:'), chatOrch ? (text) => window.dispatchEvent(new CustomEvent(CHAT_INSERT, { detail: { id: chatOrch.id, text } })) : undefined) ?? null;
  } else if (feat === 'rp:') {
    main = replayPage?.() ?? null;
  } else if (feat === 'h:') {
    main = <HarnitorPanel key={orch?.id} onClose={() => featureTo('h:', 'close')} restore={hSel.current.get(orch?.id ?? '')} onView={(v) => hSel.current.set(orch?.id ?? '', v)} />;
  } else if (atHome && homeDash && orchs.length > 0) {
    // 홈 대시보드 HA(2026-10-24 사용자) — 누르면 그 참모(채팅 탭까지)·그 세션·그 기능
    // 참모로 가면 그 참모 탭이 기억하던 화면 그대로(홈은 탭의 보던 화면이 아니다 — screenBeforeHome)
    const goOrch = (id: string) => { const o = orchs.find((x) => x.id === id); if (!o) return; if (id === now.current.view) setPick(ownPick(screens.current.get(id)?.pick, id, homeOf(o))); else switchTo(id, 'home'); onChatTab?.(id); };
    main = homeDash({
      orch: goOrch,
      session: (t) => { const s = findTarget(sessions, t); if (!s) return; if (orchs.some((o) => o.id === s.id)) goOrch(s.id); else setPick(`s:${s.id}`); },
      feature: (k) => featureTo(k, 'open'),
      office: office && orch ? () => officeTo('office') : undefined,
      // 홈 사무실 칸 = 홈 안에서 크게(2026-10-25 사용자) — 참모 책상을 누르면 그때 그 참모 사무실로, 세션 책상은 이 안 창(domain/spaceOffice homeDeskTarget)
      officeBig: office && orch ? (close) => (
        <>
          <OnGone run={() => setSheet([])} />
          {officeView((id) => {
            const t = homeDeskTarget(id, orchIds);
            if ('sheet' in t) { setSheet([t.sheet]); return; }
            close();
            homeTouched.current = t.orch;
            officeTo('office');
          })}
        </>
      ) : undefined,
      touch: (id) => { homeTouched.current = id; },
      // 홈 기능 서랍(시안 home-inplace v1 D) — 같은 기능 화면을 서랍 안에. 서랍 속 이동(리뷰 PR·예약 하나·도구 폴더)은 서랍 안에서(fnSub), 문서·세션 열기만 크게
      fnPane: (k, close) => {
        const sub = fnSub?.k === k ? fnSub.v : undefined;
        const to = (v?: string) => setFnSub(v === undefined ? null : { k, v });
        const big = (p: string) => { close(); setPick(p); };
        const insert = chatOrch ? (text: string) => window.dispatchEvent(new CustomEvent(CHAT_INSERT, { detail: { id: chatOrch.id, text } })) : undefined;
        if (k === 'rv:') return reviewPage?.(sub, (x) => to(x), (t) => { const s = findTarget(sessions, t); if (s) big(orchs.some((o) => o.id === s.id) ? `o:${s.id}` : `s:${s.id}`); }) ?? null;
        if (k === 'r:') return sub ? routinePage?.(sub, () => to(), insert) ?? null : <RoutineList routines={routines ?? []} onOpen={(n) => to(n)} />;
        if (k === 'rp:') return replayPage?.() ?? null;
        if (k === 'h:') return <HarnitorPanel key={orch?.id} onClose={close} restore={hSel.current.get(orch?.id ?? '')} onView={(v) => hSel.current.set(orch?.id ?? '', v)} />;
        if (k === 't:') {
          const root = sub || chatOrch?.cwd || orchCwd;
          const hq = orchCwd ? [{ name: tr(`${assistant()} HQ`, `${assistant()} HQ`), root: orchCwd }] : [];
          const roots = [...hq, ...groups.map((g) => ({ name: g.name, root: g.root })), ...idle].filter((r, i, a) => a.findIndex((x) => x.root === r.root) === i);
          return <ToolsPage key={root} root={root} roots={roots} onRoot={(r) => to(r)} sessions={sessions.filter((s) => s.cwd === root || s.cwd.startsWith(`${root}/`))}
            onInvoke={insert ? (name) => insert(`/${name}`) : undefined} onOpen={(p) => big(`d:${p}`)} computerUse={computerUse} />;
        }
        return null;
      },
    });
  } else if (atHome && orchHome) {
    main = orchHome((id) => { const o = orchs.find((x) => x.id === id); if (!o) return; setPick(homeOf(o)); setNav({ view: id, chat: id }); onChatTab?.(id); });
  } else if (pick === OFFICE && office && orch) {
    // 책상·카드 = 사무실 위 창에 그 세션 칸(사무실을 떠나지 않음, 오피스 A 1단계), 참모 책상 = 그 참모 채팅 탭. 지금 탭 참모가 시킨 세션만 이름표·현황판 진하게
    const mine = new Set([orch.id, ...heldBy(orch).map((s) => s.id)]);
    main = officeView((id) => { const t = deskTarget(id, orchIds, orch.id); if (!t) return; if ('tab' in t) onChatTab?.(t.tab); else setSheet([t.sheet]); }, (id) => !mine.has(id));
  } else if (lp) {
    const lo = lockerOrch;
    const ls = lockerSide;
    main = lo && ls && place.kind === 'home' ? lockerFrame(lo, (
      <>{lockerTabs(lo, ls.rootNew)}<HomeView key={lo.id} hint={homeHint(lo)} aside={homeAside(lo)} progress={<HomeProgress orch={lo} events={events} sessions={sessions} readFill={sessionFill} />}
        modes={<ModeHome rows={modeRows} keys={[lo.name || '', lo.id, lo.sessionId || '']} dash={lo.name || lo.id}
          onAsk={(t) => { const text = tr(`홈에 모드 하나 만들어 줘 — ${t}`, `Make a mode for my home — ${t}`); window.dispatchEvent(new CustomEvent('chat-pending', { detail: { id: lo.id, text } })); void sendTextToSession(lo.id, text); }} />} /></>
    )) : lo && ls && place.kind !== 'home' ? lockerFrame(lo, (
      <>{lockerTabs(lo, ls.rootNew)}<LockerPage key={lo.id} dir={lockerTree.dir} place={place} entries={lockerTree.entries} log={ls.items} chips={ls.chips} projects={projectRoots}
        whoOf={(by) => (by === 'me' || by === lo.id ? who(by) : orchs.some((x) => x.id === by) ? who(by) : tr(`${who(by)} 세션`, `${who(by)} session`))}
        onPlace={(p) => { const k = lkPick(lo.id, p); docScroll.current.delete(scrollKey(now.current.view, k)); setPick(k); }}
        onChoose={(folder) => void lockerApi.choose(lockerOwner(lo), folder).then(lockerReport, lockerFail)}
        onConnect={(folder) => void lockerApi.connect(lockerOwner(lo), folder).catch(lockerFail)}
        onNewDoc={(folder, kind) => void lockerApi.newDoc(lockerOwner(lo), folder, kind).then((p) => lockerActs(lo).onOpen(p), lockerFail)}
        onNewFolder={(parent) => lockerApi.mkdir(lockerOwner(lo), parent, tr('새 폴더', 'New folder')).catch((e: unknown) => { lockerFail(e); return ''; })}
        acts={lockerActs(lo)} onBigProject={(id) => setPick(`s:${id}`)} onAddProject={onAddProject} /></>
    )) : <div className="cv-blank">{tr(`그 ${josa(assistant(), '이', '가')} 꺼졌어요`, 'That assistant is off')}</div>;
  } else if (pick.startsWith('o:')) {
    // 펫 자리 — 옛 참모 대시보드(o:)는 지웠다(패널 하나로 7). o: 는 펫 탭을 연 참모만 남는다(그 밖은 legacyPick 이 홈으로)
    const o = orchs.find((x) => x.id === pick.slice(2));
    main = o && pet && petFor === o.id ? <div className="cv-pet">{pet((id) => { const x = orchs.find((y) => y.id === id); return x ? { name: x.name || '', color: colorOf(x.name || '') } : null; })}</div> : null;
  } else if (holdOn && lkHold && lockerOrch) {
    docUp.current = lkHold.back; // ⌘[ 가 기록이 없으면 폴더로(탭 문서엔 뒤로 알약이 없다)
    main = lockerFrame(lockerOrch, (
      <>
        {lockerTabs(lockerOrch, !!lockerSide?.rootNew)}
        <div className="lk-doc-body">{filePage(docPath, { where: pathLine(docPath, lockerTree.dir, home ?? ''), keepFor: lockerOrch.id })}</div>
      </>
    ));
  } else if (pick === APPS_KEY) {
    // 앱 서랍 — 13개 Craft 앱 아이콘 격자(v3 덱 1)
    // 서랍도 이 참모 것만 — 켜짐 점·끄기는 내 인스턴스, 누르면 내 것을 보이거나 빈 자리에 새로(남의 참모 앱을 가져오지 않는다)
    const mine = myDock(lockerOrch?.id).map((d) => d.app);
    // key = 참모 — 서랍을 연 채 참모를 바꾸면 '여는 중'이 다른 참모 서랍에 남았다(리뷰)
    const page = <div className="lk-doc-body"><CraftDrawer key={lockerOrch?.id ?? ''} running={mine} all={dock.map((d) => d.app)} open={(app) => {
      const r = drawerOpen(app, dock.map((d) => d.app), mine);
      if ('key' in r && lockerOrch) setCraftOwner(r.key, lockerOrch.id); // 누른 참모가 주인 — 뜨는 사이 다른 참모로 옮겨도 그 참모 탭 줄에
      return r;
    }} openMenu={act?.openMenu} browser={IS_WIN ? undefined : {
      on: !!hqB && !!liveB(hqB),
      // 참모 브라우저 — 띄우고(떠 있으면 그대로) 그 칸으로. 이 참모 독에 아이콘이 생긴다
      open: () => invoke<string>('hq_browser_open').then((p) => { setHqB(p); if (lockerOrch) setHqOpener(lockerOrch.id); setPick(browserKey(p)); }, (e: unknown) => setCurNote(tr(`참모 브라우저를 못 띄웠어 — ${String(e)}`, `Could not open the Chammo browser — ${String(e)}`))),
    }} /></div>;
    main = lockerOrch ? lockerFrame(lockerOrch, <>{lockerTabs(lockerOrch, !!lockerSide?.rootNew)}{page}</>) : page;
  } else if (browserOfPick(pick) !== null) {
    // 세션 브라우저 칸(시안 A) — 칸은 비워 두고 네이티브 비추기가 그 위에(BrowserPane 이 자리·보이는지를 알린다). 숨기기 = 비추기만 떼고 홈으로
    const profile = browserOfPick(pick)!;
    const b = liveB(profile);
    const owner = lockerOrch ? [lockerOrch, ...heldBy(lockerOrch)].find((s) => liveOf(s, lives)?.profile === profile) : undefined;
    // 다른 참모가 쥔 HQ 브라우저를 서랍에서 연 것 · 세션 없이 띄운 것 — 보는 참모 이름을 달지 않는다
    const holder = owner ?? orchs.find((o) => liveOf(o, lives)?.profile === profile);
    const paneName = holder ? (orchs.includes(holder) ? oname(holder) : cardName(holder)) : profile === hqB ? tr('참모', 'Chammo') : profile;
    const hide = () => { if (lockerOrch) goHome(lockerOrch); else step(-1); };
    // 없으면 빈 칸 — 보던 게 꺼졌으면 위 효과가 곧 직전 탭으로 옮긴다
    const pane = <div className="lk-doc-body">{b
      ? <BrowserPane key={pick} live={b} name={paneName} onHide={hide} onClosed={closedBrowser} openMenu={act?.openMenu} />
      : <div className="cv-blank" />}</div>;
    main = lockerOrch ? lockerFrame(lockerOrch, <>{lockerTabs(lockerOrch, !!lockerSide?.rootNew)}{pane}</>) : pane;
  } else if (pick.startsWith('k:')) {
    // Craft 탭 — 칸은 비워 두고 네이티브 비추기가 그 위에(CraftPane 이 자리·보이는지를 알린다)
    const pane = <div className="lk-doc-body"><CraftPane key={pick} app={craftAppOf(pick)} place="space" whoOf={craftWho} /></div>;
    main = lockerOrch ? lockerFrame(lockerOrch, <>{lockerTabs(lockerOrch, !!lockerSide?.rootNew)}{pane}</>) : pane;
  } else if (pick.startsWith('c:')) {
    // 시안 검토 탭 — 탭 줄·독은 그대로, 가운데에 검토(채팅 칸도 그대로 보이고 칠 수 있다). '크게'면 아래에서 창 전체로 그리고 여긴 비운다
    const review = curBig ? <div className="cv-blank" /> : curationEl(pick.slice(2), false);
    main = lockerOrch ? lockerFrame(lockerOrch, <>{lockerTabs(lockerOrch, !!lockerSide?.rootNew)}{review}</>) : review;
  } else if (pick.startsWith('d:')) {
    // 알약은 적힌 이름(주인 대시보드·부모 페이지)으로 간다 — 기록 뒤로(step)였더니 직전 시안 화면으로 돌아갔다(2026-10-10 사용자). 기록 뒤로는 ⌘[
    main = filePage(pick.slice(2), { onBack: (upKey) => (upKey ? setPick(upKey, 'up') : step(-1)), keepFor: orch?.id });
  } else if (cur && lockerOrch) {
    // 세션 탭(패널 하나로 S4) — 탭 줄·나무·독은 그대로, 가운데에 큰 터미널 + 오른쪽 할 일·최근 결정
    const root = projectRoot(cur.cwd);
    const g = groups.find((x) => x.root === root);
    main = lockerFrame(lockerOrch, (
      <>
        {lockerTabs(lockerOrch, !!lockerSide?.rootNew)}
        <SessionPage key={cur.id} title={cardName(cur)} mark={<StateMark st={statusOf(cur)} />} meta={live[cur.id]?.line || stateWord(cur)}
          path={home && cur.cwd.startsWith(home) ? `~${cur.cwd.slice(home.length)}` : cur.cwd}
          actions={<>{toolsBtn(root)}{browserBtn(root, g?.sessions.length ?? 1)}{onNewSession && g && <button className="cv-btn" onClick={() => onNewSession(g.root, g.name)}>{tr('새 세션', 'New session')}</button>}{seg}</>}
          body={sessionInner(cur)} lists={plists} onOpenStarter={() => setPick(`d:${root}/docs/starter.md`)} />
      </>
    ));
  } else {
    main = <div className="cv-blank">{tr('왼쪽 메뉴에서 골라 줘', 'Pick something from the menu')}</div>;
  }

  // 팀 모드 — 스페이스 전체가 팀 것(팀 홈·팀 보관함·연 파일, 참모 탭 줄·독 없음). 참모 화면 고름(pick)은 그대로 두어 돌아오면 보던 곳
  if (teamOn && team?.space) { main = team.space.view((p) => (craftAppOf(p) ? craftPaneOf(p) : filePage(p, {})), undefined, (k) => craftNames.current.get(craftAppOf(k))); framed = true; }
  // 보관함 밖 화면(세션·기능)도 그 참모 세션 독을 아래에 — 사무실·시안 검토·오케스트레이터 홈은 빼고
  const dockOrch = lockerOrch ?? orch;
  if (main && dockOrch && !framed && pick !== OFFICE && !atHome) main = lockerFrame(dockOrch, main);

  const chatHid = (atHomePick && !teamOn) || (teamOn && !!team?.fold);
  return (
    <div className="space cv">
      {keep.host()}
      {/* 왼쪽은 띠만 — ⌘B 는 띠를 넓힐 뿐(패널 하나로 P1 A). 보관함 나무 칸은 없앴다(2026-10-12 사용자 '이제 필요 없겠다' — 홈·보관함 고정 탭 + 가운데 경로 줄) */}
      {rail}
      {/* 홈을 보는 동안·팀 모드에서 메신저를 접은 동안 채팅 칸은 숨기기만(터미널 붙임·입력 그대로) */}
      {/* 떠 있는 배지 대화창이 열리면 숨던 칸도 붙인 채 안 보이게만(obb-ghost) — 칸 안 참모 채팅이 떠 있는 창으로 뜬다 */}
      <div className={`cv-chat-slot${chatHid && bub.open ? ' obb-ghost' : ''}`} hidden={chatHid && !bub.open}><BubbleFloatCtx.Provider value={bub.float}>{chat}</BubbleFloatCtx.Provider></div>
      {/* 고른 프사 ↔ 채팅 카드 — 참모 색 윤곽선 하나(맞닿는 변만 열림) */}
      {chat && (!atHomePick || teamOn) && !(teamOn && team?.fold) && <ChatLink color={linkColor} />}
      {closingB && (() => {
        const q = closeAsk(closingB);
        const it = closingB;
        return <Confirm title={q.title} body={q.body} ok={tr('닫기', 'Close')} danger onCancel={() => setClosingB(null)}
          onOk={() => { setClosingB(null); void invoke('agent_close_browser', { profile: it.profile }).then(() => closedBrowser(it.profile, it.pid), () => {}); }} />;
      })()}
      {far && far.main}
      {/* 기다리는 동안 옛 화면은 못 누른다 — 눌리면 옛 참모 보관함 자리가 박혀 다른 참모 기억으로 옮아 갔다(2026-10-13) */}
      <main inert={held} hidden={!!far} className={`cv-main ${viewSeg && !hold ? 'has-viewseg' : ''}`}>
        {held ? shownMain.current : (shownMain.current = main)}
        {hold ? null : viewSeg}
        {/* 다른 참모가 띄운 것·시안 — 스페이스 가운데 아래 한 줄(채팅 칸에 걸치지 않게 main 안) */}
        {curNote && <div className="cv-cur-note" role="status">{curNote}</div>}
        {switching && <div className="cv-switch" aria-live="polite"><span className="cv-spin" /><b>{tr(`${oname(orchs.find((x) => x.id === switching) ?? orch!)} 불러오는 중`, `Loading ${switching}`)}</b></div>}
      </main>
      {/* 참모 모드 — '스페이스 패널로' 켠 것은 오른쪽에, 미리보기·꽉 채우기는 스페이스 위에(따로 창이 기본) */}
      <ModePanel rows={modeRows} />
      <ModeLayer rows={modeRows} />
      {teamGive.node}
      {modal && <Preview f={modal} onClose={() => setModal(null)} onAttach={attachOf(modal.path)} attachTo={attachToOf(modal.path)} onSendText={send} onCuration={toCuration} />}
      {pick.startsWith('c:') && curBig && curationEl(pick.slice(2), true)}
    </div>
  );
}
