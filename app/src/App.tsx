import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appRoots, closableByShortcut, groupByProject, isOrchestratorName, legacyAssistants, nextOrchestratorName, orchView, parseAgents, projectDir, seenName, sessionsToStop, toolsWay, withinRoots, type Session } from './domain/session';
import { moveInOrder, orchSort, stepTarget } from './domain/orchOrder';
import { askNotice, askPlaced, askTarget, popupNotice, readAskCardKey } from './domain/agentAsk';
import { samePath } from './domain/paths';
import { EMPTY_LAYOUT, gridKeyOf, layoutReducer, maxTarget, revealPane, type LayoutAction, type PaneLayout } from './domain/paneLayout';
import { accountsApi, readUsage, setOrchLegacy, todayCommits, type RepoToday, sendTextToSession } from './data/tauri';
import { ACCOUNTS_CHANGED, topLabel, usageOf, type AccountsView } from './domain/accounts';
import { useAccountAuto } from './ui/useAccountAuto';
import { useLogin } from './ui/useLogin';
import { LoginCard, TermsCards } from './ui/LoginCard';
import { useBrowserNeeds } from './ui/BrowserAttach';
import { dayStart, parseUsage, TODAY_COMMITS_MS, type Usage } from './domain/usage';
import { FeatureRow, type FeatureProps } from './ui/FeatureButtons';
import { railItems } from './domain/topbarMenu';
import { TopBar } from './ui/TopBar';
import { ChatVoice } from './ui/chat/chatVoice';
import { HarnitorPanel } from './ui/HarnitorPanel';
import { ToolsFloat } from './ui/ToolsFloat';
import { reportView } from './ui/viewReport';
import { selectionWord } from './domain/viewNow';
import { Setup } from './ui/Setup';
import { Tour } from './ui/Tour';
import { QuitDialog } from './ui/QuitDialog';
import { CraftOpenAsk } from './ui/craft/openInCraft';
import { LicensesDialog } from './ui/LicensesDialog';
import { RoutinePage } from './ui/RoutinePage';
import { isCloud, parseRoutines, routineItem, routineState, type Routine } from './domain/routine';
import { shouldShowTour } from './domain/tour';
import { useTama } from './ui/tama/useTama';
import { PetView } from './ui/tama/PetView';
import { PetModal } from './ui/tama/PetModal';
import { orchColor } from './domain/avatar';
import { ReplayPage } from './ui/ReplayPage';
import { LoadPage } from './ui/LoadPage';
import { useLoad } from './ui/useLoad';
import { level } from './domain/load';
import { bypassConsent, bypassConsentAccept, pickFolder, readConfig, reloadConfig, routineDo, routinesList, type Config } from './data/tauri';
import { allowed, featuresOf, mirrorPlan, type FeatureSwitch } from './domain/config';
import { setAnimation } from './ui/calm';
import { addExtraProject, versionWarning } from './domain/setup';
import { claudeUpdateNote, verLabel } from './domain/updates';
import { useUpdates } from './ui/useUpdates';
import { useAccessWatch } from './ui/useAccessWatch';
import { AccessBanners } from './ui/AccessBanners';
import { OPEN_SETUP, SPACE_NAV, spaceCmd } from './ui/space/navSignal';
import type { SetupStart } from './domain/settingsTabs';
import { LoginGate } from './ui/LoginGate';
import { picking } from './ui/chat/modelPickRun';
import { appUpdateInstall, openTarget as openLink } from './data/tauri';
import { installNote, runInstall, type Phase as InstallPhase } from './domain/appInstall';
import { assistant, getLang, josa, tr } from './i18n';
import { getAppEnv, listSessionsAllRaw, listSessionsRaw, readSay, writeVoiceMode, speak, projectScan, readTasksSince, readTranscriptTails, DEEP_TAIL, spawnSession, type AppEnv } from './data/tauri';
import { freshReplies, heldTarget, parseSay, pickSay, routeReply, takeHeld, talkedTo, voiceTurn, type ReplySeen, type VoiceHeld } from './domain/voice';
import { baseVoice, voiceFor } from './domain/avatar';
import { avatarSnapshot, refreshAvatars, setAvatarTts } from './ui/avatar';
import { blockedBody, cardTarget, cardToken, readNoteTarget } from './domain/notify';
import { notifyOnce } from './ui/notifier';
import { AgentAskHost, AskCards, browserMenu, browserOwnsKey, openAgentModal, PopupCards } from './ui/AgentBrowserModal';
import { useDirectCards } from './ui/useDirectCards';
import { useShowLog } from './ui/space/useShowLog';
import { chatFiles, showOwnerOf, type ChatFile } from './domain/chatFiles';
import { ChatFileCard } from './ui/chat/ChatFileCard';
import { freshAppCards, kindView, needsAnswer } from './domain/directAsk';
import { useAgentLives } from './ui/AgentBrowser';
import { every } from './ui/poll';
import { askName, liveOf, takeoverLine, type Live } from './domain/agentBrowser';
import { activityStatus, docBadges, liveLine, needsHarness, sessionStatus, settled, transitions, type ActivityStatus, type ProjectDoc } from './domain/status';
import { summarizeTranscript, type Activity, type Line } from './domain/activity';
import { giverTurn, quietHanded } from './domain/handedAsk';
import { clampFont, DEFAULT_FONT, dedupeMs, frameZoomCmd, gotoOfNum, menuAction, onceAcross, onceWithin, shortcutFor, zoomTarget, type Shortcut, type ZoomArea } from './domain/shortcuts';
import { foldTasks, splitCards, type TaskEvent } from './domain/tasks';
import { makeTaskLog } from './domain/taskTail';
import { routineSessions, routineStalls } from './domain/login';
import { TaskPanel, type SessionActivity } from './ui/TaskPanel';
import { invoke } from '@tauri-apps/api/core';
import { OrchActionsProvider, useOrchActions } from './ui/orchActions';
import { orchDisplay, orchLabel, orchLabelsNow, setOrchLabel, setOrchRoster, useOrchLabels } from './ui/orchLabels';
import { Confirm, NameNew } from './ui/OrchDialogs';
import { consentBeforeSpawn, isDisclaimerError } from './domain/bypassConsent';
import { dupRenames, labelRenames, nickProblem, renamesToSend, withNick, type RenameSent } from './domain/orchLabel';
import { orchIntro } from './domain/orchIntro';
import { markReader, ReaderPanel, readerFocused } from './ui/reader/ReaderPanel';
import { selectAllHere } from './ui/selectAll';
import { IS_WIN, type Surface } from './domain/reader';
import { keyLabel } from './domain/keys';
import './ui/reader/reader.css';

/** 리더 패널에서 보던 탭 닫기 */
const previewMaxFn = () => (window as unknown as { __previewMax?: () => void }).__previewMax;
const previewZoomFn = () => (window as unknown as { __previewZoom?: (d: 1 | -1 | 0) => void }).__previewZoom;
/** 스페이스 탭 확대(SpaceView 가 건다, 2026-10-12) — 확대할 탭이 떠 있으면 처리하고 true, 아니면 false(터미널·채팅 글자 크기로) */
const tabZoomFn = () => (window as unknown as { __tabZoom?: (c: 1 | -1 | 0 | 'fit') => boolean }).__tabZoom;
/** 화면 영역 — ⌘+ ⌘- ⌘0 이 채팅·터미널 글자냐 스페이스 탭 확대냐(domain/shortcuts zoomTarget, 2026-10-22 사용자 제보) */
const zoomAreaOf = (el: Element | null): ZoomArea =>
  !el || el === document.body ? 'none' : el.closest('.xterm') ? 'term' : el.closest('.chat') ? 'chat' : el.closest('.space .cv-main') ? 'tab' : 'none';
const readerZoom = (dir: 1 | -1 | 0) => (window as unknown as { __readerZoom?: (d: 1 | -1 | 0) => void }).__readerZoom?.(dir);
const readerCloseActive = async () => { const st = await invoke<Surface>('reader_state', { surface: 'dock' }); if (st.active) await invoke('reader_close', { surface: 'dock', path: st.active }); };
import { Sidebar, type Selection } from './ui/Sidebar';
import { AdoptCard } from './ui/AdoptCard';
import { ProjectBar } from './ui/ProjectBar';
import { SessionGrid, type MemoHooks } from './ui/SessionGrid';
import { MemoPanel } from './ui/MemoPanel';
import { useLessons } from './ui/useLessons';
import { groupRequest } from './domain/lessons';
import { useMemos } from './ui/useMemos';
import { TerminalPane } from './ui/TerminalPane';
import { StoppedStrip } from './ui/StoppedStrip';
import { isRemoteTarget } from './domain/orphans';
import { allDue, singleFlight } from './domain/pollGate';
import { orphanSession, parseStopped, recentDelegated, resumable, stoppedOrchs, type StoppedSession } from './domain/stopped';
import { arrivedOrch, creatingRow } from './domain/orchRows';
import { WakeNotice } from './ui/chat/WakeNotice';
import { inferRoles, parseRoles, roleHeir, type RoleMap } from './domain/orchRoles';
import { setOrchRoleData, saveOrchRole, orchRoleOf, onOrchRolesSaved } from './ui/orchRoleStore';
import { autoRestore, parseSnap, stepSnapshot, type LiveSnap, type SnapSession } from './domain/revive';
import { useLostTriage } from './ui/useLostTriage';
import { useAutoTidy } from './ui/useAutoTidy';
import { useGoalStall } from './ui/useGoalStall';
import { useOrchRevive } from './ui/useOrchRevive';
import { useRoutineStalls } from './ui/useRoutineStalls';
import { isHqOrch } from './domain/lostTriage';
import { parseSpawnOutput } from './domain/adopt';
import { OrphanActions } from './ui/Revive';
import { OfficeView } from './ui/office/OfficeView';
import { SpaceView } from './ui/space/SpaceView';
import { OrchHome } from './ui/space/OrchHome';
import { HomeDash, type HomeGo } from './ui/space/HomeDash';
import { resumedOrch, showHome } from './domain/orchHome';
import { OfficeDock } from './ui/office/OfficeDock';
import { noteOf } from './domain/dock';
import { skinOf } from './ui/office/skins';
import { Shop } from './ui/gacha/Shop';
import { FurnitureTray } from './ui/office/FurniturePanel';
import { OfficeModal, OfficeTools, type OfficeTab } from './ui/office/OfficeMenu';
import { useGacha } from './ui/gacha/useGacha';
import { gachaBridge } from './ui/gacha/phoneBridge';
import { EMPTY_GACHA, ownedOf, ownedSkins, skinOfFile } from './domain/gacha';
import { gachaDeco, officeShape } from './domain/phoneOffice';
import { workAct } from './domain/activity';
import { canPlace, delivery, deliveryTail, placedCells, planRoom, seatSlots, stampSeen, withLounge, type Seat } from './domain/office';
import { spriteOf } from './ui/tama/lcd';
import { Grip } from './ui/TaskPanel';
import { IconClose, IconDownload, IconStack, IconTabs, IconUpdate } from './ui/Icons';
import { RemoteChat, REMOTE_CHAT_EVENT, type RemoteChatTarget } from './ui/chat/RemoteChat';
import { FAR_BLOCKED, FAR_NUM, FAR_PICK, farActive, useFarMode } from './ui/far/Far';
import { useTeamMode } from './ui/team/useTeamMode';
import { FloatHost } from './ui/space/OrchBubble';
import { CONVO as TEAM_CONVO } from './domain/teamLayout';
import { teamTarget } from './domain/teamChat';
import type { SettingsTab } from './domain/settingsTabs';
import { useRemoteCards } from './ui/useRemoteCards';
import { IconButton } from './ui/kit/IconButton';
import type { TaskCard } from './domain/tasks';
import { sessionOrigins } from './data/tauri';
import { BUSY_POLL, listErrorText } from './domain/busyGate';
import { busyNow } from './ui/busyNow';
import { appendTaskEvent, removeSession, daemonStartedAt, readOrchPins, setOrchPin, readOrchOrder, setOrchOrder, readOrchRoles, readLiveSnap, resumeSession, writeLiveSnap, newSession, readAutoAllow, readCtx, sendToSession, setBadge, stopSession, tamaWidget, writeClipboard } from './data/tauri';
import { parseAllowLog, type AllowLog } from './domain/autoAllow';
import { useAutoAllow } from './ui/useAutoAllow';
import { useForwardQuestions } from './ui/useForwardQuestions';
import { useForeignBrowsers } from './ui/useForeignBrowsers';
import { useDaemonEnv } from './ui/useDaemonEnv';
import { useAskWake } from './ui/useAskWake';
import { useCraftHandback } from './ui/useCraftHandback';
import { bornAfter, buildInbox, decideNote, findTarget, freshItems, popoverOpen, replyBlocked, type InboxItem } from './domain/inbox';
import { InboxPopover, InboxRow } from './ui/Inbox';
import { ctxAlerts, parseCtx, type Ctx } from './domain/ctx';
import { useReview } from './ui/useReview';
import { ReviewPage } from './ui/ReviewPage';
import { ReviewStrip } from './ui/ReviewStrip';
import { splitOpen } from './domain/reviewSummary';
import { focusPlan, intentOf, openShortcut, opensHomeDash, withFeature } from './domain/appctl';
import { bumpUsage, gachaPhoneReply, rebuildMenu, writeConfig, writeOffice } from './data/tauri';
import { useSpeakGlowPoll } from './ui/speakGlow';
import { attachCommand } from './domain/termCommand';
import { chatViewOf, type ChatView } from './domain/space';

/** 앱을 켠 때 — 이전 결정은 알림으로 다시 안 띄운다(domain/inbox bornAfter) */
const APP_STARTED = Date.now();

const POLL_MS = 3000;

// 사용자 설정은 이 컴퓨터에만 — 없거나 막혀 있으면 기본값
const load = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v == null ? d : (JSON.parse(v) as T);
  } catch {
    return d;
  }
};
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // 저장 못 해도 이번 실행 동안은 동작한다
  }
};

/** 설정의 언어·비서 이름을 localStorage 로 비춘다(main.tsx 가 다음에 뜰 때 읽는다). 이번 화면이 설정과 다르면 한 번만 다시 연다 */
function mirrorConfig(c: Config) {
  const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
  const plan = mirrorPlan(c, { lang: get('lang'), assistantName: get('assistantName') }, getLang());
  try {
    for (const [k, v] of Object.entries(plan.writes)) {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    }
  } catch {
    return; // 못 비추면 다시 열어도 똑같다 — 그대로 쓴다
  }
  if (!plan.reload) return;
  try {
    if (sessionStorage.getItem('mirrorReloaded')) return; // 다시 열었는데도 다르면 멈춘다(무한 새로고침 방지)
    sessionStorage.setItem('mirrorReloaded', '1');
  } catch {
    return;
  }
  location.reload();
}

/** 동의 카드에 보이는 깃발 이름 — 하이픈마다 뒤에 단어 잇기(U+2060)를 붙여 '(--' / 'dangerously-skip-permissions)' 처럼 이름 가운데서 줄이 안 갈리게(윈도우 QA 31) */
const SKIP_FLAG = '--dangerously-skip-permissions'.replace(/-/g, '-\u2060');

export default function App() {
  const [env, setEnv] = useState<AppEnv | null>(null);
  const updates = useUpdates(env?.claudeVersion, env?.claudeBin);
  // 설정(config.json) — 못 읽은 동안엔 기능을 다 켠 것으로(featuresOf)
  const [config, setConfig] = useState<Config | null>(null);
  // 참모 목소리 — 설정 음성 명령을 프사 저장소에 알린다(고르기 창·참모 답 읽기가 쓴다)
  useEffect(() => { if (config) setAvatarTts(config.ttsCommand); }, [config]);
  // 프로필은 폰에서도 바꾼다(/api/avatar) — 10초마다 다시 읽어 따라온다(안 바뀌면 저장소가 새 값을 안 내 다시 안 그린다)
  useEffect(() => every(() => void refreshAvatars(), 10_000), []);
  const features = featuresOf(config);
  const featuresRef = useRef(features);
  // 설정 > 기능 > 애니메이션(자동·줄이기·끄기) — 문서 맨 위 class 로(ui/calm)
  useEffect(() => { setAnimation(features.animation); }, [features.animation]);
  // 첫 실행(설정 파일에 setupDone 없음)이면 설정 화면이 안내를 겸한다. 메뉴 설정…(⌘,)으로 언제든 연다
  const firstRun = config?.setupDone === false;
  // 둘러보기 — 마법사를 끝낸 뒤 한 번, 그다음은 ⌘/ · Chammo 메뉴 > 둘러보기
  // 세션 브라우저 상태(사람 부름 감지용) — 스페이스 밖 화면에서도
  const agentLives = useAgentLives();
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    if (config && shouldShowTour({ setupDone: config.setupDone, seen: load('tourSeen', false) })) setTourOpen(true);
  }, [config?.setupDone]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeTour = () => { setTourOpen(false); save('tourSeen', true); };
  // ⌘Q 종료 확인 — 앱만 끌지, Chammo 가 다루는 세션까지 끌지
  const [quitOpen, setQuitOpen] = useState<boolean | 'dock'>(false);
  const [licensesOpen, setLicensesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 다른 기기 참모 채팅(ADR 0011) — 고르면 채팅 열이 그 참모로, 왼쪽 띠에서 내 참모를 누르면 원래대로
  const [remoteChat, setRemoteChat] = useState<RemoteChatTarget | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<RemoteChatTarget>).detail;
      if (!t?.dev || !t.agent) return;
      setRemoteChat(t);
      setSettingsOpen(false);
      setSpace(true);
    };
    window.addEventListener(REMOTE_CHAT_EVENT, on);
    return () => window.removeEventListener(REMOTE_CHAT_EVENT, on);
  }, []);
  // 하니터 — 하네스 보기·끄고 켜기(탑바 버튼·scripts/app open harnitor)
  // 스페이스(채팅 뷰)에선 탭마다 기억되는 화면이라 SpaceView 가 띄우고 여기는 요청만 넘긴다(harnitorReq) — harnitorOpen 은 지금 탭에 떠 있나(탑바 버튼).
  // 스페이스가 없을 때(참모가 아직 없음 등)만 앱 전체 위에 띄운다(harnitorFloat)
  const [harnitorOpen, setHarnitorOpen] = useState(false);
  const [harnitorFloat, setHarnitorFloat] = useState(false);
  const [harnitorReq, setHarnitorReq] = useState<'open' | 'close' | 'toggle' | null>(null);
  // 채팅 뷰 사무실 — 하니터처럼 탭마다 기억되는 스페이스 화면이라 SpaceView 가 띄우고, 여기는 요청만(탑바·⌘4·scripts/app). spaceOffice = 지금 탭에 떠 있나
  const [officeReq, setOfficeReq] = useState<'open' | 'close' | 'toggle' | null>(null);
  const [spaceOffice, setSpaceOffice] = useState(false);
  // 터미널 뷰에서 열면 채팅 뷰로 넘어가 스페이스에 띄운다(오른쪽 참모 채팅을 보며 부탁하라고) — 닫으면 터미널 뷰로 돌아간다
  const harnitorSwitched = useRef(false);
  const harnitorRef = useRef<(req: 'open' | 'close' | 'toggle') => void>(() => {});
  // 도구(MCP·플러그인·스킬) — 위 막대 아이콘·scripts/app open tools(2026-10-05 사용자, 스페이스 사이드바 줄에서 옮김).
  // 화면이 스페이스에만 있어서 터미널 뷰에서 열면 채팅 뷰로 넘어가 지금 탭에 띄우고, 닫으면 터미널 뷰로 돌아간다(하니터와 같은 길)
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsReq, setToolsReq] = useState<'open' | 'close' | 'toggle' | null>(null);
  // 터미널 뷰 'adopt'(붙인 세션 하나)는 채팅 뷰에도 스페이스가 없다 — 그때만 앱 전체 위에(하니터 float 와 같게)
  const [toolsFloat, setToolsFloat] = useState(false);
  const toolsSwitched = useRef(false);
  const toolsRef = useRef<(req: 'open' | 'close' | 'toggle') => void>(() => {});
  // 리뷰(PR) — 위 막대 아이콘·⌥⌘3·scripts/app open|close review(2026-10-06 사용자, 사이드바 줄에서 옮김 "이 패널은 이제 전체가 다 세션").
  // 채팅 뷰는 스페이스 화면(rv:)을 탭마다 여닫고, 터미널 뷰는 원래 있던 리뷰 화면(selected review) — 닫으면 열기 전 화면으로
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewReq, setReviewReq] = useState<'open' | 'close' | 'toggle' | null>(null);
  const reviewBefore = useRef<Selection | null>(null);
  const reviewRef = useRef<(req: 'open' | 'close' | 'toggle') => void>(() => {});
  // 하루 리플레이 — 리뷰와 같은 길: 채팅 뷰는 스페이스 기능 화면(rp:)을 켜고 끄고, 터미널 뷰는 원래 화면(selected replay)을 켜고 끈다(2026-10-11 사용자)
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayReq, setReplayReq] = useState<'open' | 'close' | 'toggle' | null>(null);
  const replayBefore = useRef<Selection | null>(null);
  const replayRef = useRef<(req: 'open' | 'close' | 'toggle') => void>(() => {});
  const [settingsStart, setSettingsStart] = useState<SetupStart | undefined>();
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>();
  useEffect(() => {
    const on = (e: Event) => { setSettingsStart((e as CustomEvent<SetupStart>).detail); setSettingsOpen(true); };
    window.addEventListener(OPEN_SETUP, on);
    return () => window.removeEventListener(OPEN_SETUP, on);
  }, []);
  featuresRef.current = features;
  useEffect(() => {
    readConfig().then((c) => { mirrorConfig(c); setConfig(c); }).catch(() => {});
  }, []);
  const [sessions, setSessions] = useState<Session[]>([]);
  // 루틴 — 루틴 세션은 데이터 폴더에서 돌아 위 목록(프로젝트·HQ 안만)에서 빠지므로, 거르기 전 전체 목록을 따로 들고 있는다
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const pullRoutines = useCallback(() => void routinesList().then((t) => setRoutines(parseRoutines(t))).catch(() => {}), []);
  useEffect(() => {
    pullRoutines();
    return every(pullRoutines, 5000);
  }, [pullRoutines]);
  const [error, setError] = useState<string | null>(null);
  // 목록 읽기가 낸 오류만 목록 읽기가 지운다 — 예전엔 폴링이 성공할 때마다 지워서 참모 띄우기 실패 같은 오류가 몇 초 만에 사라졌다(2026-10-03 QA 2번)
  const listFailed = useRef(false);
  const listFails = useRef(0);
  // 세션 목록을 마지막으로 받은 때 — 한동안 안 오면 옛 상태를 믿지 않고 '모름'(domain/status LIST_STALE_MS)
  const listAt = useRef<number | undefined>(undefined);
  const [selected, setSelected] = useState<Selection>({ kind: 'orchestrator' });
  const [spawning, setSpawning] = useState(false);
  const [fontSize, setFontSize] = useState<number>(() => load('fontSize', DEFAULT_FONT));
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => load('sidebarOpen', true));
  const [tasksOpen, setTasksOpen] = useState<boolean>(() => load('tasksOpen', true));
  const [tasksWidth, setTasksWidth] = useState<number>(() => load('tasksWidth', 260));
  useEffect(() => save('tasksWidth', tasksWidth), [tasksWidth]);
  // 리더 패널(작업 패널 왼쪽) — ⌘E·메뉴로 열고 닫고, 참모가 scripts/show 하면 열린다
  const [readerOpen, setReaderOpen] = useState<boolean>(() => load('readerOpen', false));
  useEffect(() => save('readerOpen', readerOpen), [readerOpen]);
  const [readerFull, setReaderFull] = useState<boolean>(() => load('readerFull', false));
  useEffect(() => save('readerFull', readerFull), [readerFull]);
  const [readerWidth, setReaderWidth] = useState<number>(() => load('readerWidth', 640));
  useEffect(() => save('readerWidth', readerWidth), [readerWidth]);
  useEffect(() => {
    const w = window as unknown as { __readerShow?: () => void };
    w.__readerShow = () => setReaderOpen(true);
    return () => { delete w.__readerShow; };
  }, []);
  // 사무실 모드: 참모 화면 = [사무실][참모 세로 쌓기] (시안 docs/design-drafts/pixel-office)
  const [office, setOffice] = useState<boolean>(() => load('officeMode', false));
  useEffect(() => save('officeMode', office), [office]);
  // 사무실 칸이 보여 주는 화면(메뉴) — 참모 열·작업 패널은 그대로
  const [officeTab, setOfficeTab] = useState<OfficeTab>('office');
  const [furnPick, setFurnPick] = useState<string | null>(null);
  // 사무실 앞줄 자리표 — 한 번 앉은 세션은 그 자리 그대로(domain/office seatSlots)
  const [seats, setSeats] = useState<(string | null)[]>(() => load('officeSeats', []));
  useEffect(() => save('officeSeats', seats), [seats]);
  const seenSends = useRef(new Map<string, number>()); // 배달 연출: send 를 처음 본 시각(domain/office stampSeen)
  // 스페이스 모드: 참모 화면 = [리더][참모 채팅 — 쌓기/탭] (2026-09-30 사용자, Chammo 0.2.0 방향)
  const [space, setSpace] = useState<boolean>(() => load('spaceMode', true)); // 기본 켬(2026-09-30 사용자)
  // 익명 사용 통계 — 사무실을 연 횟수만(usage_counts)
  const officeShown = space ? spaceOffice : office;
  useEffect(() => {
    if (officeShown) bumpUsage('office');
  }, [officeShown]);
  const labelMap = useOrchLabels(); // 참모 별명이 바뀌면 탭·메뉴 이름을 다시 그린다
  useEffect(() => save('spaceMode', space), [space]);
  const [chatView, setChatView] = useState<ChatView>(() => chatViewOf(load<unknown>('spaceChatView', null)));
  // 채팅 칸 머리 자리 — 격자(SessionGrid)가 보이는 창 이름·단추를 여기 올린다
  const [chatHeadSlot, setChatHeadSlot] = useState<HTMLElement | null>(null);
  useEffect(() => save('spaceChatView', chatView), [chatView]);
  const [chatWidth, setChatWidth] = useState<number>(() => load('officeChatWidth', 420));
  useEffect(() => save('officeChatWidth', chatWidth), [chatWidth]);
  const [inboxOpen, setInboxOpen] = useState(false);
  // Claude Code 버전이 확인된 범위(2.1.28x) 밖이면 경고 한 줄 — 막지는 않는다. 닫으면 그 버전은 다시 안 띄운다
  const [verDismissed, setVerDismissed] = useState<string | null>(() => load('claudeVersionDismissed', null));
  const [updDismissed, setUpdDismissed] = useState<string | null>(() => load('updateDismissed', null));
  // 앱 자동 업데이트 단계(ADR 0005) — 받는 중·설치 중엔 띠를 못 닫는다
  const [appInstall, setAppInstall] = useState<InstallPhase>({ kind: 'idle' });
  useEffect(() => save('updateDismissed', updDismissed), [updDismissed]);
  useEffect(() => save('claudeVersionDismissed', verDismissed), [verDismissed]);
  // 프로젝트 폴더 읽기·같은 앱 여러 벌(이슈 #1) — 폴더 띠는 닫아도 다음에 켜면 다시(고쳐질 때까지), 여러 벌은 같은 상태면 안 띄운다
  const { access, copies } = useAccessWatch(config?.setupDone === true);
  const [accessDismissed, setAccessDismissed] = useState<string | null>(null);
  const [copiesDismissed, setCopiesDismissed] = useState<string | null>(() => load('copiesDismissed', null));
  useEffect(() => save('copiesDismissed', copiesDismissed), [copiesDismissed]);
  // 음성 모드: 참모가 답을 마치면 참모세이로 읽는다(누워 있을 때). 켜 둔 건 다음에 켜도 남는다
  const [voice, setVoice] = useState<boolean>(() => load('voiceMode', false));
  useSpeakGlowPoll(voice); // 음성 모드면 지금 말하는 참모를 빛낸다
  useEffect(() => { save('voiceMode', voice); void writeVoiceMode(voice).catch(() => {}); }, [voice]);
  const voiceRef = useRef(voice);
  voiceRef.current = voice && features.voice;
  // 상단 바 스피커 버튼·참모 scripts/app 이 같이 쓴다 — 켤 때 한마디
  const turnVoice = (on: boolean) => setVoice((v) => { if (!on) voiceHeld.current = {}; if (on && !v) void speak(tr(`음성 모드 켰어. ${assistant()}가 답하면 읽어줄게`, `Voice mode on. I will read ${assistant()}'s replies aloud`)).catch(() => {}); return on; });
  const [memoOpen, setMemoOpen] = useState<string | null>(null); // 메모판을 띄운 창(세션 id)
  const prevInbox = useRef<Set<string> | null>(null);
  const [taskEvents, setTaskEvents] = useState<TaskEvent[]>([]);
  // 작업 기록은 늘어난 줄만 읽는다(3초마다 통째 686KB 읽던 것) — 앱이 켜져 있는 동안 하나
  const [taskLog] = useState(() => makeTaskLog(readTasksSince));
  const sendTail = useMemo(() => deliveryTail(taskEvents), [taskEvents]); // 사무실 배달은 프레임마다 — 기록 전체 말고 이것만
  const [activity, setActivity] = useState<Record<string, Activity>>({});
  const [docs, setDocs] = useState<ProjectDoc[]>([]);
  const [stopped, setStopped] = useState<StoppedSession[]>([]);
  // 꺼진 세션 목록을 한 번이라도 읽었나 — 첫 참모 자동 시작이 빈 목록을 보고 '이어 켤 게 없다'로 판단하지 않게(snapReady 는 그보다 먼저 켜진다)
  const [stoppedReady, setStoppedReady] = useState(false);
  // 살아 있는 세션 기록(live.json) — undefined = 아직 파일을 안 읽음. 관리 프로그램 재시작으로 꺼진 세션을 찾는다(domain/revive)
  const snapRef = useRef<LiveSnap | null | undefined>(undefined);
  // 세션마다 사이드바 판정 — live.json state 로 같이 쓴다(기본 모드 '참모 상태'가 읽는다, domain/revive liveState). 그릴 때마다 최신으로
  const statesRef = useRef<Record<string, ActivityStatus>>({});
  const [lost, setLost] = useState<SnapSession[]>([]);
  // 꺼진 세션 계산을 한 번이라도 마쳤나 — 자동 되살리기가 뜨자마자 빈 목록으로 판단하지 않게
  const [snapReady, setSnapReady] = useState(false);
  const [usage, setUsage] = useState<Usage>({});
  const [accounts, setAccounts] = useState<AccountsView | null>(null);
  const [today, setToday] = useState<RepoToday[]>([]);
  const [ctx, setCtx] = useState<Record<string, Ctx>>({});
  const [allowLog, setAllowLog] = useState<AllowLog[]>([]);
  const loadAllowLog = useCallback(() => void readAutoAllow().then((t) => setAllowLog(parseAllowLog(t, 5))).catch(() => {}), []);
  useEffect(loadAllowLog, [loadAllowLog]);
  // 결정 대기함에서 '처리함'으로 치운 세션 질문 (작업 기록 쪽은 answer 이벤트로 남긴다)
  const [dismissed, setDismissed] = useState<string[]>(() => load('inboxDismissed', []));
  useEffect(() => save('inboxDismissed', dismissed.slice(-200)), [dismissed]);
  const prevCtx = useRef<Record<string, number> | null>(null);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const focused = useRef<string | null>(null); // ⌘W 가 끌 세션 = 마지막으로 클릭·입력한 창
  // 화면(격자)마다 마지막으로 누른 창 — ⌘1·⌘2 로 오가도 그 창이 바로 입력을 받게. activeGrid = 지금 보이는 격자(⌘⇧₩ 대상)
  const focusedBy = useRef(new Map<string, string>());
  const activeGrid = useRef<string | null>(null);
  // "그 세션으로 가기"(알림·작업 패널·결정 대기함) — n 이 바뀔 때마다 그 격자가 그 창에 포커스를 준다
  const [focusReq, setFocusReq] = useState<{ key: string; id: string; n: number } | null>(null);
  const gridFocus = (key: string) => {
    activeGrid.current = key;
    return { gridId: key, initialFocus: focusedBy.current.get(key), focusRequest: focusReq?.key === key ? focusReq : undefined,
      // 받은 격자가 처리하면 비운다 — 남겨 두면 화면을 떠났다 돌아올 때(격자가 다시 그려질 때) 옛 요청이 채팅 탭을 또 옮겼다(2026-10-06)
      onFocusRequestDone: (n: number) => setFocusReq((r) => (r?.n === n ? null : r)),
      onFocusSession: (id: string) => {
      focused.current = id; focusedBy.current.set(key, id);
      // 채팅 탭(참모)이 바뀌면 바로 다시 그린다 — 참조만 바꾸면 스페이스가 몇 초 뒤 갱신 때 따라와서 빨리 옮기면 안 바뀌었다(2026-09-30 사용자)
      if (key === 'orch-col') setChatTab((t) => (t === id ? t : id));
    } };
  };
  const [chatTab, setChatTab] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  // 앱 카드(@link — 기기·보안 번호·되찾기)가 새로 뜬 순간 화면 위 한 줄 — 참모 채팅엔 안 붙으니(10-29) 누르면 결정 대기함
  const [appNote, setAppNote] = useState<string | null>(null);
  const prevApp = useRef<Set<string> | null>(null);
  const [starting, setStarting] = useState<string[]>([]); // ⌘T로 띄우는 중인 세션 이름 — claude --bg 가 1초 남짓 걸린다
  // 끄는 중인 세션: claude stop 이 0.7초쯤 걸린다(실측) — 누르는 순간 화면에서 먼저 치우고 뒤에서 끈다
  const [closing, setClosing] = useState<Map<string, string>>(new Map());
  const closeSession = (s: Session, why: string) => {
    const label = s.workspace ? `${s.project} / ${s.workspace}` : s.project;
    setClosing((m) => new Map(m).set(s.id, label));
    if (focused.current === s.id) focused.current = null;
    void stopSession(s.id, `${why} ${s.name || label}`)
      .then(() => refresh())
      .catch((e: unknown) => setError(tr(`${label} 끄기 실패: ${String(e)}`, `Could not stop ${label}: ${String(e)}`)))
      .finally(() => setClosing((m) => { const n = new Map(m); n.delete(s.id); return n; }));
  };
  // 켜는 중인 꺼진 참모(sessionId) — 사이드바가 줄을 빼지 않고 '켜는 중'으로 둔다(지우기용 pending 과 따로)
  const [resuming, setResuming] = useState<Set<string>>(new Set());
  const markResuming = (sid: string) => {
    setResuming((p) => new Set(p).add(sid));
    setTimeout(() => setResuming((p) => { const n = new Set(p); n.delete(sid); return n; }), 20_000);
  };
  const markPending = (sid: string) => {
    setPending((p) => new Set(p).add(sid));
    // 목록이 갱신돼 살아 있는 세션으로 잡히면 resumable 이 알아서 빼니, 잠깐만 들고 있는다
    setTimeout(() => setPending((p) => { const n = new Set(p); n.delete(sid); return n; }), 15_000);
  };
  const prevStatus = useRef<Record<string, ActivityStatus>>({});
  const seenReplies = useRef<ReplySeen | null>(load<ReplySeen | null>('seenReplies', null)); // 참모 답 중 이미 읽은(또는 처음 보고 넘긴) 것 — 앱을 다시 켜도 남긴다
  const spokenSay = useRef<Record<string, string>>({});
  // 소리로 안 읽고 쌓아 둔 다른 참모 답 — 음성은 말 건 참모만 읽는다(domain/voice routeReply, 2026-10-25 사용자 "둘이 같이 말한다")
  const voiceHeld = useRef<VoiceHeld>({});
  const appStartedAt = useRef(new Date().toISOString()); // 세션 id → 이미 읽은 scripts/say 말의 마지막 ts(domain/voice pickSay)
  useEffect(() => save('fontSize', fontSize), [fontSize]);
  useEffect(() => save('sidebarOpen', sidebarOpen), [sidebarOpen]);
  useEffect(() => save('tasksOpen', tasksOpen), [tasksOpen]);

  // 단축키 = 메뉴바 항목과 같은 동작. 창 전체에서 capture 로 먼저 받는다 — 터미널(xterm)보다 앞에서 가로채야 Claude 입력칸에 안 들어간다.
  // 메뉴(Rust main.rs)에도 같은 단축키가 걸려 있어서 둘 다 올 수 있다 → 잠깐 사이(dedupeMs)의 같은 동작은 한 번만
  const runRef = useRef<(sc: Shortcut) => void>(() => {});
  /** 마지막으로 누른 화면 영역 — 포커스가 안 잡히는 곳(말풍선·탭 그림)을 눌렀을 때 ⌘+ ⌘- 가 어디로 갈지 */
  const lastZoomArea = useRef<ZoomArea>('none');
  runRef.current = (sc: Shortcut) => {
    // ⌘1~9: 스페이스면 채팅 탭 N번(참모 화면으로 가서), 아니면 예전 화면 이동(⌘1~4) — 2026-09-30 사용자
    if (sc.type === 'num' && farActive()) { window.dispatchEvent(new CustomEvent(FAR_NUM, { detail: sc.n })); return; } // 다른 기기를 보는 중 — 그 기기 N번째 참모
    // 그 기기를 보는 중엔 숨은 이 맥 화면에 먹는 단축키는 안 받는다 — ⌘⇧W 가 이 맥 세션을 끄는 창을 '그 기기 보는 중' 화면에 띄웠다(리뷰)
    if (farActive() && FAR_BLOCKED.has(sc.type)) return;
    if (sc.type === 'num') {
      if (sc.n === 9 && tabZoomFn()?.('fit')) return; // 확대할 탭이 떠 있으면 ⌘9 = 맞춤(없으면 채팅 탭 9번) — 크롬 ⌘9 와 겹치지 않게 탭이 있을 때만
      if (!space) { const g = gotoOfNum(sc.n); if (g) runRef.current(g); return; }
      const o = groups.orchestrators[sc.n - 1];
      if (!o) return;
      teamMode.leave(); // 팀 모드면 팀 대화가 채팅 칸을 덮고 있다 — 밑 채팅만 바뀌어 안 먹는 것처럼 보였다(10-26 사용자)
      setSelected({ kind: 'orchestrator' });
      setFocusReq((r) => ({ key: 'orch-col', id: o.id, n: (r?.n ?? 0) + 1 }));
      // 스페이스에도 직접 — 쌓기 보기는 탭 줄이 안 알려서, 홈을 보다 지금 탭 참모를 고르면 홈에 남았다(2026-10-25 사용자 ⌘1). 두 번 와도 같은 결과
      window.dispatchEvent(new CustomEvent('chat-tab-pick', { detail: o.id }));
      return;
    }
    // ⌃⇧PageUp/PageDown·⌥⌘⇧←/→ — 보고 있는 참모 격자(채팅 탭·터미널 격자)에서 고른 참모를 한 칸. 고정 경계는 못 넘는다(domain/orchOrder)
    if (sc.type === 'moveTab') {
      const key = activeGrid.current;
      if (key !== 'orch-col' && key !== 'orch') return;
      const me = groups.orchestrators.find((o) => o.id === (focusedBy.current.get(key) ?? focused.current));
      const shown = groups.orchestrators.map((o) => o.sessionId).filter((x): x is string => !!x);
      const to = me?.sessionId ? stepTarget(shown, new Set(orchPins), me.sessionId, sc.dir) : null;
      if (me?.sessionId && to) moveOrch(shown, me.sessionId, to);
      return;
    }
    if (!allowed(sc, featuresRef.current)) return; // 꺼 둔 기능(사무실·다마고치·리뷰)의 입구
    // ⌘1 = 참모 터미널 격자(사무실 끔) · ⌘4 = 사무실 뷰(사무실 켬) · ⌘3 = 리뷰 (2026-09-27 사용자)
    if (sc.type === 'goto') {
      if (sc.to === 'tama') { openPetRef.current(); return; } // 도감·보관함 = 돌보는 참모 대시보드의 펫 탭
      // 채팅 뷰면 스페이스 칸에 사무실(지금 탭) — 터미널 뷰로 넘어가지 않는다(2026-10-03 사용자 A)
      if (sc.to === 'office' && spaceShownRef.current) { setOfficeTab('office'); setOfficeReq('open'); }
      else if (sc.to === 'office') { setOffice(true); setOfficeTab('office'); setSelected({ kind: 'orchestrator' }); }
      else if (sc.to === 'review') reviewRef.current('open');
      else { if (sc.to === 'orchestrator') setOffice(false); setSelected({ kind: sc.to }); }
    }
    // 미리보기 모달이 떠 있으면 ⌘+ ⌘- ⌘0 은 모달만(2026-09-30 사용자 "리더처럼")
    else if ((sc.type === 'font' || sc.type === 'fontReset') && previewZoomFn()) previewZoomFn()!(sc.type === 'fontReset' ? 0 : sc.delta);
    // 리더를 보고 있으면 ⌘+ ⌘- ⌘0 은 리더만 — 터미널 글자는 그대로(사용자 2026-09-29)
    else if ((sc.type === 'font' || sc.type === 'fontReset') && readerOpen && readerFocused()) readerZoom(sc.type === 'fontReset' ? 0 : sc.delta);
    // 스페이스에 확대할 탭(md·txt·엑셀·pdf·그림·html)이 떠 있으면 ⌘+ ⌘- ⌘0 은 그 탭만 — 파일마다 기억(2026-10-12 사용자)
    // 포커스(없으면 마지막으로 누른 곳)가 채팅·터미널이면 탭이 열려 있어도 글자 크기 — 문서 탭을 띄운 채 채팅에서 눌러도 탭만 커졌다(2026-10-22)
    else if ((sc.type === 'font' || sc.type === 'fontReset') && zoomTarget(zoomAreaOf(document.activeElement), lastZoomArea.current) === 'tab' && tabZoomFn()?.(sc.type === 'fontReset' ? 0 : sc.delta)) { /* 탭이 받았다 */ }
    else if (sc.type === 'font') setFontSize((f) => clampFont(f + sc.delta));
    else if (sc.type === 'fontReset') setFontSize(DEFAULT_FONT);
    else if (sc.type === 'selectAll') selectAllHere(readerOpen && readerFocused(), document.querySelector('.reader-panel'));
    else if (sc.type === 'toggleSidebar') setSidebarOpen((o) => !o);
    else if (sc.type === 'toggleTasks') setTasksOpen((o) => !o);
    else if (sc.type === 'search' && (window as unknown as { __docFind?: () => void }).__docFind) (window as unknown as { __docFind: () => void }).__docFind(); // 문서가 열려 있으면 문서 찾기
    else if (sc.type === 'search') {
      setSidebarOpen(true);
      setTimeout(() => searchRef.current?.focus(), 0);
    } else if (sc.type === 'closeTab') {
      // ⌘W = 닫는 건 탭뿐 — 리더를 보고 있으면 리더 탭, 채팅 뷰면 스페이스 탭(고정 탭·탭 없음은 아무 일 없음). 터미널 뷰의 그 밖엔 아무것도 안 한다.
      // 세션 끄기는 ⌘⇧W (2026-10-12 사용자)
      if (readerFocused()) void readerCloseActive();
      else if (spaceShownRef.current) spaceCmd('closeTab');
    }
    else if (sc.type === 'toggleReader') setReaderOpen((o) => !o);
    else if (sc.type === 'readerFull') { setReaderOpen(true); setReaderFull((f) => !f); }
    // Ctrl+Tab 은 터미널에서 쓸 일이 없다 — 리더 패널이 열려 있으면 포커스와 상관없이 탭을 넘긴다(⌘W 는 세션을 끌 수 있어서 리더를 볼 때만)
    else if (sc.type === 'readerTab') { if (readerOpen) { markReader(true); void invoke('reader_cycle', { surface: 'dock', dir: sc.dir }); } }
    else if (sc.type === 'readerClose') void readerCloseActive();
    else if (sc.type === 'settings') setSettingsOpen(true);
    else if (sc.type === 'nav') window.dispatchEvent(new CustomEvent(SPACE_NAV, { detail: sc.dir })); // 스페이스 뒤로·앞으로(SpaceView 가 받는다)
    else if (sc.type === 'tour') setTourOpen(true);
    else if (sc.type === 'harnitor') harnitorRef.current('toggle');
    else if (sc.type === 'licenses') setLicensesOpen(true);
    else if (sc.type === 'farPick') window.dispatchEvent(new Event(FAR_PICK));
    else if (sc.type === 'quitAsk') { setQuitOpen(true); void invoke('app_quit_shown').catch(() => {}); } // 들었다고 Rust 에 — 못 들으면(웹 굳음) Rust 가 4초 뒤 앱만 끈다(quit.rs). 이미 떠 있어도 매번
    // 미리보기 모달이 떠 있으면 ⌘⇧` 는 모달을 스페이스 가득으로(2026-09-30 사용자, 10-25 ⌘` 는 홈으로)
    else if (sc.type === 'maximizePane' && previewMaxFn()) previewMaxFn()!();
    else if (sc.type === 'maximizePane' && readerOpen && readerFocused()) setReaderFull((f) => !f); // 리더를 보고 있으면 리더를 크게·작게(사용자: 보고 있는 곳 기준)
    else if (sc.type === 'maximizePane') {
      // ⌘⇧₩ — 지금 보이는 격자에서 마지막으로 누른 창을 크게, 이미 크면 되돌리기(포커스는 SessionGrid 가 그 창에 돌려준다)
      const key = activeGrid.current;
      if (!key) return;
      if (layoutOf(key).maximized) { dispatchFor(key)({ type: 'restore' }); return; }
      // 누른 기록이 없으면(재시작·화면 전환 직후) 입력 커서가 있는 창, 그것도 없으면 첫 창
      const box = document.querySelector<HTMLElement>(`.gridbox[data-grid="${CSS.escape(key)}"]`);
      const shown = [...(box?.querySelectorAll<HTMLElement>('.cell[data-session]') ?? [])].map((c) => c.dataset.session!);
      const active = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-session]')?.dataset.session ?? null;
      const id = maxTarget(focusedBy.current.get(key), active, shown);
      if (id) { focusedBy.current.set(key, id); dispatchFor(key)({ type: 'maximize', id }); }
    }
    else if (sc.type === 'closePane') closePaneRef.current(); // ⌘⇧W — 세션 끄기(확인 창을 거친다)
    else if (sc.type === 'newSession') newSessionRef.current();
    else if (sc.type === 'newDoc') {
      // ⌘T = 보관함에 빈 문서(보관함 '+ → 새 문서'와 같은 길). 스페이스가 없는 터미널 뷰에선 놓을 자리가 없다
      if (spaceShownRef.current) spaceCmd('newDoc');
      else setError(tr(`새 문서는 채팅 뷰에서 — 새 세션은 ${keyLabel('⌘⇧T', IS_WIN)}`, `New document works in the chat view — new session is ${keyLabel('⌘⇧T', IS_WIN)}`));
    }
    else if (sc.type === 'goHome') spaceCmd('home'); // ⌘⇧H — 고른 참모의 홈 고정 탭
    // ⌘`(⌘₩) — 홈 대시보드 켜기·보던 화면으로(2026-10-25 사용자). 터미널 뷰엔 대시보드가 없어 open home 과 같이 참모 화면
    else if (sc.type === 'homeToggle') { if (spaceShownRef.current) spaceCmd(sc.open ? 'dash' : 'dashToggle'); else runRef.current({ type: 'goto', to: 'orchestrator' }); }
    else if (sc.type === 'goLocker') spaceCmd('locker'); // ⌘⇧L — 보관함 고정 탭
    else if (sc.type === 'widget') widgetToggleRef.current();
    else if (sc.type === 'memo') {
      const id = focused.current;
      if (id) setMemoOpen((o) => (o === id ? null : id));
      else setError(tr('메모는 창을 먼저 한 번 클릭하고 ⌘M', 'Click a pane once first, then ⌘M for notes'));
    }
  };
  useEffect(() => {
    const fast = onceWithin(150);
    const slow = onceWithin(400);
    const across = onceAcross(400);
    const run = (sc: Shortcut, src: 'key' | 'menu') => {
      if (sc.type === 'selectAll') { if (across(src, Date.now())) runRef.current(sc); return; } // 문서 ⌘A 는 빠르게 두 번 = 칸 → 문서
      const ms = dedupeMs(sc);
      if (ms === 0 || (ms === 150 ? fast : slow)(JSON.stringify(sc), Date.now())) runRef.current(sc);
    };
    const onKey = (e: KeyboardEvent) => {
      if (browserOwnsKey(e)) return; // 세션 브라우저 크게 보기에 포커스 — 브라우저 단축키로(모달이 받는다)
      const sc = shortcutFor(e);
      if (!sc) return;
      e.preventDefault();
      e.stopPropagation();
      run(sc, 'key');
    };
    // 메뉴바 항목을 누르면 Rust 가 window.__menu('<id>') 를 부른다
    const w = window as unknown as { __menu?: (id: string) => void; __dockQuit?: () => void };
    w.__menu = (id) => { if (browserMenu(id)) return; const sc = menuAction(id); if (sc) run(sc, 'menu'); };
    // 독 '종료' — Craft 저장이 남아 Rust 가 끄기를 미뤘다(dock_quit.rs). 묻지 않고 저장 중 창으로, 띄웠다고 알린다(못 들으면 Rust 가 4초 뒤 끈다)
    w.__dockQuit = () => { setQuitOpen('dock'); void invoke('app_quit_shown').catch(() => {}); };
    window.addEventListener('keydown', onKey, true);
    const onPointer = (e: PointerEvent) => { lastZoomArea.current = zoomAreaOf(e.target instanceof Element ? e.target : null); };
    window.addEventListener('pointerdown', onPointer, true);
    // html 탭·미리보기(iframe) 안에 포커스가 있으면 키가 앱에 안 온다(윈도우는 메뉴 가속키도 안 돎) — hodoc 다리가 확대 셋만 넘긴다.
    // 보낸 창이 지금 화면의 그 iframe 일 때만, 그 탭·미리보기 확대만(남의 html 이 흉내 내도 자기 확대만 바뀐다 — 다른 단축키·글자 크기로 안 감)
    const onFrame = (e: MessageEvent) => {
      const c = frameZoomCmd(e.data);
      if (c === null) return;
      const from = [...document.querySelectorAll('iframe')].find((f) => f.contentWindow === e.source);
      if (!from) return;
      // 맥은 같은 누름이 메뉴 ⌘+ 로도 온다 — 메뉴·키와 같은 줄(150ms)로 한 번만
      const same: Shortcut = c === 0 ? { type: 'fontReset' } : { type: 'font', delta: c };
      if (!fast(JSON.stringify(same), Date.now())) return;
      if (from.closest('.dash-preview')) previewZoomFn()?.(c);
      else if (from.closest('.space .cv-main')) tabZoomFn()?.(c);
    };
    window.addEventListener('message', onFrame);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onPointer, true); window.removeEventListener('message', onFrame); delete w.__menu; delete w.__dockQuit; };
  }, []);
  const widgetToggleRef = useRef<() => void>(() => {});
  // 화면(프로젝트 이름 / 'all')마다 따로 기억한다 — 프로젝트를 오가도 크게·접기가 유지되게
  const [layouts, setLayouts] = useState<Record<string, PaneLayout>>({});
  const layoutOf = (key: string) => layouts[key] ?? EMPTY_LAYOUT;
  const dispatchFor = (key: string) => (a: LayoutAction) =>
    setLayouts((m) => ({ ...m, [key]: layoutReducer(m[key] ?? EMPTY_LAYOUT, a) }));

  // 따로 추가한 프로젝트 폴더가 바뀌면(설정 화면·참모 scripts/app project) 환경을 다시 읽는다 — 세션 판별·스캔이 새 폴더를 보게
  const extrasKey = JSON.stringify(config?.extraProjects ?? []);
  useEffect(() => { void setOrchLegacy(legacyAssistants()).catch(() => {}); }, []); // Rust 참모 이름 판정(텔레그램·모드)도 옛 이름을 알게
  useEffect(() => {
    getAppEnv().then(setEnv).catch((e: unknown) => setError(tr(`앱 환경 읽기 실패: ${String(e)}`, `Could not read the app environment: ${String(e)}`)));
  }, [extrasKey]);

  const origins = useRef(new Map<number, { unattended: boolean; via: string }>());
  // 꺼진 세션 목록(agents --all)은 15초에 한 번 — 사람이 부른 새로 고침·살아 있던 세션이 사라진 때만 바로(domain/pollGate)
  const allAt = useRef(0);
  const prevLive = useRef<string[]>([]);
  const refreshOnce = useCallback(async (force: boolean) => {
    if (!env) return;
    try {
      // 내 프로젝트 폴더·HQ 안의 세션만 — 이 맥의 다른 데서 띄운 Claude 세션이 섞이지 않게
      const parsed = parseAgents(await listSessionsRaw(), env.devRoot, env.extraProjects);
      // 대화형 세션이 어디서 떴나(사람 터미널 / 예약 작업) — pid 마다 한 번만 묻는다(안 바뀐다)
      const ask = parsed.filter((x) => x.kind === 'interactive' && x.pid != null && !origins.current.has(x.pid)).map((x) => x.pid!);
      if (ask.length) for (const [pid, o] of Object.entries(await sessionOrigins(ask).catch(() => ({})))) origins.current.set(Number(pid), o);
      const everyone = parsed.map((x) => (x.kind === 'interactive' && x.pid != null && origins.current.has(x.pid) ? { ...x, origin: origins.current.get(x.pid) } : x));
      setAllSessions(everyone);
      const live = withinRoots(everyone, appRoots(env.devRoot, env.orchestratorCwd, env.extraProjects));
      setSessions(live);
      listAt.current = Date.now();
      // 재시작 감지가 실패해도 세션 목록은 살린다 — 따로 잡는다
      try {
        if (snapRef.current === undefined) snapRef.current = parseSnap(await readLiveSnap());
        // 시작 시각을 먼저 받고 기록을 읽는다 — 기다리는 사이 꺼진 세션 처리(useLostTriage)가 지운 걸 옛 기록으로 되살리지 않게
        const daemon = await daemonStartedAt();
        const snap = stepSnapshot(snapRef.current, daemon, live, Date.now(), statesRef.current, orchLabelsNow());
        if (snap && JSON.stringify(snap) !== JSON.stringify(snapRef.current)) void writeLiveSnap(JSON.stringify(snap)).catch(() => {});
        snapRef.current = snap;
        setLost(snap?.lost ?? []);
        setSnapReady(true);
      } catch {
        // 다음 폴링에서 다시
      }
      setTaskEvents(await taskLog());
      const liveIds = live.map((x) => x.sessionId ?? x.id);
      if (allDue({ lastAt: allAt.current, now: Date.now(), force, prevLive: prevLive.current, live: liveIds })) {
        setStopped(withinRoots(parseStopped(await listSessionsAllRaw(), env.devRoot, env.extraProjects), appRoots(env.devRoot, env.orchestratorCwd, env.extraProjects)));
        allAt.current = Date.now();
        setStoppedReady(true);
      }
      prevLive.current = liveIds;
      setCtx(parseCtx(await readCtx()));
      listFails.current = 0;
      if (listFailed.current) { listFailed.current = false; setError(null); }
    } catch (e: unknown) {
      // 옛 claude(--json 없음)나 로그인 풀림이 여기로 온다 — 숨기지 않고 배너로. 시간 초과는 한 번으론 안 띄우고 이어지면 사람 말로(domain/busyGate) —
      // 부팅 직후 'command timed out' 띠만 떠서 무슨 일인지 몰랐다(2026-10-26). 실패해도 세션 목록은 그대로 둔다(꺼진 걸로 안 친다)
      listFails.current += 1;
      const text = listErrorText(String(e), listFails.current, busyNow());
      if (text) { listFailed.current = true; setError(text); }
    }
  }, [env]);
  // 앞 차례가 안 끝났으면 겹쳐 부르지 않는다 — 맥이 바쁘면 agents 한 번이 3초를 넘겨 쌓였다. 폴링은 버리고, 사람이 부른 것(refresh)은 끝난 뒤 한 번 더
  const gate = useMemo(() => singleFlight(refreshOnce), [refreshOnce]);
  const refresh = useCallback(() => gate(true), [gate]);

  useEffect(() => {
    if (!env || firstRun) return; // 첫 실행 안내 중엔 claude 가 아직 없을 수 있다 — 끝나면 창을 다시 연다
    void gate(true);
    // 맥이 바쁘면 10초에 한 번 — claude agents 한 번이 프로세스 하나라 3초마다 띄우면 부하를 더 올린다(사람이 부른 새로 고침은 그대로)
    let polledAt = 0;
    const t = setInterval(() => {
      if (busyNow() !== 'ok' && Date.now() - polledAt < BUSY_POLL) return;
      polledAt = Date.now();
      void gate(false);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [env, gate, firstRun]);

  // 리뷰: 열린 PR·오늘 머지된 PR(gh, 2분마다). 리뷰 화면을 열면 30초 넘게 묵은 경우 바로 다시 읽는다
  const review = useReview(features.review ? env : null, () => void refresh());
  const reviewConfirm = splitOpen(review.open, review.later, Date.now()).confirm.length;
  useEffect(() => {
    if ((selected.kind === 'review' || reviewOpen) && (!review.scannedAt || Date.now() - review.scannedAt > 30_000)) review.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.kind, reviewOpen]);

  // 세션 현황: 대화 기록 꼬리는 무거우니 세션 목록(3초)보다 느리게 10초마다.
  // 패널을 닫아도 읽는다 — 결정 대기·알림이 이걸로 판단하는데, 닫으면 안 읽어서 결정을 놓쳤다(2026-09-27 사용자). 명령은 뒤에서 돌아 화면은 안 막는다
  // 예약 폴더에서 뜬 세션 — 앱 목록 밖이지만 진짜 로그인 풀림이면 로그인 카드에 넣으려고 기록은 같이 읽는다(roadmap 137행 ①)
  const routineSess = useMemo(() => routineSessions(allSessions, env?.dataDir ?? ''), [allSessions, env?.dataDir]);
  useEffect(() => {
    const tick = async () => {
      const ids = [...sessions, ...routineSess].map((s) => s.sessionId).filter((x): x is string => !!x);
      if (!ids.length) return;
      try {
        const tails = await readTranscriptTails(ids);
        setActivity(Object.fromEntries(Object.entries(tails).map(([k, v]) => [k, summarizeTranscript(v)])));
      } catch {
        // 현황은 보조 정보 — 못 읽어도 나머지 화면은 그대로 쓴다
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 10000);
    return () => clearInterval(t);
    // 세션 id 구성이 바뀔 때만 다시 건다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [[...sessions, ...routineSess].map((s) => s.sessionId).join(',')]);

  // 프로젝트 문서 상태: git 을 30번 넘게 부르니 5분마다
  useEffect(() => {
    if (!env) return;
    const scan = () => projectScan(env.devRoot).then(setDocs).catch(() => {});
    void scan();
    return every(scan, 5 * 60_000);
  }, [env]);

  // 상단 바: 사용 한도는 상태줄이 갱신할 때마다 바뀌니 15초, 오늘 커밋은 git 을 저장소마다 부르니 5분(TODAY_COMMITS_MS)
  useEffect(() => {
    if (!env) return;
    // 지금 계정은 ~/.claude.json 만 읽어서 싸다 — 사용량과 같이, 설정에서 바꾸면 바로
    const a = () => accountsApi.view().then(setAccounts).catch(() => setAccounts(null));
    const u = () => { void a(); return readUsage().then((j) => setUsage(parseUsage(j, Date.now()))).catch(() => {}); };
    const c = () => todayCommits(env.devRoot, env.gitEmail, dayStart(new Date())).then(setToday).catch(() => {});
    void u();
    void c();
    const stopU = every(u, 15_000);
    const stopC = every(c, TODAY_COMMITS_MS);
    window.addEventListener(ACCOUNTS_CHANGED, a);
    return () => {
      stopU();
      stopC();
      window.removeEventListener(ACCOUNTS_CHANGED, a);
    };
  }, [env]);

  const visibleSessions = useMemo(() => sessions.filter((s) => !closing.has(s.id)), [sessions, closing]);
  // 참모 고정 — 폰과 같은 <데이터>/orch-pins.json, 5초마다 다시 읽는다(폰에서 고정해도 따라오게). 고정한 참모가 사이드바·채팅 탭·홈 맨 위
  const [orchPins, setOrchPins] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => void readOrchPins().then((v) => { if (alive) setOrchPins((o) => (o.join() === v.join() ? o : v)); }, () => {});
    load();
    const stop = every(load, 5000);
    return () => { alive = false; stop(); };
  }, []);
  // 참모 순서 — 채팅 탭을 끌어 옮기거나 ⌃⇧PageUp 으로 옮긴 것(<데이터>/orch-order.json, 폰도 읽는다). 채팅 탭·⌘1~9·사이드바·홈이 같은 줄(domain/orchOrder)
  const [orchOrder, setOrchOrderState] = useState<string[]>([]);
  useEffect(() => { void readOrchOrder().then(setOrchOrderState, () => {}); }, []);
  /** shown = 지금 보이는 참모 대화 id 순서. 바로 바꿔 보이고 맥에 저장(실패하면 저장된 걸 다시 읽는다) */
  const moveOrch = (shown: string[], from: string, to: string) => {
    setOrchOrderState((cur) => {
      const next = moveInOrder(cur, shown, from, to);
      if (next !== cur) void setOrchOrder(next).catch((e: unknown) => { setError(tr(`순서 저장 실패: ${String(e)}`, `Could not save the order: ${String(e)}`)); void readOrchOrder().then(setOrchOrderState, () => {}); });
      return next;
    });
  };
  /** SessionGrid 의 창 id 로 끌어 옮긴 걸 대화 id 순서로 — 참모 격자(채팅 탭·터미널 격자) 공용 */
  const reorderOrchPanes = (ids: string[], from: string, to: string) => {
    const sid = new Map(sessions.map((x) => [x.id, x.sessionId]));
    const shown = ids.map((x) => sid.get(x)).filter((x): x is string => !!x);
    const f = sid.get(from);
    const t = sid.get(to);
    if (f && t) moveOrch(shown, f, t);
  };
  const pinOrch = (s: Session, on: boolean) => { if (s.sessionId) void setOrchPin(s.sessionId, on).then(setOrchPins, (e: unknown) => setError(tr(`고정 실패: ${String(e)}`, `Pin failed: ${String(e)}`))); };
  const groups = useMemo(() => {
    const g = groupByProject(visibleSessions, env?.orchestratorCwd ?? '');
    return { ...g, orchestrators: orchSort(g.orchestrators, orchOrder, orchPins, (s) => s.sessionId) };
  }, [visibleSessions, env, orchPins, orchOrder]);
  // 사이드바 오케스트레이터 칸은 끄는 중인 참모도 그대로 둔다(줄·순서 색 유지, 상태만 '끄는 중') — domain/orchRows
  const navOrchs = useMemo(() => orchSort(groupByProject(sessions, env?.orchestratorCwd ?? '').orchestrators, orchOrder, orchPins, (s) => s.sessionId), [sessions, env, orchPins, orchOrder]);
  // 화면 이름이 겹칠 때만 꼬리 — 같이 보이는 참모(살아 있는 + 꺼진)를 알린다(ui/orchLabels orchDisplay)
  useEffect(() => {
    const off = stoppedOrchs(resumable(stopped, sessions), env?.orchestratorCwd ?? '', navOrchs);
    setOrchRoster([...navOrchs.map((x) => ({ id: x.id, name: x.name })), ...off.map((x) => ({ id: x.id, name: x.name, off: true }))]);
  }, [navOrchs, stopped, sessions, env]);
  const startingOrchs = useMemo(
    () => stoppedOrchs(resumable(stopped, sessions).filter((x) => resuming.has(x.sessionId)), env?.orchestratorCwd ?? '', navOrchs),
    [stopped, sessions, resuming, env, navOrchs],
  );

  // 새 참모 이름 짓기 창 — '+'·탭 '+'·⌘T 는 별명을 먼저 묻는다(번호 대신 이름으로 부른다, 2026-10-02 사용자)
  const [naming, setNaming] = useState(false);
  // 만드는 중인 새 참모(진짜 이름) — 사이드바에 '켜는 중' 줄로 두고, 목록에 뜨면 그 참모로 옮긴다(domain/orchRows arrivedOrch)
  const [creating, setCreating] = useState<string | null>(null);
  const offOrchList = useMemo(() => stoppedOrchs(resumable(stopped, sessions), env?.orchestratorCwd ?? '', navOrchs), [stopped, sessions, env, navOrchs]);
  // 참모 맡은 일 — 폰·이름표 훅과 같은 <데이터>/orch-roles.json, 5초마다(폰에서 고쳐도 따라오게). 사람이 안 적었으면 최근 7일 기록으로 "주로 a·b"(domain/orchRoles)
  const [orchRoles, setOrchRoles] = useState<RoleMap>({});
  useEffect(() => {
    let alive = true;
    const load = () => void readOrchRoles().then((v) => { if (alive) setOrchRoles((o) => { const n = parseRoles(JSON.stringify(v)); return JSON.stringify(o) === JSON.stringify(n) ? o : n; }); }, () => {});
    load();
    const stop = every(load, 5000);
    const off = onOrchRolesSaved((m) => setOrchRoles(m));
    return () => { alive = false; stop(); off(); };
  }, []);
  const knownOrchs = useMemo(() => [...navOrchs, ...offOrchList].map((x) => ({ id: x.id, name: x.name })), [navOrchs, offOrchList]);
  const inferredRoles = useMemo(() => inferRoles(taskEvents, knownOrchs, sessions, Date.now(), { roles: orchRoles, hq: env?.orchestratorCwd }), [taskEvents, knownOrchs, sessions, orchRoles, env]);
  useEffect(() => { setOrchRoleData(orchRoles, inferredRoles); }, [orchRoles, inferredRoles]);
  /** 멈춘 세션 물음 — 앞 단계(마지막에 시킨·같은 프로젝트 참모)로 못 정하면 맡은 일로(domain/orchRoles roleHeir) */
  const heirOf = (s: Session) => roleHeir(s, taskEvents, groups.orchestrators, knownOrchs, sessions, orchRoles);
  // 재시작으로 꺼진 세션 — 사람에게 카드를 안 띄운다(2026-10-04 사용자 "사용자가 이거 못 알아볼 것 같다"). 끝난 건 조용히 빼고,
  // 안 끝난 건 주인 참모에게 한 줄, 참모가 하나도 없을 때만 홈에 짧게(lostHold). 판단은 domain/lostTriage
  const updateSnap = async (f: (s: LiveSnap) => LiveSnap) => {
    if (!snapRef.current) return;
    const next = f(snapRef.current);
    snapRef.current = next;
    setLost(next.lost);
    await writeLiveSnap(JSON.stringify(next)).catch(() => {});
  };
  const isLostOrch = (s: SnapSession) => isHqOrch(s, env?.orchestratorCwd ?? '');
  const { hold: lostHold, open: lostOpen } = useLostTriage({
    lost, ready: snapReady && stoppedReady, sessions, events: taskEvents, orchs: groups.orchestrators, front: groups.orchestrator,
    // 꺼진 세션은 살아 있는 목록에 없다 — 그 세션을 목록 맨 앞에 넣어 맡은 일(heir)이 알아보게
    heir: (p) => roleHeir(p, taskEvents, groups.orchestrators, knownOrchs, [p, ...sessions], orchRoles),
    isOrch: isLostOrch,
    autoRevive: features.autoRevive, devRoot: env?.devRoot, extras: env?.extraProjects ?? [], update: updateSnap,
  });
  /** nick 이 있으면 '참모-N · 별명'(N 은 꺼진 참모 번호까지 피해서, 새 참모 창에서 별명을 비우면 '참모-N'), 없으면 첫 참모 이름(설정 이름) — 자동 시작·빈 화면 버튼 */
  const spawnOrchestrator = async (nick?: string, role = '') => {
    if (!env || spawningRef.current) return; // + 를 연달아 눌러도 하나만(띄우는 데 1초 남짓)
    spawningRef.current = true;
    setSpawning(true);
    const again = () => void spawnOrchestrator(nick, role);
    try {
      // 새 컴퓨터는 bypass 경고에 아직 동의 안 했다 — 띄우면 'requires accepting the disclaimer' 로 실패하니 카드부터(2026-10-21 새 윈도우 PC)
      if (consentBeforeSpawn(await bypassConsent().catch(() => null)) === 'ask') { setConsentAsk(() => again); return; }
      const name = nick !== undefined ? withNick(nextOrchestratorName([...navOrchs, ...offOrchList].map((s) => s.name)), nick) : nextOrchestratorName(groups.orchestrators.map((s) => s.name));
      if (nick !== undefined) setCreating(name);
      // 맡은 일·태어난 때를 먼저 적는다 — 꺼진 참모를 지워 번호가 다시 쓰이면 옛 맡은 일·기록이 새 참모에 붙었다(2026-10-04 QA ⑥·리뷰)
      await saveOrchRole(name, role, true).catch(() => {});
      await spawnSession(env.orchestratorCwd, name, orchIntro());
      await refresh();
    } catch (e: unknown) {
      if (isDisclaimerError(String(e))) setConsentAsk(() => again); // 띠 대신 동의 카드 — 누르면 다시 띄운다
      else setError(tr(`${assistant()} 띄우기 실패: ${String(e)}`, `Could not start ${assistant()}: ${String(e)}`));
      setCreating(null);
    } finally {
      spawningRef.current = false;
      setSpawning(false);
    }
  };
  const spawningRef = useRef(false);
  /** bypass 동의 카드 — 누르면 할 일(참모 다시 띄우기) */
  const [consentAsk, setConsentAsk] = useState<(() => void) | null>(null);

  // 다마고치: 1분마다 작업 기록을 먹여 tama.json 에 쓴다(위젯 창은 읽기만)
  const openPetRef = useRef(() => {});
  const [petModal, setPetModal] = useState(false);
  const tama = useTama(env, sessions, taskEvents, routines, navOrchs, (k) => { if (k === 'dex' || k === 'pet') openPetRef.current(); }, review.scannedAt ? review.open : null);
  // 펫 = 참모가 키운다(시안 tama-v2 B) — 더보기·도감은 돌보는 참모(마지막으로 먹인 참모) 대시보드의 펫 탭
  const petWho = (id: string) => { const o = navOrchs.find((x) => x.id === id); return o ? { name: o.name, color: orchColor(o.name) } : null; };
  // 펫 탭 코인 = 사무실과 같은 상점 창(뽑기·도감·스킨) — 펫 탭에서 뽑아도 뽑은 걸 바로 본다
  // 방 스킨은 gacha.json 장착 칸 하나 — 도감·스킨 화면·사무실이 같은 걸 본다. 옛 판은 이 컴퓨터(localStorage officeSkin)에만 뒀다 — 처음 한 번 옮긴다
  const petNode = (who: typeof petWho) => <PetView file={tama.file} apply={tama.apply} feed={tama.feed} who={who} coins={features.gacha ? gacha.file?.coins ?? 0 : undefined}
    shop={features.gacha ? (view, onView, close) => <Shop view={view} onView={onView} file={gacha.file} draw={gacha.draw} equip={(id) => void gacha.equip(id)} setSkin={(n) => void gacha.setSkin(n)} see={(id) => void gacha.see(id)} onClose={close} /> : undefined} />;
  const gacha = useGacha(env, tama.feed);
  useEffect(() => {
    const old = load<string>('officeSkin', '');
    if (!gacha.file || !old) return;
    try { localStorage.removeItem('officeSkin'); } catch { /* 못 지워도 장착 칸이 있으면 다시 안 옮긴다 */ }
    if (old !== 'wood' && !gacha.file.equip.skin) void gacha.setSkin(old);
  }, [gacha.file]); // eslint-disable-line react-hooks/exhaustive-deps
  widgetToggleRef.current = () => (tama.widgetShown ? void tamaWidget(false) : tama.showWidget());
  // 꺼 둔 기능: 떠 있던 다마고치 위젯은 숨기고, 그 화면을 보고 있었으면 비서 화면으로
  useEffect(() => { if (!features.tama && tama.widgetShown) void tamaWidget(false).catch(() => {}); }, [features.tama, tama.widgetShown]);
  useEffect(() => {
    if ((selected.kind === 'review' && !features.review) || (selected.kind === 'tama' && !features.tama)) setSelected({ kind: 'orchestrator' });
  }, [selected.kind, features.review, features.tama]);

  const bin = env?.claudeBin ?? 'claude';
  const cards = useMemo(() => foldTasks(taskEvents, sessions), [taskEvents, sessions]);
  // 이 맥 세션 기록 — 여기 없는 대상(다른 기계·파트너 참모)은 늘 '세션 없음'이라 주인 잃은 일에서 뺀다(domain/orphans)
  const knownSessions = useMemo(() => [...allSessions, ...sessions, ...stopped].map((x) => ({ id: x.id, name: x.name, sessionId: x.sessionId })), [allSessions, sessions, stopped]);
  const localCards = useMemo(() => cards.filter((c) => c.status !== 'gone' || !isRemoteTarget(c.target, knownSessions)), [cards, knownSessions]);
  // 정렬: 나를 기다리는 것(답 필요·확인창) → 작업 중 → 끝남 → 대기·쉼, 같은 칸 안에선 최근 순
  const RANK: Record<ActivityStatus, number> = { asks: 0, blocked: 0, login: 0, working: 1, bgwait: 1, done: 2, idle: 3, unknown: 3, stale: 4 };
  const now = Date.now();
  const activities: SessionActivity[] = groups.projects
    .flatMap((p) => p.sessions)
    .map((s) => {
      const a = s.sessionId ? activity[s.sessionId] : undefined;
      return { session: s, activity: a ?? {}, status: activityStatus(s.state, a, now, listAt.current) };
    })
    .sort((a, b) => {
      if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] - RANK[b.status];
      const ta = a.activity.reply?.ts ?? a.activity.prompt?.ts ?? '';
      const tb = b.activity.reply?.ts ?? b.activity.prompt?.ts ?? '';
      return ta < tb ? 1 : ta > tb ? -1 : 0;
    });
  // 참모 세션까지 — 결정 대기·알림·인계는 참모도 본다(작업 패널 목록은 하위 세션만)
  const orchActs: SessionActivity[] = groups.orchestrators.map((s) => {
    const raw = s.sessionId ? activity[s.sessionId] : undefined;
    // 일을 넘긴 참모의 말로 깬 턴의 끝 질문은 그 참모에게 한 말 — 결정 대기함·알림·'물어봄'에 안 띄운다(domain/handedAsk, 10-28)
    const a = raw && quietHanded(raw, s.name, taskEvents, now);
    return { session: s, activity: a ?? {}, status: activityStatus(s.state, a, now, listAt.current) };
  });
  const allActs = [...orchActs, ...activities];
  // 도우미·프로젝트 밖 세션 — 대시보드 '지금 하는 일' 줄에만(결정 대기함·알림 범위는 그대로). 빠져 있어서 일하는 도우미가 '쉼'으로 보였다(2026-10-02 사용자)
  const sideActs: SessionActivity[] = [...groups.helpers, ...groups.loose].map((s) => {
    const a = s.sessionId ? activity[s.sessionId] : undefined;
    return { session: s, activity: a ?? {}, status: activityStatus(s.state, a, now, listAt.current) };
  });
  statesRef.current = Object.fromEntries([...allActs, ...sideActs].filter((x) => x.session.sessionId).map((x) => [x.session.sessionId!, x.status]));
  // 계정 자동 전환 — 계정 보기가 15초마다 새로 올 때 한 번씩(한도로 멈춘 세션은 참모·하위·도우미 다)
  useAccountAuto(accounts, [...allActs, ...sideActs], voice && features.voice);
  // 로그인 풀림 — 멈춘 세션들 + 맥 로그인을 '로그인 필요' 하나로, 고쳐진 걸 본 뒤 이어서(domain/login). 카드는 결정 대기함 맨 위
  const routineActs: SessionActivity[] = routineStalls(routineSess, activity).map(({ session: s, activity: a }) => ({ session: s, activity: a, status: activityStatus(s.state, a, now) }));
  const login = useLogin([...allActs, ...sideActs, ...routineActs], accounts, voice && features.voice);
  // 이 프로젝트 브라우저가 없는데 브라우저 일을 받았다 — 결정 대기함 [연결] 카드(task send·scripts/app browser need, GitHub #2)
  const browserNeeds = useBrowserNeeds((dir) => sessions.filter((x) => x.cwd === dir || x.cwd.startsWith(`${dir}/`)).length);
  // 모달을 안 보는 동안 세션 크롬에 뜬 크롬 자체 창(패스키·권한 등) — 결정 대기함 카드(누르면 모달 + 작게 꺼내기, AgentAskHost 가 채운다)
  const [popupCards, setPopupCards] = useState<Live[]>([]);
  const browserKeys = [browserNeeds.keys, ...popupCards.map((l) => `popup:${l.profile}:${l.pid}`)].filter(Boolean).join('|');
  // 사람 부르기(browser_ask_human) — 맡긴 참모 채팅 맨 아래·결정 대기함에 카드(2026-10-24 트레이더: 모달·알림뿐이라 밖에서 놓쳤다)
  const askList = useMemo(() => askPlaced(agentLives, allSessions, taskEvents, groups.orchestrators, groups.orchestrator, heirOf), [agentLives, allSessions, taskEvents, groups.orchestrators, groups.orchestrator]); // eslint-disable-line react-hooks/exhaustive-deps
  const browserCount = browserNeeds.count + popupCards.length + askList.length;
  // 위 막대 사용량 — 지금 계정 칸 기록(계정 토큰으로 물은 값)이 있으면 그걸로: 계정을 바꾸면 세션 대화 없이도 바로 바뀐다. 없으면 상태줄 값
  const acctUsage = usageOf(accounts, now);
  const barUsage = acctUsage?.usage ?? usage;
  const orchIds = new Set(groups.orchestrators.map((s) => s.id));
  const orchKey = orchActs.map((x) => `${x.session.id}:${x.status}:${x.session.state}:${x.activity.reply?.ts}:${x.activity.reply?.midTurn}`).join(',');
  const badges = useMemo(() => Object.fromEntries(docs.map((d) => [d.name, docBadges(d)])), [docs]);
  const running = new Set(groups.projects.map((p) => p.name));
  const idleProjects = docs.map((d) => d.name).filter((n) => !running.has(n) && n !== env?.orchestratorCwd.split('/').pop());
  // 그 참모 목소리로(프로필 voice, 없으면 번호 순 기본 배정) — 설정이 Supertonic 실행기가 아니면 Rust 가 설정 그대로 읽는다
  const speakAs = (s: Session, t: string) => {
    const a = avatarSnapshot();
    const base = baseVoice(a.ttsCommand);
    return speak(t, base ? voiceFor(a.saved, s.name || '', base) : undefined, s.id);
  };
  // 쌓아 둔 그 참모 답 읽기 — 채팅 탭을 열 때·"○○ 거 읽어 줘"(scripts/app voice read). 없으면 asked 일 때만 없다고 말한다
  const readHeld = (id: string, asked = false) => {
    if (!voiceRef.current) return;
    const s = groups.orchestrators.find((o) => o.id === id);
    const h = takeHeld(voiceHeld.current, id);
    voiceHeld.current = h.held;
    if (s && h.text) void speakAs(s, h.text).catch(() => {});
    else if (s && asked) void speak(tr(`${orchDisplay(s) || assistant()}한테 쌓인 답 없어.`, `Nothing waiting from ${orchDisplay(s) || assistant()}.`)).catch(() => {});
  };
  useEffect(() => { if (chatTab) readHeld(chatTab); }, [chatTab]); // eslint-disable-line react-hooks/exhaustive-deps
  // 참모가 확인창에서 멈추면 알림(+음성). 상태는 agents --json 이 바로 알려 줘서 바뀜으로 본다
  useEffect(() => {
    // 대화 기록을 한 번이라도 읽기 전엔 추적하지 않는다 — 켜자마자 알림이 쏟아지는 걸 막는다
    if (Object.keys(activity).length === 0) return;
    const next = Object.fromEntries(orchActs.map((x) => [x.session.id, x.status]));
    for (const t of transitions(prevStatus.current, next)) {
      const x = orchActs.find((a) => a.session.id === t.id);
      if (!x || t.to !== 'blocked' || picking.has(x.session.id)) continue; // 모델 칩이 고르는 창을 다루는 중
      const name = orchDisplay(x.session) || assistant();
      const body = blockedBody(x.session.waitingFor);
      if (voiceRef.current) void speak(`${name} ${body}`, undefined, x.session.id).catch(() => {});
      notifyOnce({ kind: 'blocked', session: x.session.id, orch: true, title: tr(`${name} 확인창`, `${name} needs an OK`), body });
    }
    prevStatus.current = settled(prevStatus.current, next);
    // 참모가 새로 마친 답 — 답 ts 로 한 번만(상태 바뀜으로 보면 10초 늦은 대화 기록 탓에 옛 답을 또 읽었다, domain/voice)
    // since — 앱이 켜진 때와 그 세션이 (다시) 켜진 때 중 늦은 것. 그 전에 끝난 턴은 안 읽는다(respawn 한 참모가 일주일 전 답을 읽었다, 2026-10-20)
    const sinceOf = (s: Session) => [appStartedAt.current, s.startedAt > 0 ? new Date(s.startedAt).toISOString() : ''].sort().pop()!;
    const r = freshReplies(seenReplies.current, orchActs.map((x) => ({ id: x.session.id, state: x.session.state, activity: x.activity, since: sinceOf(x.session) })));
    if (JSON.stringify(r.seen) !== JSON.stringify(seenReplies.current)) save('seenReplies', r.seen);
    seenReplies.current = r.seen;
    // 소리 내 읽는 참모 — 사람이 마지막으로 직접 말한 참모 + 앞에 띄운 채팅 탭(채팅 뷰) 또는 커서가 있는 참모 창(터미널 뷰). 나머지는 쌓고 한 줄
    const front = spaceShownRef.current ? (focusedBy.current.get('orch-col') ?? groups.orchestrators[0]?.id) : focused.current; // 채팅 칸이 보이는 참모(누른 탭, 없으면 첫 참모 — spaceOrch 와 같은 규칙)
    const speakers = talkedTo(orchActs.map((x) => ({ id: x.session.id, human: x.activity.human })), front);
    for (const f of r.fresh) {
      const x = orchActs.find((a) => a.session.id === f.id)!;
      const s = x.session;
      // 참모가 음성용 말을 따로 넘겼으면(scripts/say) 그걸, 아니면 답 앞부분 + 끝 질문. 다른 참모가 보낸 말로만 깬 턴은 그 참모에게 한 답이라 안 읽는다.
      // 꼬리(256KB)가 턴 중간에서 잘려 깨운 말을 모르면 기록을 더 길게 읽어 다시 가른다(10-28: 그림 읽기로 길어진 디자인 담당 턴이 사람 턴처럼 알려졌다)
      if (voiceRef.current) void (async () => {
        let reply = f.reply;
        const giver = (r: Line) => giverTurn(r.woke, s.name, taskEvents, now); // 넘긴 쪽이 받은 쪽 질문으로 깬 턴은 사람에게 묻는 길 — 버리지 않는다
        let how = voiceTurn(reply, speakers.has(s.id), false, giver);
        if (how === 'deeper' && s.sessionId) {
          const tail = (await readTranscriptTails([s.sessionId], DEEP_TAIL).catch(() => ({} as Record<string, string>)))[s.sessionId];
          const again = tail ? summarizeTranscript(tail).reply : undefined;
          if (again?.ts === reply.ts) reply = again;
          how = voiceTurn(reply, speakers.has(s.id), true, giver);
        }
        if (how === 'skip') return undefined;
        const log = await readSay().catch(() => '');
        // 앱을 켜기 전에 넘긴 말은 안 읽는다 — 켤 때마다 '이미 읽은 말' 기억이 비어 옛 말을 몰아 읽었다
        const since = [x.activity.prompt?.ts ?? '', appStartedAt.current].sort().pop()!;
        const p = pickSay(parseSay(log), [s.id, s.sessionId], since, spokenSay.current[s.id]);
        if (p) spokenSay.current[s.id] = p.last; // 읽은 말은 다음 답에서 다시 안 읽는다
        const t = p?.text ?? reply.say;
        if (!t) return undefined;
        const o = routeReply(voiceHeld.current, { id: s.id, name: orchDisplay(s) || assistant(), text: t, asks: !!reply.asks, ts: reply.ts, human: !!reply.byHuman }, speakers);
        voiceHeld.current = o.held;
        // 다른 참모 알림 한 줄은 기본 목소리로 — 말하던 것 뒤에 줄 선다(Rust 차례 잠금)
        if (o.note) return speak(o.note, undefined, s.id);
        return o.speak ? speakAs(s, o.speak) : undefined;
      })().catch(() => {});
      if (f.reply.asks) notifyOnce({ kind: 'asks', session: s.id, orch: true, title: tr(`${orchDisplay(s) || assistant()} 답이 필요해`, `${orchDisplay(s) || assistant()} needs your answer`), body: f.reply.text });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orchKey, Object.keys(activity).length > 0]);

  // 컨텍스트 80% 를 넘는 순간 macOS 알림 — 곧 자동 요약되니 /compact 하거나 새 세션으로 넘길 때. 참모 세션만(하위 세션은 참모가 챙긴다)
  const ctxOf = (s: Session) => (s.sessionId ? ctx[s.sessionId]?.used : undefined);
  const modelOf = (s: Session) => (s.sessionId ? ctx[s.sessionId] : undefined);
  useEffect(() => {
    const now = Object.fromEntries(Object.entries(ctx).map(([k, v]) => [k, v.used]));
    if (prevCtx.current) {
      for (const sid of ctxAlerts(prevCtx.current, now)) {
        const s = sessions.find((x) => x.sessionId === sid);
        const orch = !!s && orchIds.has(s.id);
        const where = s ? (orch ? orchDisplay(s) || assistant() : s.workspace ? `${s.project} / ${s.workspace}` : s.project) : sid.slice(0, 8);
        notifyOnce({ kind: 'ctx', session: sid, orch, title: tr(`${where} 대화 ${now[sid]}% 찼어`, `${where} conversation is ${now[sid]}% full`), body: tr('곧 자동 요약돼 — /compact 하거나 새 세션으로 넘길 때야', 'It will be summarized soon — time to /compact or hand off to a new session') });
      }
    }
    prevCtx.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  // ⌘⇧W: 보고 있는 창의 세션을 끈다(대화는 남아 "꺼진 세션"에서 이어갈 수 있다) — 어느 세션이든 확인 창을 한 번 거친다(2026-10-12 사용자: ⌘W 는 탭 닫기로 넘어갔고 세션 끄기는 되돌리기 어렵다).
  // 비서(참모·참모-2…)는 채팅 뷰에서만 — 터미널 뷰에선 안 끈다(리더 탭 닫으려던 ⌘W 에 참모-2 가 꺼졌다, 2026-09-28)
  const spaceShownRef = useRef(false);
  const askStopRef = useRef<((s: Session) => void) | null>(null);
  const closePaneRef = useRef<() => void>(() => {});
  closePaneRef.current = () => {
    const id = focused.current;
    const s = sessions.find((x) => x.id === id);
    if (s && spaceShownRef.current && groups.orchestrators.some((o) => o.id === s.id)) { askStopRef.current?.(s); return; }
    if (!s || !closableByShortcut(s, groups.orchestrators)) {
      setError(s ? tr(`${assistant()}는 ${keyLabel('⌘⇧W', IS_WIN)}로 안 꺼져 — 창 버튼의 끄기를 써줘`, `${keyLabel('⌘⇧W', IS_WIN)} does not stop ${assistant()} — use the pane's stop button`) : tr('끌 창을 먼저 한 번 클릭해줘', 'Click the pane you want to stop first'));
      return;
    }
    if (s.kind !== 'background') return;
    askStopRef.current?.(s);
  };

  // ⌘⇧T: 보고 있는 프로젝트에 세션 하나 더. 참모 화면이면 참모를 하나 더(참모-2 …) — 한 참모가 바쁠 때 다른 참모로 위임하려고.
  // 전체 보기에선 마지막으로 클릭한 창의 프로젝트. 같은 폴더를 여럿이 만지는 충돌은 사용자가 피한다(worktree 는 프로젝트 머리줄에서)
  const newSessionRef = useRef<() => void>(() => {});
  newSessionRef.current = () => {
    if (!env) return;
    let cwd: string;
    let name: string;
    if (selected.kind === 'orchestrator' || selected.kind === 'orchHome') {
      setNaming(true); // 새 참모는 이름부터(번호 대신 별명) — '+' 와 같은 창
      return;
    } else {
      const project = selected.kind === 'project' ? selected.name : sessions.find((x) => x.id === focused.current)?.project;
      if (!project) {
        setError(tr(`${keyLabel('⌘⇧T', IS_WIN)} 는 프로젝트나 ${assistant()} 화면에서 — 전체 보기에선 창을 먼저 한 번 클릭해줘`, `Use ${keyLabel('⌘⇧T', IS_WIN)} on a project or the ${assistant()} view — in All sessions, click a pane first`));
        return;
      }
      cwd = projectDir(project, env.devRoot, env.extraProjects);
      name = project;
    }
    setStarting((l) => [...l, name]);
    void newSession(cwd, name)
      .then(() => refresh())
      .catch((e: unknown) => setError(tr(`${name} 새 세션 실패: ${String(e)}`, `Could not start a new ${name} session: ${String(e)}`)))
      .finally(() => setStarting((l) => { const i = l.indexOf(name); return i < 0 ? l : [...l.slice(0, i), ...l.slice(i + 1)]; }));
  };

  // 세션 메모(⌘M) — 프로젝트별 HOLO MEMO 파일. 머리줄엔 최근 한 줄, 열린 창 위엔 메모판
  const memos = useMemos(sessions.map((s) => s.project));
  // 같은 창 '교훈' 탭 — 참모 지시에 붙는 프로젝트 교훈(scripts/task lesson). 열린 창의 프로젝트만 읽는다
  const lessons = useLessons(sessions.find((s) => s.id === memoOpen)?.project ?? null);
  const lessonErr = (e: unknown) => setError(tr(`교훈 수정 실패: ${String(e)}`, `Could not update the lesson: ${String(e)}`));
  const memo: MemoHooks = {
    note: (s) => memos.items(s.project).at(-1)?.text,
    openId: memoOpen,
    onToggle: (id) => setMemoOpen((o) => (o === id ? null : id)),
    panel: (s, send) => (
      <MemoPanel
        project={s.project}
        items={memos.items(s.project)}
        onAdd={(text) => memos.add(s.project, text).catch((e: unknown) => setError(tr(`메모 저장 실패: ${String(e)}`, `Could not save the note: ${String(e)}`)))}
        onSend={(text) => { setMemoOpen(null); send(text); }}
        onCopy={(text) => void writeClipboard(text).catch(() => {})}
        onRemove={(item) => void memos.remove(s.project, item).catch((e: unknown) => setError(tr(`메모 삭제 실패: ${String(e)}`, `Could not delete the note: ${String(e)}`)))}
        onClose={() => setMemoOpen(null)}
        lessons={{ mine: lessons.mine, common: lessons.common }}
        onRemoveLesson={(name, l) => void lessons.remove(name, l).catch(lessonErr)}
        onPromoteLesson={(l) => void lessons.promote(l).catch(lessonErr)}
        onGroupLessons={groups.orchestrator ? () => {
          const o = groups.orchestrator;
          if (!o) return;
          const text = groupRequest(s.project, lessons.mine.length);
          window.dispatchEvent(new CustomEvent('chat-pending', { detail: { id: o.id, text } }));
          void sendTextToSession(o.id, text).then(() => setMemoOpen(null), lessonErr);
        } : undefined}
      />
    ),
  };

  // 도구 권한 창은 앱이 이름으로 Allow 를 찾아 자동 허용 (결정 대기함엔 선택지 질문·민감한 창만 남는다)
  useAutoAllow(sessions, env?.devRoot, loadAllowLog);
  // 하위 세션 선택지 창은 참모에게 넘긴다 — 참모가 골라 답하거나 사용자에게 묻는다. 사용자가 그 화면을 보고 있으면 안 넘긴다
  const subSessions = useMemo(() => [...groups.helpers, ...groups.loose, ...groups.projects.flatMap((p) => p.sessions)], [groups]);
  // 보고 없이 멈춘 예약(scripts/routine tick 의 stall) — 예약 세션은 세션 목록 밖이라 맨 앞 참모에게 한 줄
  useRoutineStalls(routines, groups.orchestrator);
  useForwardQuestions(subSessions, groups.orchestrator, (s) =>
    document.hasFocus() && (selected.kind === 'project' ? selected.name === s.project : selected.kind === 'helpers' ? groups.helpers.includes(s) : selected.kind === 'loose' && groups.loose.includes(s)),
    allActs.filter(({ session: s }) => !orchIds.has(s.id)),
    groups.orchestrators.map((o) => o.sessionId).filter((x): x is string => !!x), taskEvents, groups.orchestrators, sessions, heirOf, cards);
  // 앱 밖 크롬(직접 띄운 크롬·확장 중계)을 쓰는 세션 — 맡긴 참모에게 한 줄(2026-10-10 사용자 '참모 브라우저만')
  useForeignBrowsers(subSessions, groups.orchestrator, taskEvents, groups.orchestrators, sessions, heirOf);
  // claude 데몬이 다른 데이터 폴더(시험 CHAMMO_HOME)로 떠 있으면 맨 앞 참모에게 한 줄 — 세션은 데몬 env 를 물려받는다(2026-10-23 아이맥)
  useDaemonEnv(groups.orchestrator);
  useCraftHandback(groups.orchestrator);
  useAskWake(agentLives, sessions);
  // 직접 답하기 카드 — 하위 세션이 본인 승인을 원하면 맡긴 참모 채팅에 카드(사람이 누르면 그 세션에 사람 말로)
  // 살아 있나·이름은 폴더로 거르기 전 전체 목록(allSessions)으로 — 워크트리로 들어가 사이드바에서 빠진 세션 카드가 꺼짐으로 숨었다(2026-10-05 아이맥)
  const direct = useDirectCards(allSessions, allActs, taskEvents, groups.orchestrators, groups.orchestrator, agentLives, (c, name, owner) => notifyOnce({
    kind: 'human', session: c.from, orch: false, ...(owner ? { go: cardTarget(owner.id, cardToken(c.id)) } : {}),
    title: tr(`${josa(name, '이', '가')} 네 답을 기다려`, `${name} needs your answer`),
    body: `${kindView(c.kind).word}${c.amount ? ` ${c.amount}` : ''} — ${c.q}`,
  }), heirOf, async (c) => {
    // 주인 세션이 꺼진 카드 — 같은 번호로 다시 띄운다(꺼진 목록에 있으면 그 폴더·대화 번호로)
    const st = stopped.find((x) => x.id === c.from);
    await resumeSession(st?.cwd ?? c.cwd, st?.sessionId ?? '', c.from);
    refresh();
  });
  // 세션 자동 정리 — 끝나고 조용한 팀 세션을 맡긴 참모에게 한 줄(갱신·끄기·워크트리 정리는 참모 몫, domain/autoTidy · 2026-10-23 사용자)
  useAutoTidy({ on: features.autoTidy, subs: subSessions, helpers: groups.helpers, acts: allActs, events: taskEvents, asking: direct.inboxCards.filter(needsAnswer).map((c) => c.from),
    front: groups.orchestrator, orchs: groups.orchestrators, sessions, heir: heirOf });
  // 오래 멈춘 목표 — 같은 스위치, 그 목표를 맡긴 참모 입력칸에 한 줄(domain/goalStall)
  useGoalStall({ on: features.autoTidy, orchs: groups.orchestrators, events: taskEvents, sessions });
  const inbox = buildInbox(allActs, taskEvents, new Set(dismissed), sessions, (s) => orchIds.has(s.id), (s) => orchDisplay(s) || assistant()).filter((i) => !(i.kind === 'blocked' && picking.has(i.target ?? '')));
  // 새 결정이 생기면: 종 아래 드롭다운이 저절로 펼쳐짐 + macOS 알림. 개수는 상단 바 종·Dock 뱃지
  // 직접 답하기 카드도 결정 대기함에 — 새로 기다리는 카드가 생기면 드롭다운도 펼친다(어느 화면·탭을 보든 보이게)
  // 짝지은 다른 기기의 카드(ADR 0011) — 같은 종에, 새로 기다리면 같이 펼친다
  const remote = useRemoteCards();
  // 다른 기기 보기(peer-panel) — 띠 맨 위 기기 단추·그 기기 띠·스페이스·맨 위 줄. 채팅 칸은 원격 채팅(remoteChat) 그대로
  const farMode = useFarMode({ remoteChat, setRemoteChat, cards: remote.cards, fontSize, onConnect: () => { setSettingsTab('devices'); setSettingsOpen(true); } });
  // 팀 모드(시안 team-space A) — 띠 팀 칸·가운데 팀 대화·팀 스페이스. '내 참모에게' 넘기기는 지금 채팅 칸 참모(스페이스 보내기와 같은 참모)
  const teamMode = useTeamMode({
    wide: sidebarOpen,
    handoff: () => {
      const o = groups.orchestrators.find((x) => x.id === focusedBy.current.get('orch-col')) ?? groups.orchestrators[0];
      // 보내기는 Rust team_handoff 한 길 — 글을 다시 거르고(CR·ESC 등) 기록엔 본문 없이(보안 검토 10-23)
      return o ? { name: orchDisplay(o) || assistant(), send: async (text: string, to?: string) => { await invoke<string>('team_handoff', { text, dry: false, to: to ?? o.id }); } } : undefined;
    },
  });
  useEffect(() => {
    const fresh = freshAppCards(prevApp.current, direct.inboxCards);
    prevApp.current = new Set(direct.inboxCards.map((c) => c.id));
    if (fresh.length) setAppNote(fresh[0]!.q);
  }, [direct.inboxCards]);
  // 몇 초 뒤 사라짐 — 위 효과는 렌더마다 돌아서 타이머는 알림 글에만 묶는다
  useEffect(() => {
    if (!appNote) return;
    const t = window.setTimeout(() => setAppNote(null), 6000);
    return () => window.clearTimeout(t);
  }, [appNote]);
  const directWait = [...direct.inboxCards.filter(needsAnswer).map((c) => c.id), ...remote.cards.map((x) => `${x.dev}:${x.card.id}`)];
  const prevDirect = useRef<Set<string> | null>(null);
  // 상태까지 열쇠에 — 꺼짐→기다림(세션이 목록에 다시 나타남)도 새 카드처럼 펼친다(2026-10-05 사고 모양)
  const termsKeys = login.terms.map((c) => c.id).join('|');
  const inboxKeys = `${inbox.map((i) => i.key).join('|')}#${direct.inboxCards.map((c) => `${c.id}:${c.state}`).join('|')}#${remote.keys}#${login.need?.since ?? ''}#${termsKeys}#${browserKeys}`;
  const prevLogin = useRef<number | null>(null);
  const prevTerms = useRef('');
  /** 로그인 카드 + 약관 카드(계정마다) */
  const loginCount = (login.need ? 1 : 0) + login.terms.length;
  const prevBrowser = useRef('');
  useEffect(() => {
    const prev = prevInbox.current;
    const fresh = freshItems(prev, inbox);
    // 로그인 카드가 새로 생기면 펼친다(알림·음성은 useLogin 이 한 번)
    const newBrowser = browserKeys.split('|').some((k) => k && !prevBrowser.current.split('|').includes(k));
    prevBrowser.current = browserKeys;
    const newTerms = termsKeys.split('|').some((k) => k && !prevTerms.current.split('|').includes(k));
    prevTerms.current = termsKeys;
    const newDirect = newBrowser || newTerms || directWait.some((id) => !prevDirect.current?.has(id)) || (login.need !== null && prevLogin.current !== login.need.since);
    prevDirect.current = new Set(directWait);
    prevLogin.current = login.need?.since ?? null;
    // 결정 항목이 0이어도 카드가 남아 있으면 펼친 걸 닫지 않는다(popoverOpen 은 항목 0이면 닫는다)
    setInboxOpen((o) => newDirect || popoverOpen(o, prev, inbox, { hold: settingsOpen || firstRun, askInView: spaceShownRef.current }) || (o && (direct.inboxCards.length + remote.cards.length + loginCount > 0 || browserCount > 0)));
    prevInbox.current = new Set(inbox.map((i) => i.key));
    if (fresh.length) {
      // 참모 물어봄·확인창은 위에서 따로 알린다 — 여기선 결정(task ask)만. 로그인 풀림은 useLogin 이 한 번에 묶어서
      for (const f of fresh.filter((x) => x.kind === 'decide' && bornAfter(x, APP_STARTED))) notifyOnce(decideNote(f, sessions, (o) => orchDisplay(o) || assistant()));
    }
    void setBadge(inbox.length + direct.inboxCards.length + remote.cards.length + loginCount + browserCount).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxKeys]);
  const answerTask = (item: InboxItem, note: string) =>
    item.taskId ? appendTaskEvent({ ts: new Date().toISOString(), type: 'answer', task: item.taskId, note }).then(() => refresh()) : Promise.resolve();
  const dismissItem = (item: InboxItem) => {
    if (item.taskId) void answerTask(item, tr('처리함', 'Handled'));
    else setDismissed((d) => [...d, item.key]);
  };
  const replyItem = async (item: InboxItem, text: string) => {
    // 보내기 직전에 한 번 더 — 그 사이 선택지·권한 창이 떴을 수 있다
    const why = replyBlocked(item, sessions);
    if (why) { setError(`${item.project}: ${why}`); return; }
    const s = findTarget(sessions, item.target)!;
    try {
      await sendToSession(s.id, text);
      if (item.taskId) await answerTask(item, text);
      else setDismissed((d) => [...d, item.key]);
    } catch (e: unknown) {
      setError(tr(`${item.project} 답장 실패: ${String(e)}`, `Reply to ${item.project} failed: ${String(e)}`));
    }
  };

  // 무인 기계(설정 autoRevive) — 재시작으로 꺼진 세션을 사람 없이 이어서 켠다. 참모를 새로 띄우지는 않는다(2026-10-03 사용자 — 없으면 오케스트레이터 홈)
  // 2026-10-01 아이맥 재부팅: 앱은 떴는데 세션이 다 꺼진 채 "다시 켜기" 버튼만 떠 있었다(domain/revive autoRestore)
  const autoTried = useRef(new Set<string>());
  const autoBusy = useRef(false);
  useEffect(() => {
    if (autoBusy.current) return;
    // 참모는 바로, 그 밖은 끝났나 판단을 마친 '안 끝남'만(useLostTriage) — 끝난 세션까지 켜지 않게
    const act = autoRestore({ enabled: features.autoRevive, ready: snapReady, lost: lost.filter((s) => isLostOrch(s) || lostOpen.some((x) => x.sessionId === s.sessionId)), tried: autoTried.current });
    if (act.kind === 'none') return;
    autoBusy.current = true;
    void (async () => {
      try {
        const fails: string[] = [];
        for (const s of act.sessions) {
          autoTried.current.add(s.sessionId);
          markPending(s.sessionId);
          try {
            await resumeSession(s.cwd, s.sessionId, s.id);
          } catch (e: unknown) {
            fails.push(`${s.name}: ${String(e)}`);
          }
        }
        setError(fails.length ? tr(`자동으로 이어서 켜기 실패 ${fails.length}개 — ${fails.join(' · ')}`, `Auto-resume failed for ${fails.length} — ${fails.join(' · ')}`) : null);
        await refresh();
      } finally {
        autoBusy.current = false;
      }
    })();
    // 판단에 쓰는 값만 본다(함수들은 매 렌더 새로 만들어진다)
  }, [features.autoRevive, snapReady, lost, lostOpen]);
  // 새로 만든 참모가 목록에 뜨면 채팅 탭·왼쪽 대시보드·입력칸을 그리로(2026-10-02 사용자 "만든 뒤 바로 그 참모로")
  const goOrch = (id: string) => {
    teamMode.leave(); // 팀 모드면 팀 대화가 덮고 있다(⌘숫자·종 열기와 같은 길)
    setSpace(true);
    setSelected({ kind: 'orchestrator' });
    focusedBy.current.set('orch-col', id);
    setChatTab(id);
    setFocusReq((r) => ({ key: 'orch-col', id, n: (r?.n ?? 0) + 1 }));
    window.dispatchEvent(new CustomEvent('chat-tab-pick', { detail: id })); // 스페이스 대시보드도
  };
  // 홈에서 고른 참모로 — 채팅 뷰면 그 참모 채팅·대시보드, 터미널 뷰면 뷰를 안 바꾸고 오케스트레이터 칸에서 그 참모
  const goHere = (id: string) => {
    if (space) { goOrch(id); return; }
    setSelected({ kind: 'orchestrator' });
    focusedBy.current.set('orch', id);
    setFocusReq((r) => ({ key: 'orch', id, n: (r?.n ?? 0) + 1 }));
  };
  // 홈에서 이어서 켠 꺼진 참모(sessionId) — 살아 있는 목록에 뜨면 그 참모로 옮긴다(domain/orchHome resumedOrch)
  const [homeResume, setHomeResume] = useState<string | null>(null);
  const resumeFromHome = (x: StoppedSession) => {
    markPending(x.sessionId);
    markResuming(x.sessionId);
    setHomeResume(x.sessionId);
    void resumeSession(x.cwd, x.sessionId, x.id).then(() => refresh(), (e: unknown) => { setHomeResume(null); setError(tr(`${orchDisplay(x) || x.name} 이어서 켜기 실패: ${String(e)}`, `Could not resume ${orchDisplay(x) || x.name}: ${String(e)}`)); });
  };
  useEffect(() => {
    if (!homeResume) return;
    const id = resumedOrch(homeResume, groups.orchestrators);
    if (id) { setHomeResume(null); goHere(id); return; }
    const t = window.setTimeout(() => setHomeResume((c) => (c === homeResume ? null : c)), 60_000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeResume, groups.orchestrators]);
  // 참모가 앱이 끄지 않았는데 목록에서 사라지면 같은 대화로 다시 켠다(domain/orchRevive) — 사람은 껐다 켤 줄 모른다(2026-10-21 사용자).
  // 보고 있던 참모였으면 홈에서 깨울 때처럼 뜨면 그 채팅으로 돌아간다
  const lastFront = useRef<{ id?: string; prev?: string }>({});
  if (groups.orchestrator?.id !== lastFront.current.id) lastFront.current = { id: groups.orchestrator?.id, prev: lastFront.current.id };
  const reviving = useOrchRevive({
    orchs: navOrchs, all: sessions, ready: snapReady && !!env, refresh,
    revive: async (s) => {
      markPending(s.sessionId);
      markResuming(s.sessionId);
      if (lastFront.current.prev === s.id || lastFront.current.id === s.id) setHomeResume(s.sessionId);
      // 복사본으로 떨어지지 않게(copy=false) — 옛 번호를 기다리는 되살리기가 30초마다 또 복사본을 띄웠다(0.3.6 리뷰). 실패면 다음 차례에 다시, 3번이면 카드
      await resumeSession(s.cwd, s.sessionId, s.id, false).catch((e: unknown) => setError(tr(`${orchDisplay(s) || s.name} 다시 켜기 실패: ${String(e)}`, `Could not restart ${orchDisplay(s) || s.name}: ${String(e)}`)));
    },
  });
  // 깨우는·새로 켜는 동안 참모 채팅 입력칸 위 한 줄(2026-10-12 rail-wake) — 채팅은 뜰 때까지 앞 참모에 남아서, 그사이 친 말이 엉뚱한 참모로 가지 않게
  const wakeX = homeResume ? stopped.find((x) => x.sessionId === homeResume) : undefined;
  const wakeName = wakeX?.name ?? (creating && !arrivedOrch(creating, navOrchs) ? creating : undefined);
  const revivingX = reviving[0];
  const wakeNote = wakeName ? <WakeNotice name={wakeName} label={wakeX ? orchDisplay(wakeX) || wakeName : seenName(wakeName)} waking={!!wakeX} />
    : revivingX ? <WakeNotice name={revivingX.name} label={orchDisplay(revivingX) || revivingX.name} waking text={tr(`${orchDisplay(revivingX) || revivingX.name} — 꺼져서 다시 켜는 중`, `${orchDisplay(revivingX) || revivingX.name} stopped — restarting it`)} /* 이름이 '참모'면 '참모 참모가'로 겹쳤다(10/21 시험 앱) */ /> : undefined;
  // 위젯 '더보기'·단축키 — 화면을 옮기지 않고 지금 화면 위 모달로(같은 PetView). 전엔 채팅 뷰면 스페이스 펫 탭으로 넘어갔다(2026-10-10 사용자)
  openPetRef.current = () => setPetModal(true);
  useEffect(() => {
    if (!creating) return;
    const id = arrivedOrch(creating, groups.orchestrators);
    if (id) { setCreating(null); goOrch(id); return; }
    const t = window.setTimeout(() => {
      setCreating((c) => (c === creating ? null : c));
      setError(tr(`${creating} — 1분이 지나도 안 떴어. 목록을 새로 고쳐 봐`, `${creating} did not appear within a minute — try refreshing`));
    }, 60_000);
    return () => window.clearTimeout(t);
  }, [creating, groups.orchestrators]);

  // 주인 잃은 일 — 그 세션을 이어서 켜고, 이름이 바뀌어 못 찾을 수 있으면 작업 기록의 대상을 새 id 로 옮긴다
  const resumeOrphan = async (c: TaskCard) => {
    const st = orphanSession(c.target, stopped);
    if (!st) return;
    markPending(st.sessionId);
    markResuming(st.sessionId); // 다른 켜기 길처럼 '켜는 중' 줄로 — 안 하면 켜는 동안 줄이 아예 사라졌다(2026-10-03 QA 6번)
    try {
      const out = await resumeSession(st.cwd, st.sessionId, st.id);
      if (st.name !== c.target) {
        const { id } = parseSpawnOutput(out);
        await appendTaskEvent({ ts: new Date().toISOString(), type: 'note', task: c.id, note: tr('이어서 켬', 'Resumed'), target: id });
      }
    } catch (e: unknown) {
      setError(tr(`${c.target} 이어서 켜기 실패: ${String(e)}`, `Could not resume ${c.target}: ${String(e)}`));
    }
    await refresh();
  };
  const finishMany = (cs: TaskCard[]) => {
    const ts = new Date().toISOString();
    // 한 줄씩 차례로 — 같은 파일에 동시에 덧붙이지 않게
    const note = tr('정리 — 같은 세션에 새 일이 가서 넘어감(끝 기록 없음)', 'Tidied — a newer task went to the same session');
    void cs.reduce((p, c) => p.then(() => appendTaskEvent({ ts, type: 'done', task: c.id, note })), Promise.resolve()).then(() => refresh());
  };
  const finishOrphan = (c: TaskCard) =>
    void appendTaskEvent({ ts: new Date().toISOString(), type: 'done', task: c.id, note: tr('세션 없음 — 끝난 걸로 정리', 'No session — marked as finished') }).then(() => refresh());

  // 부하 모니터 — Chammo 세션(프로젝트·HQ·루틴)과 그 밖 Claude 세션을 나눠 준다. 부하 화면을 열면 더 자주 잰다
  const loadMine = [...sessions, ...allSessions.filter((s) => s.name.startsWith('routine-') && !sessions.some((x) => x.id === s.id))];
  const loadOthers = allSessions.filter((s) => !loadMine.some((x) => x.id === s.id));
  const loadMon = useLoad(loadMine, loadOthers, selected.kind === 'load');
  const openTarget = (target: string) => {
    const s = findTarget(sessions, target);
    if (!s) return;
    teamMode.leave(); // 팀 모드면 그 세션이 팀 대화·팀 스페이스 밑에 가려진다(10-26 사용자 — 종 카드 열기가 안 먹었다)
    // 참모(들)는 프로젝트가 아니라 참모 화면에, 도우미는 도우미 화면에 있다
    const orch = groups.orchestrators.some((o) => o.id === s.id);
    const helper = groups.helpers.some((h) => h.id === s.id);
    const loose = groups.loose.some((h) => h.id === s.id);
    setSelected(orch ? { kind: 'orchestrator' } : helper ? { kind: 'helpers' } : loose ? { kind: 'loose' } : { kind: 'project', name: s.project });
    // 가서 바로 칠 수 있게 — 가려져 있으면 드러내고 그 창에 포커스(사용자 2026-09-28: 알림 눌러 가도 다시 클릭해야 했다)
    const key = gridKeyOf(orch ? { kind: 'orch' } : helper ? { kind: 'helper' } : loose ? { kind: 'loose' } : { kind: 'project', project: s.project }, { space, office, officeFeature: features.office });
    for (const a of revealPane(layoutOf(key), s.id)) dispatchFor(key)(a);
    focusedBy.current.set(key, s.id);
    focused.current = s.id;
    setFocusReq((r) => ({ key, id: s.id, n: (r?.n ?? 0) + 1 }));
  };
  // macOS 알림을 누르면 Rust(notify_mac)가 창을 앞으로 가져오고 window.__notifyClick('<갈 곳>') 을 부른다
  const noteClickRef = useRef<(t: string) => void>(() => {});
  const teamOpenRef = useRef<(room: string) => void>(() => {});
  teamOpenRef.current = teamMode.openRoom;
  noteClickRef.current = (raw) => {
    const room = teamTarget(raw); // 팀 메신저 새 말(team_alert) — 그 대화로
    if (room) { teamOpenRef.current(room); return; }
    const t = readNoteTarget(raw);
    if (t?.to === 'inbox') setInboxOpen(true);
    else if (t?.to === 'session') openTarget(t.id);
    // 그 카드 — 데스크톱은 그 참모로 가고, 결정(w:)은 결정 대기함을, 직접 카드(d:)는 그 참모 채팅 끝에 있다
    else if (t?.to === 'card') { openTarget(t.orch); if (t.card.startsWith('w:')) setInboxOpen(true); const b = readAskCardKey(t.card); if (b) openAgentModal(b.profile, b.pid); }
  };
  useEffect(() => {
    const w = window as unknown as { __notifyClick?: (t: string) => void };
    w.__notifyClick = (t) => noteClickRef.current(t);
    return () => { delete w.__notifyClick; };
  }, []);
  // 참모 scripts/app — Rust(appctl.rs)가 app.jsonl 새 줄을 window.__appctl 로 넘긴다. 무엇을 할지는 domain/appctl
  const configRef = useRef(config);
  configRef.current = config;
  const saveFeature = (name: FeatureSwitch, on: boolean) => {
    const c = configRef.current;
    if (!c) return;
    const next = withFeature(c, name, on);
    configRef.current = next; // 한 번에 여러 줄이 와도 앞 줄 변경을 잃지 않게
    // 설정 화면 저장과 같은 길 — 파일에 쓰고, 화면(features)·메뉴를 바로 바꾼다(언어·이름이 아니라 다시 열 필요 없다)
    void writeConfig(next).then(() => { setConfig(next); return rebuildMenu(); }).catch((e: unknown) => setError(tr(`설정 저장 실패: ${String(e)}`, `Could not save settings: ${String(e)}`)));
  };
  // 사이드바 "폴더 추가" — 설정 화면의 "따로 둔 프로젝트"와 같은 규칙(domain/setup addExtraProject)
  const addProjectFolder = async () => {
    const c = configRef.current;
    if (!c || !env) return;
    const got = await pickFolder(tr('프로젝트로 추가할 폴더를 골라 주세요', 'Choose a folder to add as a project'), '~').catch(() => null);
    if (!got) return;
    const r = addExtraProject(c.extraProjects ?? [], got, c.devRoot, env.home);
    if (r.note === 'inside') { setSelected({ kind: 'project', name: got.split('/').filter(Boolean).pop() ?? got }); return; }
    if (r.note === 'root') { setError(tr('프로젝트 폴더 자체나 홈 폴더 전체는 추가할 수 없어요', 'Pick a single project folder, not the projects folder or your whole home folder')); return; }
    const next = { ...c, extraProjects: r.list };
    configRef.current = next;
    await writeConfig(next).then(() => setConfig(next)).catch((e: unknown) => setError(String(e)));
    setSelected({ kind: 'project', name: got.replace(/\/+$/, '').split('/').pop() ?? got });
  };
  const appctlRef = useRef<(line: unknown) => void>(() => {});
  appctlRef.current = (line) => {
    const it = intentOf(line);
    if (!it) return;
    if (it.kind === 'voice') {
      if (it.on && !featuresRef.current.voice) saveFeature('voice', true);
      turnVoice(it.on);
    } else if (it.kind === 'voiceRead') {
      const id = heldTarget(it.target, groups.orchestrators.map((o) => ({ id: o.id, name: o.name, display: orchDisplay(o) })));
      if (id) readHeld(id, true);
    } else if (it.kind === 'feature') saveFeature(it.name, it.on);
    else if (it.kind === 'modelPick') {
      // 폰 입력창 모델 칩 — 그 세션 창(SessionGrid)이 데스크톱 칩과 같은 pickFor 로
      window.dispatchEvent(new CustomEvent('phone-model-pick', { detail: { id: it.id, want: it.want } }));
    }
    else if (it.kind === 'browserNeed') browserNeeds.add({ dir: it.dir, session: it.session, why: it.why });
    else if (it.kind === 'label') {
      // 폰에서 바꾼 별명 — 앱 별명에 넣고, 진짜 이름은 쉬는 때(위 renamesToSend)
      const o = navOrchs.find((x) => x.id === it.id);
      setOrchLabel(it.id, it.nick);
      if (o) wantNick(o, it.nick);
    }
    else if (it.kind === 'open') {
      const sc = openShortcut(it.what);
      if (opensHomeDash(it.what, spaceShownRef.current)) spaceCmd('dash');
      else if (sc) runRef.current(sc);
      else if (it.what === 'reader') setReaderOpen(true);
      else if (it.what === 'tasks') setTasksOpen(true);
      else if (it.what === 'inbox') setInboxOpen(true);
      else if (it.what === 'replay') replayRef.current('open');
      else if (it.what === 'load') setSelected({ kind: 'load' });
      else if (it.what === 'harnitor') harnitorRef.current('open');
      else if (it.what === 'tools') toolsRef.current('open');
    } else if (it.kind === 'close') {
      if (it.what === 'settings') { setSettingsOpen(false); setSettingsStart(undefined); } // 시작 작업이 남으면 다음에 열 때 설치를 또 돌린다
      else if (it.what === 'office') { if (spaceShownRef.current) setOfficeReq('close'); else setOffice(false); }
      else if (it.what === 'reader') setReaderOpen(false);
      else if (it.what === 'tasks') setTasksOpen(false);
      else if (it.what === 'harnitor') harnitorRef.current('close');
      else if (it.what === 'tools') toolsRef.current('close');
      else if (it.what === 'review') reviewRef.current('close');
      else setInboxOpen(false);
    } else if (it.kind === 'focus') {
      const plan = focusPlan(it.target, sessions, docs.map((d) => d.name));
      if (!plan) setError(tr(`${it.target} 세션·프로젝트를 못 찾았어`, `No session or project named ${it.target}`));
      // 채팅 뷰면 터미널로 넘어가지 않고 스페이스에 그 대시보드 — CLI 는 --terminal 일 때만(2026-10-02 사용자)
      else if (spaceShownRef.current && !it.terminal) window.dispatchEvent(new CustomEvent('space-focus', { detail: plan }));
      else if ('session' in plan) openTarget(plan.session);
      else setSelected({ kind: 'project', name: plan.project });
    } else if (it.kind === 'reload') {
      void reloadConfig().then((c) => { mirrorConfig(c); configRef.current = c; setConfig(c); }).catch(() => {});
    } else if (it.kind === 'pet') {
      if (!it.show) void tamaWidget(false).catch(() => {});
      else if (featuresRef.current.tama && !tama.widgetShown) tama.showWidget();
    }
  };
  useEffect(() => {
    const w = window as unknown as { __appctl?: (line: unknown) => void };
    w.__appctl = (line) => appctlRef.current(line);
    return () => { delete w.__appctl; };
  }, []);
  const onMessage = (m: string | null) => {
    setError(m);
    void refresh();
  };

  // 참모 화면 아래: 참모가 시킨 일 중 안 끝난 것의 세션을 최근 4개까지 한 줄로 미리보기(보기 전용)
  // 도우미(비서 폴더의 다른 이름 세션)는 빼고 — 사이드바 "도우미"에 따로 있다
  const delegated = recentDelegated(cards, sessions.filter((s) => !groups.helpers.includes(s)));
  const runningStrip = delegated.length > 0 && (
    <div className="running">
      <div className="running-head">{tr('지금 시킨 일', 'Delegated now')} · {delegated.length} <span className="dim">{tr('— 누르면 그 세션으로', '— click to open that session')}</span></div>
      {/* 한 줄로만 — 2줄로 쌓이면 칸이 반쯤 비어 깨진 화면처럼 보인다(2026-09-27 사용자) */}
      <div className="grid" style={{ gridTemplateColumns: `repeat(${delegated.length}, 1fr)`, gridTemplateRows: '1fr' }}>
        {delegated.map((s) => (
          <TerminalPane
            key={`run-${s.id}`}
            command={attachCommand(bin, s.id)}
            title={s.workspace ? `${s.project} / ${s.workspace}` : s.project}
            subtitle={s.name}
            fontSize={Math.max(9, fontSize - 2)}
            readOnly
            linkBase={s.cwd}
            home={env?.home}
            onHeadClick={() => setSelected({ kind: 'project', name: s.project })}
          />
        ))}
      </div>
    </div>
  );

  // 앞줄에 앉는 세션: 옆자리(둘) 다음 참모들 + 하위 세션. 자리표는 목록이 바뀔 때만 갱신
  const officeSlots = seatSlots(seats, [...groups.orchestrators.slice(3).map((s) => s.id), ...activities.map((a) => a.session.id)]);
  const slotsKey = JSON.stringify(officeSlots);
  useEffect(() => { if (slotsKey !== JSON.stringify(seats)) setSeats(JSON.parse(slotsKey)); }, [slotsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // 폰 사무실 모양(폰 서버 /api/office) — 자리표·반장·스킨·가구·장식이 바뀔 때만 office.json 에(domain/phoneOffice)
  const tamaPet = tama.file?.pet;
  const officeJson = gacha.file ? JSON.stringify(officeShape({ slots: officeSlots, boss: tamaPet ? spriteOf(tamaPet.egg, tamaPet.slot) : 'bear', skin: skinOfFile(gacha.file), furn: ownedOf(gacha.file, 'furn'), placed: gacha.file.placed ?? {}, deco: gachaDeco(gacha.file) })) : '';
  useEffect(() => { if (officeJson) writeOffice(officeJson).catch(() => { /* 폰 사무실만 옛 모양 — 다음 바뀜에 다시 */ }); }, [officeJson]);
  // 폰 뽑기·스킨(폰 서버 POST /api/gacha → phone_gacha.rs eval) — 굴리기·장착은 여기 useGacha 한 줄에서, 답은 대기표로 돌려준다
  const gachaPhone = gacha.phone;
  useEffect(() => {
    const w = window as unknown as { __gachaPhone?: (m: { key: string; req: unknown }) => void };
    const bridge = gachaBridge(gachaPhone, gachaPhoneReply, () => !featuresRef.current.gacha);
    w.__gachaPhone = (m) => { void bridge(m); };
    return () => { delete w.__gachaPhone; };
  }, [gachaPhone]);

  activeGrid.current = null; // 격자를 그리는 갈래가 gridFocus 로 다시 채운다
  /** 예약(루틴) 화면 — 사이드바(터미널 뷰)와 채팅 뷰 스페이스가 같이 쓴다. removed: 지운 뒤 갈 곳 */
  const routinePage = (name: string, removed: () => void, toChat?: (text: string) => void) => {
    const r = routines.find((x) => x.name === name);
    const live = r && !isCloud(r) ? allSessions.find((x) => x.name === `routine-${name}` && x.state !== 'idle') : undefined;
    return r ? (
      <RoutinePage routine={r} state={routineState(r, allSessions)} liveSession={live?.id ?? null} claudeBin={bin} fontSize={fontSize} onToChat={toChat}
        onAction={async (a) => {
          try { await routineDo(r.name, a); } catch (e: unknown) { setError(tr(`예약 ${r.name}: ${String(e)}`, `Scheduled ${r.name}: ${String(e)}`)); }
          if (a === 'remove') removed();
          pullRoutines();
          void refresh();
        }} />
    ) : <div className="empty"><b>{tr('예약을 찾을 수 없어요', 'Scheduled job not found')}</b></div>;
  };
  const routineItems = routines.map((r) => routineItem(r, allSessions)); // 5초마다 다시 읽어 '도는 중 N분'도 따라 바뀐다
  // 사무실 칸 — 터미널 뷰 사무실 모드와 채팅 뷰 스페이스(사무실 쪽)가 같이 쓴다(한 벌, 2026-10-03 사용자 A).
  // onOpen = 책상·현황판 카드를 누르면, dim = 옅게 할 이름표(채팅 뷰: 지금 탭 참모가 안 시킨 세션)
  // 사람이 그 세션 브라우저를 쥔 동안 채팅 맨 아래 한 줄(2026-10-06 사용자 ⑤) — 돌려주면 도구 결과 꼬리표가 대화에 남는다(domain/chat)
  const askExtra = (s: Session) => {
    const mine = askList.filter((p) => p.owner?.id === s.id);
    return mine.length ? [{ ts: new Date(mine[0]!.live.ask?.at ?? 0).toISOString(), key: 'browser-ask', pin: true, node: <div className="chat-row dc-row"><AskCards asks={mine} nameOf={(l) => askName(l, allSessions)} /></div> }] : [];
  };
  // 약관 동의 카드 — 그 계정으로 멈춘 세션을 맡긴 참모(멈춘 게 참모 자신이면 그 참모) 채팅 끝에만. 멈춘 세션이 없으면(계정만 막힘) 결정 대기함·폰에만
  const termsExtra = (s: Session) => {
    const mine = login.terms.filter((c) => c.sids?.some((id) => fileOwner(id) === s.id));
    return mine.length ? [{ ts: '9999-12-31T00:00:00.000Z', key: 'terms', pin: true, node: <div className="chat-row dc-row"><TermsCards cards={mine} onRetry={login.retryTerms} onClose={login.closeTerms} /></div> }] : [];
  };
  const takeoverExtra = (s: Session) => {
    const b = s.finished ? undefined : liveOf(s, agentLives);
    const line = b ? takeoverLine(b) : null;
    return b?.takeover && line ? [{ ts: new Date(b.takeover.at).toISOString(), key: `takeover:${b.profile}`, pin: true, node: <div className="chat-note">{line}</div> }] : [];
  };
  // 채팅 안 파일 카드 — 그 참모가 scripts/show 로 보여 준 그 시각 자리에(첫 말보다 앞선 건 ChatView 가 자른다, domain/chatExtras clip)
  const showLog = useShowLog(space);
  // 하위 세션이 띄운 것도 그 세션을 맡긴 참모 채팅에(스페이스가 문서를 둘 참모와 같은 판단, 2026-10-11 사용자 "왜 여기 채팅창에 안 뜸?")
  const navIds = navOrchs.map((o) => o.id).join();
  const fileOwner = useMemo(() => showOwnerOf(taskEvents, sessions, navOrchs.map((o) => o.id), Date.now()), [taskEvents, sessions, navIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const filesBy = useMemo(() => new Map<string, ChatFile[]>(), [showLog, fileOwner]); // 기록이 바뀔 때만 다시 읽는다(앱은 자주 다시 그린다)
  const subName = (id: string) => sessions.find((x) => x.id === id)?.name ?? id;
  const fileExtra = (s: Session) => (filesBy.get(s.id) ?? filesBy.set(s.id, chatFiles(showLog, s.id, fileOwner)).get(s.id)!).map((f) => ({ ts: f.ts, key: f.key, clip: true, node: <ChatFileCard f={f.from ? { ...f, who: subName(f.from) } : f} by={s.id} /> }));
  const officeCol = (open: (id: string) => void, dim?: (id: string) => boolean) => {
    // 사람 필요 책상·카드를 누르면 그 세션 브라우저 모달(지금 것) — 나머지는 부르는 쪽 길(채팅 뷰 = 사무실 위 창)
    const onOpen = (id: string) => {
      const s = sessions.find((x) => x.id === id);
      const b = s && !s.finished ? liveOf(s, agentLives) : undefined;
      if (b?.ask) openAgentModal(b.profile, b.pid); else open(id);
    };
    // 작업 중이면 마지막 도구로 행동·머리 위 한 줄(지시 뒤에 부른 도구만 — 옛 도구로 흉내 내지 않게)
    const seat = ({ session: s, status, activity: a }: SessionActivity): Seat => {
      const tool = status === 'working' && a.tool && (!a.prompt || a.tool.ts >= a.prompt.ts) ? a.tool : undefined;
      const name = tool ? tool.name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '') : '';
      // 사람 필요 — 그 세션 브라우저가 사람을 부름(대시보드 칸 paneStatus 와 같은 기준: 끝난 세션의 남은 부름은 무시)
      const ask = s.finished ? null : liveOf(s, agentLives)?.ask;
      return {
        ...(ask ? { human: ask.reason } : {}),
        // 사무실 이름표엔 브랜치(worktree)를 안 쓴다 — 프로젝트 이름만(사용자 2026-09-27)
        id: s.id, label: s.project, project: s.project, status, startedAt: s.startedAt,
        ...(status === 'working' ? { act: workAct(tool), ...(tool ? { doing: `${name} ${tool.target}`.trim() } : {}) } : {}),
      };
    };
    const pet = tama.file?.pet;
    const g = gacha.file ?? EMPTY_GACHA;
    const room = withLounge(planRoom(
      orchActs.map((a) => ({ ...seat(a), label: orchDisplay(a.session) || assistant() })),
      activities.map(seat),
      pet ? spriteOf(pet.egg, pet.slot) : 'bear',
      officeSlots,
      placedCells(ownedOf(g, 'furn'), g.placed), // 가구가 먼저 — 책상이 놓인 가구 칸을 건너뛴다
    ), ownedOf(g, 'furn'), g.placed);
    const deco = gachaDeco(g);
    // 반장 반응 재료 — 참모의 마지막 턴 끝 답(중간 멘트 제외), 머지만큼(10코인 이상) 들어오면 만세
    const head = orchActs[0];
    const last = head?.activity.reply;
    const bossIn = head ? {
      status: head.status,
      reply: last && !last.midTurn ? { text: last.say ?? last.text, ts: Date.parse(last.ts) } : null,
      voice,
      cheerAt: gacha.gain && gacha.gain.n >= 10 ? gacha.gain.at : null,
    } : undefined;
    const skins = ownedSkins(g);
    const skin = skinOfFile(g);
    const editing = officeTab === 'furniture';
    const closeModal = () => setOfficeTab('office');
    const modal = officeTab === 'gacha' || officeTab === 'dex' || officeTab === 'deco'
      ? <Shop view={officeTab} onView={setOfficeTab} file={gacha.file} draw={gacha.draw} equip={(id) => void gacha.equip(id)} setSkin={(n) => void gacha.setSkin(n)} see={(id) => void gacha.see(id)} onPlace={() => setOfficeTab('furniture')} onClose={closeModal} />
      : null;
    // 가구 끌어 놓기: 방 칸이면 거기(못 놓는 칸이면 제자리), 트레이 위에서 놓으면 창고
    const drop = (cell: [number, number] | null, e: PointerEvent) => {
      const id = furnPick;
      setFurnPick(null);
      if (!id) return;
      if (cell && canPlace(room, cell)) void gacha.placeItem(id, cell);
      else if (!cell && (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('.furn-tray')) void gacha.placeItem(id, null);
    };
    const left = (
      <div className="office-col">
        <OfficeView dim={dim} room={room} skin={skin} menu={features.gacha ? <OfficeTools tab={officeTab} onTab={setOfficeTab} dot={{ dex: !!g.fresh?.length }} /> : undefined} bottom={editing ? 190 : 0} coins={g.coins} gain={gacha.gain} onGacha={editing || !features.gacha ? undefined : () => setOfficeTab('gacha')} bossIn={bossIn} deco={deco}
          edit={editing ? { drag: furnPick, ok: (c) => canPlace(room, c), onPick: setFurnPick, onDrop: drop } : undefined}
          peek={(id, doing) => {
            const ss = sessions.find((x) => x.id === id);
            if (!ss || orchIds.has(id) || ss.kind !== 'background') return null;
            return <TerminalPane command={attachCommand(bin, id)} title={ss.workspace ? `${ss.project} / ${ss.workspace}` : ss.project} subtitle={doing ?? ss.name} fontSize={Math.max(9, fontSize - 2)} readOnly linkBase={ss.cwd} home={env?.home} />;
          }}
          deliver={(t) => delivery(stampSeen(sendTail, seenSends.current, t), room, (target) => findTarget(sessions, target)?.id, t)} onOpen={onOpen} />
        {editing
          ? <FurnitureTray file={gacha.file} drag={furnPick} onGrab={setFurnPick} onDone={closeModal} pushed={room.furniture.filter((f) => f.pushed).map((f) => f.id)} inRoom={room.furniture.map((f) => f.id)} />
          : <OfficeDock dim={dim} desks={room.desks.filter((d) => !d.boss && !d.empty)} sk={skinOf(skin)} notes={Object.fromEntries(allActs.map(({ session: s, activity: a }) => [s.id, a.reply?.ask?.q || noteOf(a.reply?.say ?? a.reply?.text)]))} onOpen={onOpen} />}
        {modal && <OfficeModal onClose={closeModal}>{modal}</OfficeModal>}
      </div>
    );
    return left;
  };
  let main;
  let spaceShown = false; // 스페이스 모드면 리더가 왼쪽 칸이라 오른쪽 리더 패널은 안 띄운다
  // 대시보드·오케스트레이터 홈 "지금 하는 일" 한 줄 — 일하면 마지막 도구, 물으면 답 끝, 쉬면 쉼
  const liveLines = Object.fromEntries([...allActs, ...sideActs].map(({ session: x, activity: a, status }) => [x.id, { ...liveLine(status, a, now), st: status }]));
  // 사이드바·칸 머리 표시 — 대시보드와 같은 판단(liveLines.st), 기록을 아직 못 읽은 세션은 목록만으로
  const statusOf = (x: Session): ActivityStatus => liveLines[x.id]?.st ?? sessionStatus(x);
  // 오케스트레이터 홈 — 어떤 참모를 켤지(앱은 스스로 켜지 않는다, 2026-10-03 사용자). 채팅 뷰 스페이스·터미널 뷰 같은 화면
  const homeNode = (onGo: (id: string) => void) => (
    <OrchHome live={navOrchs} off={offOrchList} ctx={ctx} lines={liveLines} starting={resuming} ready={stoppedReady} creating={creating} waiting={lostHold}
      nameOf={(x) => orchDisplay(x)} colorOf={orchColor}
      onGo={onGo} onResume={resumeFromHome} onNew={env && !spawning ? () => setNaming(true) : undefined} />
  );
  // 참모에게 말하기 — 스페이스 보내기·홈 미니 대화가 같은 길: 그 참모 채팅에 '보내는 중' 말풍선(일하는 중이면 줄 서 있다가 들어가서,
  // 표시가 없으면 안 간 줄 알았다 2026-09-30 사용자) 다음 세션에 친다
  const sayTo = async (id: string, text: string) => {
    window.dispatchEvent(new CustomEvent('chat-pending', { detail: { id, text } }));
    await sendTextToSession(id, text);
  };
  // 홈 대시보드(채팅 뷰 띠 맨 위 홈, 2026-10-24 사용자 HA) — 참모 채팅 없는 전체 한눈에. 결정 대기 = 위 종과 같은 물음·직접 카드
  const homeDashNode = (go: HomeGo) => {
    const orchOf = (t: string | undefined) => { const s = t ? findTarget(navOrchs, t) : undefined; return s && navOrchs.some((o) => o.id === s.id) ? s : undefined; };
    const asks = [
      ...direct.inboxCards.map((c) => ({ key: `d:${c.id}`, text: c.q, where: c.cwd.split('/').filter(Boolean).pop() ?? '', who: orchOf(c.from), pay: c.kind === 'pay', open: () => direct.cardNode(c, 'home') })),
      ...inbox.map((i) => ({ key: i.key, text: i.text, where: [i.project, i.where].filter(Boolean).join(' · '), who: i.toOrch ? orchOf(i.target) : undefined,
        open: () => <InboxRow item={i} blockedWhy={(it) => replyBlocked(it, sessions)} onReply={replyItem} onOpen={openTarget} onDismiss={dismissItem} /> })),
    ];
    const running = sessions.filter((x) => !orchIds.has(x.id) && !x.finished && statusOf(x) === 'working').length;
    return (
      <HomeDash go={go} orchs={navOrchs} nameOf={(x) => orchDisplay(x)} roleOf={(n) => orchRoleOf(n)?.text} colorOf={orchColor} lines={liveLines} statusOf={statusOf}
        off={offOrchList} starting={resuming} onResume={resumeFromHome} events={taskEvents} sessions={sessions} projects={groups.projects}
        asks={asks} onAsks={() => setInboxOpen(true)} running={running} usage={barUsage} load={loadMon.sys ? { load1: loadMon.sys.load1, cores: loadMon.sys.cores } : undefined}
        review={reviewConfirm} office={features.office ? officeCol(() => {}) : undefined} say={sayTo} />
    );
  };
  if (selected.kind === 'orchHome' && !space) {
    main = <div className="orch">{homeNode(goHere)}</div>;
  } else if (selected.kind === 'orchestrator' || selected.kind === 'orchHome') {
    const o = groups.orchestrator;
    const view = orchView(groups.orchestrators);
    // 채팅 뷰는 참모가 없어도 스페이스(메뉴 + 오케스트레이터 홈) — 채팅 칸은 참모가 있을 때만
    if ((view === 'grid' || view === 'empty') && space) {
      spaceShown = true;
      // 스페이스에서 보내기 받는 참모 = 지금 채팅 칸에서 마지막으로 누른 탭(없으면 첫 참모)
      const lastOrch = focusedBy.current.get('orch-col');
      const spaceOrch = groups.orchestrators.find((x) => x.id === lastOrch) ?? groups.orchestrators[0];
      // 채팅 칸 — 띠 바로 옆(띠 | 채팅 | 스페이스, 2026-10-12 사용자 시안 v2 Q1 A): 머리 = 보이는 참모 이름·맡은 일 + 그 창 단추(칸 머리 줄과 한 줄로), 폭 손잡이는 오른쪽 가장자리
      // 팀 모드면 채팅 칸 = 대화 목록 + 대화(시안 team-space A). 대화 폭은 참모 채팅 폭과 따로 기억하고 기본은 좁게 — 스페이스(팀 홈·보관함)가 넓다(10-26 사용자).
      // 손잡이는 같은 하나(Grip) — 팀 모드면 대화 폭만 바꾼다
      const chatW = teamMode.chat ? teamMode.convo + teamMode.listW : chatWidth;
      const [gripMin, gripMax] = teamMode.chat ? [TEAM_CONVO.min + teamMode.listW, TEAM_CONVO.max + teamMode.listW] : [280, 900];
      const chatCol = (groups.orchestrators.length > 0 || remoteChat || farMode.far || teamMode.chat) && <div className="office-chats left" style={{ flex: `0 0 ${chatW}px`, width: chatW, ['--chat-k' as string]: fontSize / DEFAULT_FONT }}>
            <Grip side="right" width={chatW} onWidth={(w) => (teamMode.chat ? teamMode.setConvo(w - teamMode.listW) : setChatWidth(w))} min={gripMin} max={gripMax} />
            {/* 채팅 카드 — 띠의 고른 프사와 참모 색 윤곽 하나로 잇는다(SpaceView ChatLink, 2026-10-12 사용자 201.png). 손잡이는 카드 밖(가장자리) */}
            <div className="och-card">
            <div className="space-chat-head">
              {/* 이름·맡은 일(글만 — 프사는 띠에 있다)과 메모·터미널·크게 단추는 격자가 지금 보이는 창 것으로 여기 올린다(headSlot, 2026-10-12 사용자) */}
              <span className="sch-who" ref={setChatHeadSlot} />
              <span className="seg" role="group" aria-label={tr('보기', 'View')}>
                <button className={chatView === 'stack' ? 'on' : ''} aria-pressed={chatView === 'stack'} aria-label={tr('쌓기', 'Stack')} title={tr('쌓기 — 세션을 위아래로', 'Stack — sessions top to bottom')} onClick={() => setChatView('stack')}><IconStack /></button>
                <button className={chatView === 'tabs' ? 'on' : ''} aria-pressed={chatView === 'tabs'} aria-label={tr('탭', 'Tabs')} title={tr('탭 — 한 번에 한 세션', 'Tabs — one session at a time')} onClick={() => setChatView('tabs')}><IconTabs /></button>
              </span>
            </div>
            <ChatVoice.Provider value={features.voice ? { on: voice, toggle: () => turnVoice(!voice) } : null}>
            <FloatHost>{(floating) => <SessionGrid column chat={floating ? 'tabs' : chatView} extraOf={(s) => [...direct.extraOf(s), ...askExtra(s), ...takeoverExtra(s), ...termsExtra(s), ...fileExtra(s)]} ctxOf={ctxOf} modelOf={modelOf} sessions={groups.orchestrators} onReorder={reorderOrchPanes} pinnedIds={groups.orchestrators.filter((o) => o.sessionId && orchPins.includes(o.sessionId)).map((o) => o.id)} claudeBin={bin} fontSize={fontSize} home={env?.home} titleOf={(s) => orchDisplay(s) || assistant()} subOf={(s) => orchRoleOf(s.name)?.text} {...gridFocus('orch-col')} onStop={(s, why) => closeSession(s, why)} layout={layoutOf('orch-col')} dispatch={dispatchFor('orch-col')} onMessage={onMessage} memo={memo} headSlot={chatHeadSlot} chatNotice={wakeNote} />}</FloatHost>
            </ChatVoice.Provider>
            {/* 그 기기를 보는데 아직 고른 참모가 없다(읽는 중·그 기기에 참모 없음) — 이 맥 채팅이 비치지 않게 덮는다(잘못 친 말이 이 맥 참모로 가지 않게) */}
            {farMode.far && !remoteChat && <div className="och-remote"><div className="far-empty"><b>{farMode.farView?.cut ? tr('그 기기에 안 닿아요', "Can't reach that device") : farMode.farView?.none ? tr('그 기기에 떠 있는 참모가 없어요', 'No assistant running on that device') : tr('그 기기 참모를 읽는 중…', 'Loading assistants on that device…')}</b></div></div>}
            {/* 다른 기기 참모(ADR 0011) — 내 참모 칸은 붙인 채(터미널 붙임이 안 끊기게) 그 위를 같은 모양 칸으로 덮는다 */}
            {remoteChat && (
              <div className="och-remote">
              <div className="space-chat-head">
                <span className="sch-who">
                  <span className="sch-tx"><b className="sch-name">{seenName(remoteChat.name)}</b><span className="sch-role">{tr(`원격 · ${remoteChat.devName}`, `Remote · ${remoteChat.devName}`)}</span></span>
                  {/* 기기를 보는 중엔 돌아가기가 맨 위 줄 '이 맥으로' 하나 */}
                  {!farMode.far && <span className="sch-ctl"><IconButton size="s" label={tr('내 참모로 돌아가기', 'Back to my assistants')} onClick={() => setRemoteChat(null)}><IconClose /></IconButton></span>}
                </span>
              </div>
                <RemoteChat key={`${remoteChat.dev}:${remoteChat.agent}`} target={remoteChat} fontSize={fontSize} />
              </div>
            )}
            {/* 팀 모드 가운데(목록 + 대화) — 내 참모 칸은 붙인 채 위를 덮는다(원격 채팅과 같은 자리) */}
            {teamMode.chat && !remoteChat && !farMode.far && <div className="och-remote">{teamMode.chat}</div>}
            </div>
          </div>;
      main = (
        <div className={`far-wrap ${farMode.far ? 'far-on' : ''}`}>
        {farMode.bar}
        {farMode.pop}
        <div className="office-mode space-mode">
          {/* 왼쪽 = 스페이스: 문서 + 지금 채팅 탭 참모가 잡고 있는 세션(터미널·보여 준 파일) — 2026-09-30 사용자, 리더는 터미널 뷰의 레거시 */}
          <SpaceView chat={chatCol} bubble={features.bubble ? { onHide: () => saveFeature('bubble', false) } : null} railTop={farMode.railTop} far={farMode.farView} team={{ rail: teamMode.rail, railOn: teamMode.railOn, on: teamMode.on, color: teamMode.color, onLeave: teamMode.leave, space: teamMode.space, add: teamMode.add, fold: teamMode.fold }} pet={features.tama ? petNode : undefined} office={features.office ? officeCol : undefined} officeReq={officeReq} onOfficeReq={() => setOfficeReq(null)} onOfficeShown={setSpaceOffice}
            harnitorReq={harnitorReq} onHarnitorReq={() => setHarnitorReq(null)} onHarnitorShown={setHarnitorOpen}
            onHarnitorClosed={() => { if (harnitorSwitched.current) { harnitorSwitched.current = false; setSpace(false); } }}
            toolsReq={toolsReq} onToolsReq={() => setToolsReq(null)} onToolsShown={setToolsOpen}
            reviewReq={reviewReq} onReviewReq={() => setReviewReq(null)} onReviewShown={setReviewOpen}
            replayReq={replayReq} onReplayReq={() => setReplayReq(null)} onReplayShown={setReplayOpen} replayPage={env ? () => <ReplayPage devRoot={env.devRoot} author={env.gitEmail} tasks={taskEvents} tama={tama.file} /> : undefined} computerUse={{ all: features.computerUse, setAll: (on) => saveFeature('computerUse', on) }}
            onToolsClosed={() => { if (toolsSwitched.current) { toolsSwitched.current = false; setSpace(false); } }} orch={spaceOrch} orchs={navOrchs} orchPins={orchPins} onReorderOrch={reorderOrchPanes} fns={(() => {
              // 기록·음성·도구·하니터·리뷰 — 채팅 뷰는 위 막대 대신 왼쪽 참모 패널(2026-10-11 사용자 180.png). 켜짐 판단은 위 막대와 같다(스페이스가 떠 있을 때 값)
              const fp: FeatureProps = { voice, onVoice: () => turnVoice(!voice), replayOn: replayOpen, onReplay: () => replayRef.current('toggle'), tools: toolsOpen, onTools: () => toolsRef.current('toggle'),
                harnitor: harnitorFloat || harnitorOpen, onHarnitor: () => harnitorRef.current('toggle'), review: { on: reviewOpen, confirm: reviewConfirm }, onReview: () => reviewRef.current('toggle') };
              const items = railItems(features);
              return { col: <FeatureRow items={items} p={fp} dir="col" />, row: <FeatureRow items={items} p={fp} dir="row" />, pop: <FeatureRow items={items} p={fp} dir="row" titles />, dot: items.includes('review') && reviewConfirm > 0 };
            })()} onMenuToggle={() => setSidebarOpen((o) => !o)} orchOrder={orchOrder} stoppingIds={[...closing.keys()]} startingOrchs={creating && !arrivedOrch(creating, navOrchs) ? [...startingOrchs, creatingRow(creating, env?.orchestratorCwd ?? '')] : startingOrchs} projectSessions={groups.projects.flatMap((p) => p.sessions)} menuOpen={sidebarOpen}
            orchHome={homeNode}
            homeDash={homeDashNode}
            idle={idleProjects.map((n) => ({ name: n, root: projectDir(n, env?.devRoot ?? '', env?.extraProjects ?? []) }))}
            stopped={resumable(stopped, sessions, pending)} orchCwd={env?.orchestratorCwd ?? ''}
            tasks={{ orphaned: splitCards(localCards, Date.now()).orphaned, known: knownSessions, canResume: (c) => !!orphanSession(c.target, stopped), onResume: resumeOrphan, onFinish: finishOrphan }}
            onResume={(x) => { markPending(x.sessionId); markResuming(x.sessionId); void resumeSession(x.cwd, x.sessionId, x.id).then(() => onMessage(null), (e: unknown) => onMessage(tr(`이어서 띄우기 실패: ${String(e)}`, `Resume failed: ${String(e)}`))); }} onWakeOrch={resumeFromHome}
            onChatTab={(id) => { setRemoteChat(null); focusedBy.current.set('orch-col', id); setChatTab(id); setFocusReq((r) => ({ key: 'orch-col', id, n: (r?.n ?? 0) + 1 })); }}
            helpers={groups.helpers}
            loose={groups.loose}
            ctxOf={ctxOf} onAddProject={config && env ? () => void addProjectFolder() : undefined}
            onRemoveStopped={(x) => { markPending(x.sessionId); void removeSession(x.id, `stopped-list ${x.name || x.id}`).then(() => refresh(), (e: unknown) => onMessage(tr(`지우기 실패: ${String(e)}`, `Remove failed: ${String(e)}`))); }}
            onNewOrch={env ? () => setNaming(true) : undefined}
            routines={routineItems} routinePage={routinePage}
            reviewPage={features.review ? (key, onKey, onOpen) => <ReviewPage data={review} sessions={sessions} stopped={stopped} taskEvents={taskEvents} selectedKey={key} onSelectKey={onKey} onOpenSession={onOpen} /> : undefined}
            onMessage={onMessage}
            onNewSession={(root, name) => void newSession(root, name).then(() => onMessage(null), (e: unknown) => onMessage(tr(`새 세션 실패: ${String(e)}`, `New session failed: ${String(e)}`)))}
            sessions={sessions} events={taskEvents} claudeBin={bin} fontSize={fontSize} home={env?.home} live={liveLines}
            onClose={() => setSpace(false)} onOpenSession={(id) => { setSpace(false); openTarget(id); }}
            sendTo={spaceOrch ? orchDisplay(spaceOrch) || assistant() : assistant()} send={async (text) => {
              if (!spaceOrch) throw new Error(tr(`${assistant()} 세션이 없어`, `No ${assistant()} session`));
              await sayTo(spaceOrch.id, text);
            }} />
        </div>
        </div>
      );
    } else if (view === 'grid' && office && features.office) {
      main = (
        <div className="office-mode">
          {officeCol((id) => { if (!orchIds.has(id)) openTarget(id); })}
          <div className="office-chats" style={{ flex: `0 0 ${chatWidth}px`, width: chatWidth, ['--chat-k' as string]: fontSize / DEFAULT_FONT }}>
            <Grip width={chatWidth} onWidth={setChatWidth} min={280} max={900} />
            <SessionGrid column sessions={groups.orchestrators} onReorder={reorderOrchPanes} claudeBin={bin} fontSize={fontSize} home={env?.home} titleOf={(s) => orchDisplay(s) || assistant()} subOf={(s) => orchRoleOf(s.name)?.text} {...gridFocus('orch-col')} onStop={(s, why) => closeSession(s, why)} layout={layoutOf('orch-col')} dispatch={dispatchFor('orch-col')} onMessage={onMessage} memo={memo} />
          </div>
        </div>
      );
    } else if (view === 'grid') {
      // 하나든 ⌘T로 여럿이든 프로젝트 화면처럼 격자로(크기 조절·크게·접기·메모 그대로)
      main = (
        <div className="orch">
          <div className="panes">
            <SessionGrid sessions={groups.orchestrators} onReorder={reorderOrchPanes} claudeBin={bin} fontSize={fontSize} home={env?.home} titleOf={(s) => orchDisplay(s) || assistant()} subOf={(s) => orchRoleOf(s.name)?.text} {...gridFocus('orch')} onStop={(s, why) => closeSession(s, why)} layout={layoutOf('orch')} dispatch={dispatchFor('orch')} onMessage={onMessage} memo={memo} />
          </div>
          {runningStrip}
        </div>
      );
    } else if (view === 'adopt' && o) {
      main = <div className="orch"><div className="panes"><AdoptCard session={o} title={assistant()} isOrchestrator onDone={onMessage} /></div>{runningStrip}</div>;
    } else if (showHome({ live: groups.orchestrators.length, picked: false })) {
      main = <div className="orch">{homeNode(goHere)}</div>;
    }
  } else if (selected.kind === 'tama') {
    main = <div className="pv-page">{petNode(petWho)}</div>;
  } else if (selected.kind === 'routine') {
    main = routinePage(selected.name, () => setSelected({ kind: 'orchestrator' }));
  } else if (selected.kind === 'review') {
    main = <ReviewPage data={review} sessions={sessions} stopped={stopped} taskEvents={taskEvents} selectedKey={selected.key} onSelectKey={(key) => setSelected({ kind: 'review', key })} onOpenSession={openTarget} />;
  } else if (selected.kind === 'helpers') {
    main = groups.helpers.length ? (
      <SessionGrid statusOf={statusOf} sessions={groups.helpers} claudeBin={bin} fontSize={fontSize} home={env?.home} titleOf={(s) => s.name} {...gridFocus('helpers')} onStop={(s, why) => closeSession(s, why)} layout={layoutOf('helpers')} dispatch={dispatchFor('helpers')} onMessage={onMessage} memo={memo} />
    ) : (
      <div className="empty"><b>{tr('도우미 세션이 없어요', 'No helper sessions')}</b></div>
    );
  } else if (selected.kind === 'loose') {
    main = groups.loose.length ? (
      <SessionGrid statusOf={statusOf} sessions={groups.loose} claudeBin={bin} fontSize={fontSize} home={env?.home} titleOf={(s) => s.name || s.id} {...gridFocus('loose')} onStop={(s, why) => closeSession(s, why)} layout={layoutOf('loose')} dispatch={dispatchFor('loose')} onMessage={onMessage} memo={memo} />
    ) : (
      <div className="empty"><b>{tr('프로젝트 밖 세션이 없어요', 'No sessions outside projects')}</b></div>
    );
  } else if (selected.kind === 'load') {
    main = <LoadPage sys={loadMon.sys} report={loadMon.report} onOpen={openTarget} onKilled={() => void loadMon.refresh()} />;
  } else if (selected.kind === 'replay') {
    main = env ? <ReplayPage devRoot={env.devRoot} author={env.gitEmail} tasks={taskEvents} tama={tama.file} /> : null;
  } else if (selected.kind === 'external') {
    // 예약 작업이 아무도 안 보는 곳에서 띄운 대화형 세션 — 앱에서 화면을 붙일 수 없다(대화형은 attach 가 안 된다). 무엇인지만 보여 준다
    const x = groups.external.find((e) => e.id === selected.id);
    const a = x?.sessionId ? activity[x.sessionId] : undefined;
    main = x ? (
      <div className="empty ext-sess">
        <b>{tr(`외부 예약 세션 — ${x.name || x.project}`, `Externally scheduled session — ${x.name || x.project}`)}</b>
        <p>{tr('사람이 연 터미널이 아니라 예약 작업(크론·launchd)이나 아무도 안 붙은 tmux 에서 뜬 Claude 예요. 대화형이라 앱에서 화면을 열 수는 없어요.', "This Claude was started by a scheduled job (cron, launchd) or in a tmux nobody is attached to, not in a terminal you opened. It's interactive, so the app can't open its screen.")}</p>
        <p>{tr('폴더', 'Folder')}: <code>{x.cwd}</code> · {tr('어디서', 'From')}: <code>{x.origin?.via}</code> · pid {x.pid}</p>
        {a?.prompt && <p>{tr('마지막 지시', 'Last prompt')}: {a.prompt.text}</p>}
        {a?.reply && <p>{tr('마지막 답', 'Last reply')}: {a.reply.text}</p>}
        <p>{tr('필요 없으면 그 예약 작업을 끄거나 프로젝트 밖(홈 폴더 등)에서 뜨게 바꾸세요. 참모에게 맡겨도 돼요.', 'If you do not need it, turn that scheduled job off or have it start outside your projects (e.g. your home folder). You can ask the chief of staff.')}</p>
      </div>
    ) : <div className="empty"><b>{tr('세션이 끝났어요', 'The session has ended')}</b></div>;
  } else if (selected.kind === 'all') {
    const all = groups.projects.flatMap((p) => p.sessions);
    main = all.length ? (
      <SessionGrid statusOf={statusOf} sessions={all} claudeBin={bin} fontSize={fontSize} home={env?.home} {...gridFocus('all')} onStop={(s, why) => closeSession(s, why)} layout={layoutOf('all')} dispatch={dispatchFor('all')} onMessage={onMessage} memo={memo} />
    ) : (
      <div className="empty"><b>{tr('돌고 있는 세션이 없어요', 'No running sessions')}</b></div>
    );
  } else {
    const group = groups.projects.find((p) => p.name === selected.name);
    const list = group?.sessions ?? [];
    const cwd = env ? projectDir(selected.name, env.devRoot, env.extraProjects) : '';
    main = (
      <>
        <ProjectBar project={selected.name} cwd={cwd} count={list.length} onDone={onMessage} needsHarness={needsHarness(docs.find((d) => d.name === selected.name))} />
        {list.length ? (
          <SessionGrid statusOf={statusOf} sessions={list} claudeBin={bin} fontSize={fontSize} home={env?.home} {...gridFocus(`p:${selected.name}`)} onStop={(s, why) => closeSession(s, why)} layout={layoutOf(`p:${selected.name}`)} dispatch={dispatchFor(`p:${selected.name}`)} onMessage={onMessage} memo={memo} />
        ) : (
          <div className="empty"><b>{tr('이 프로젝트엔 세션이 없어요', 'No sessions in this project')}</b></div>
        )}
        <StoppedStrip list={resumable(stopped, sessions, pending).filter((x) => x.project === selected.name)} onDone={onMessage} onPending={markPending} />
      </>
    );
  }

  // 채팅 뷰면 scripts/show 를 리더가 아니라 스페이스가 띄운다 — Rust 감시와 scripts/show 에 알린다(2026-09-30 사용자)
  useEffect(() => { void invoke('set_view_mode', { chat: spaceShown }).catch(() => {}); }, [spaceShown]);
  spaceShownRef.current = spaceShown;
  // 지금 보는 화면(viewNow) — 채팅 뷰면 어느 참모 탭인지(스페이스 쪽은 SpaceView 가), 터미널 뷰면 고른 칸·커서가 있는 세션.
  // 참모 훅이 지시마다 이 줄을 붙인다(2026-10-02 사용자 "내가 보는 화면을 니가 감지하느냐")
  useEffect(() => {
    const nameOf = (id?: string | null) => (id ? sessions.find((x) => x.id === id)?.name : undefined);
    if (spaceShown) reportView({ mode: tr('채팅 뷰', 'chat view'), focus: undefined }); // 탭·스페이스는 SpaceView 가(채팅 탭은 거기서 바로 바뀐다)
    else reportView({ mode: tr(`터미널 뷰 — ${selectionWord(selected)}`, `terminal view — ${selectionWord(selected)}`), tab: undefined, space: undefined, preview: undefined, harnitor: undefined, focus: nameOf(focused.current) });
  });
  // 앱 별명을 진짜 세션 이름에도(한 번씩) — 세션끼리 서로 누가 누군지 알게(2026-10-02 사용자)
  // 별명을 바꾸면(데스크톱 이름 바꾸기·폰 /api/rename) 바랄 진짜 이름 — 별명을 비우는 것(설정 이름으로)도 /rename 참모-N 이 필요해 별명과 따로 든다.
  // 진짜 이름이 같아지면 뺀다. 보내기는 아래 쉬는 때만(renamesToSend)
  const wantName = useRef<Record<string, string>>({});
  const [wantTick, setWantTick] = useState(0);
  const wantNick = (s: Session, nick: string) => { wantName.current[s.id] = withNick(s.name || assistant(), nick); setWantTick((n) => n + 1); };
  // 살아 있는 참모 둘이 같은 번호면(참모-3 둘) 늦게 켜진 쪽을 빈 번호로 /rename — 꺼진 참모 번호까지 피해서, 별명은 그대로(이상하면 앱 별명).
  // 2026-10-02 사고: 꺼진 사이 같은 번호로 새 참모가 생겼고, 데몬 재시작으로 둘이 같이 살아나 사이드바·프사·목소리가 하나로 합쳐졌다
  // 쉬는 세션에만 보내고, 보낸 뒤에도 같은 번호면 잠시 뒤 다시(domain/orchLabel renamesToSend — 첫 턴 중엔 되돌아갔다)
  const dupSent = useRef<RenameSent>({});
  useEffect(() => {
    const taken = stopped.filter((x) => samePath(x.cwd, env?.orchestratorCwd ?? '')).map((x) => x.name);
    const labels = Object.fromEntries(navOrchs.flatMap((o) => { const l = orchLabel(o.id); return l ? [[o.id, l]] : []; }));
    const idle = (id: string) => { const o = navOrchs.find((x) => x.id === id); return !!o && (o.state === 'idle' || (!!o.awaiting && !o.waitingFor)); };
    // 앱 별명을 진짜 이름에도(세션끼리 서로 누가 누군지 알게, 2026-10-02) — 번호 겹침 고치기가 먼저(같은 참모면 그쪽 이름에 별명이 이미 실림)
    for (const [id, to] of Object.entries(wantName.current)) if (navOrchs.find((o) => o.id === id)?.name === to || !navOrchs.some((o) => o.id === id)) delete wantName.current[id];
    const dup = dupRenames(navOrchs, taken, labels);
    const want = Object.entries(wantName.current).map(([id, to]) => ({ id, to }));
    const plan = [...dup, ...[...want, ...labelRenames(navOrchs, labels)].filter((x, i, all) => !dup.some((d) => d.id === x.id) && all.findIndex((y) => y.id === x.id) === i)];
    const { send, sent } = renamesToSend(plan, idle, dupSent.current, Date.now());
    dupSent.current = sent;
    for (const r of send) void sendTextToSession(r.id, `/rename ${r.to}`).catch(() => {});
  }, [navOrchs, stopped, env, labelMap, wantTick]);
  harnitorRef.current = (req) => {
    if (harnitorFloat) { if (req !== 'open') setHarnitorFloat(false); return; }
    if (spaceShown) { setHarnitorReq(req); return; }
    if (req === 'close') return;
    // 터미널 뷰에서 열면 채팅 뷰로 넘어가 지금 탭에 띄운다(오른쪽 참모 채팅을 보며 부탁하라고) — 닫으면 터미널 뷰로 돌아간다
    if (orchView(groups.orchestrators) === 'grid') { harnitorSwitched.current = true; setSpace(true); setSelected({ kind: 'orchestrator' }); setHarnitorReq('open'); return; }
    setToolsFloat(false);
    setHarnitorFloat(true);
  };
  toolsRef.current = (req) => {
    // 채팅 뷰로 넘어가면 떠 있는 창은 숨는다(스페이스 탭에 도구가 있다) — 숨은 창을 닫느라 스페이스 도구가 안 열리지 않게
    if (toolsFloat && !spaceShown) { if (req !== 'open') setToolsFloat(false); return; }
    if (toolsFloat) setToolsFloat(false);
    const way = toolsWay(orchView(groups.orchestrators), spaceShown);
    if (way === 'space') { setToolsReq(req); return; }
    if (req === 'close') return;
    // 채팅 뷰 스페이스는 참모가 없어도 뜬다(오케스트레이터 홈) — 터미널 뷰 'adopt'(붙인 세션 하나)만 스페이스가 없어 떠 있는 창으로
    if (way === 'float') { setHarnitorFloat(false); setToolsFloat(true); return; } // 같은 자리 — 하나만
    toolsSwitched.current = true; setSpace(true); setSelected({ kind: 'orchestrator' }); setToolsReq('open');
  };

  replayRef.current = (req) => {
    if (spaceShown) { setReplayReq(req); return; }
    // 채팅 뷰인데 스페이스 밖 화면(부하 등)이면 스페이스로 돌아가 연다 — 'adopt'(붙인 세션 하나)만 스페이스가 없어 터미널식 화면으로
    if (space && req !== 'close' && orchView(groups.orchestrators) !== 'adopt') { setSelected({ kind: 'orchestrator' }); setReplayReq('open'); return; }
    const on = selected.kind === 'replay';
    const want = req === 'toggle' ? !on : req === 'open';
    if (want === on) return;
    if (want) { replayBefore.current = selected; setSelected({ kind: 'replay' }); }
    else { setSelected(replayBefore.current ?? { kind: 'orchestrator' }); replayBefore.current = null; }
  };
  reviewRef.current = (req) => {
    if (spaceShown) { setReviewReq(req); return; }
    // 채팅 뷰인데 스페이스 밖 화면(리플레이·부하 등)이면 스페이스로 돌아가 연다 — 'adopt'(붙인 세션 하나)만 스페이스가 없어 터미널식 화면으로
    if (space && req !== 'close' && orchView(groups.orchestrators) !== 'adopt') { setSelected({ kind: 'orchestrator' }); setReviewReq('open'); return; }
    const on = selected.kind === 'review';
    const want = req === 'toggle' ? !on : req === 'open';
    if (want === on) return;
    if (want) { reviewBefore.current = selected; setSelected({ kind: 'review' }); }
    else { setSelected(reviewBefore.current ?? { kind: 'orchestrator' }); reviewBefore.current = null; }
  };

  const setup = config && (firstRun || settingsOpen) && (
    <Setup key={settingsStart ?? ''} config={config} firstRun={firstRun} fontSize={fontSize} start={settingsStart} tab={settingsTab} onClose={() => { setSettingsOpen(false); setSettingsStart(undefined); setSettingsTab(undefined); void getAppEnv().then(setEnv).catch(() => {}); /* 업데이트했으면 새 버전 번호로 */ }} />
  );
  if (firstRun) return setup;

  return (
    <OrchActionsProvider pins={orchPins} onPin={pinOrch} onNick={wantNick} onStop={(s, why) => closeSession(s, why)} onRemove={(id) => { markPending(stopped.find((x) => x.id === id)?.sessionId ?? id); void removeSession(id, `menu ${stopped.find((x) => x.id === id)?.name ?? ''}`).then(() => refresh(), (e: unknown) => setError(tr(`지우기 실패: ${String(e)}`, `Remove failed: ${String(e)}`))); }}>
      {consentAsk && <Confirm
        title={tr('확인 없이 실행하는 모드에 동의', 'Allow running without confirmations')}
        body={tr(`${assistant()}와 세션은 Claude Code 를 확인 없이 실행하는 모드(${SKIP_FLAG})로 돌려요. Claude Code 의 경고 그대로:\n· 위험할 수 있는 명령도 묻지 않고 실행해요.\n· Claude Code 는 인터넷이 제한되고 쉽게 되돌릴 수 있는 격리 환경(컨테이너·가상 머신)에서만 쓰라고 권해요.\n· 이 모드에서 생긴 일의 책임은 동의한 사람에게 있어요.\n${assistant()}에게는 결제·운영 앞에서 먼저 묻게 지시하지만, 완전히 막아 주지는 않아요. 동의하면 이 컴퓨터의 Claude Code 설정에 적혀서, 터미널에서 켜는 Claude Code 도 이 경고를 다시 띄우지 않아요.`,
          `${assistant()} and its sessions run Claude Code in Bypass Permissions mode (${SKIP_FLAG}). Claude Code's own warning:\n· Claude Code will not ask for your approval before running potentially dangerous commands.\n· This mode should only be used in a sandboxed container/VM that has restricted internet access and can easily be restored if damaged.\n· By proceeding, you accept all responsibility for actions taken while running in Bypass Permissions mode.\n${assistant()} is instructed to ask before payments and production changes, but that is not a guarantee. Agreeing records this in this computer's Claude Code settings, so Claude Code started from a terminal won't show this warning again either.`)}
        ok={tr('동의', 'Agree')}
        onCancel={() => setConsentAsk(null)}
        onOk={() => { const next = consentAsk; setConsentAsk(null); void bypassConsentAccept().then(next, (e: unknown) => setError(tr(`동의를 못 적었어요: ${String(e)}`, `Could not record the agreement: ${String(e)}`))); }} />}
      {naming && <NameNew baseName={nextOrchestratorName([...navOrchs, ...offOrchList].map((s) => s.name))} color={orchColor(nextOrchestratorName([...navOrchs, ...offOrchList].map((s) => s.name)))} check={(v) => nickProblem(v, [...navOrchs, ...offOrchList].map((x) => orchDisplay(x)))} onCancel={() => setNaming(false)} onMake={(v, role) => { setNaming(false); void spawnOrchestrator(v, role); }} />}
    <StopBridge to={askStopRef} />
    <div className="shell">
    {setup}
    {/* 로그인 필수(10-24) — 계정에 로그인 안 된 기기는 앱 위를 덮는다. 첫 실행 안내가 끝난 뒤에 */}
    {/* 팀 만들기·초대 팝업 — 띠 + 메뉴, 그리고 초대 링크(chammo://join)로 앱이 열렸을 때 어느 화면에서든(ADR 0015). 로그인 화면이 덮으면 그 뒤에 */}
    {teamMode.pop}
    {config && !settingsOpen && <LoginGate />}
    {tourOpen && <Tour none={navOrchs.length + offOrchList.length === 0} onClose={closeTour} />}
    {petModal && features.tama && <PetModal onClose={() => setPetModal(false)}>{petNode(petWho)}</PetModal>}
    {/* 세션 브라우저가 사람을 부르면(browser_ask_human) 어느 화면에서든 크게 띄우고 알린다 */}
    <AgentAskHost lives={agentLives} nameOf={(l) => askName(l, allSessions)} notify={(profile, reason, name, l) => {
      // 갈 곳 = 맡긴 참모 채팅의 그 부름 카드 — 예전엔 session:<프로필> 이라 폰에서 눌러도 못 갔다(2026-10-24 트레이더)
      const owner = askPlaced([l], allSessions, taskEvents, groups.orchestrators, groups.orchestrator, heirOf)[0]?.owner;
      notifyOnce({ kind: 'human', session: profile, orch: false, ...(owner ? { go: askTarget(owner.id, l) } : {}), ...askNotice(name, reason) });
    }}
      notifyPopup={(profile, name, kind) => notifyOnce({ kind: 'human', session: profile, orch: false, ...popupNotice(name, kind) })} onPopupCards={setPopupCards} />
    {licensesOpen && <LicensesDialog onClose={() => setLicensesOpen(false)} />}
    <CraftOpenAsk />
    {quitOpen && (() => {
      const mine = sessionsToStop(sessions, appRoots(env?.devRoot ?? '', env?.orchestratorCwd ?? '', env?.extraProjects ?? []));
      return (
        <QuitDialog running={mine.length} dock={quitOpen === 'dock'} onCancel={() => setQuitOpen(false)} onQuit={async (all) => {
          // 세션 끄기가 걸려도(claude stop 이 안 돌아옴) 15초 뒤엔 종료로 간다
          if (all) await Promise.race([Promise.allSettled(mine.map((x) => stopSession(x.id, `quit-all ${x.name}`))), new Promise((r) => setTimeout(r, 15_000))]);
          // 다음은 종료 창이 — Craft 저장(진행·건너뛰기) 뒤 app_exit
        }} />
      );
    })()}
    <TopBar claude={bin} fontSize={fontSize} load={loadMon.sys ? { level: level(loadMon.sys), load1: loadMon.sys.load1, cores: loadMon.sys.cores, swapGb: loadMon.sys.swapUsedMb / 1024 } : undefined} loadOn={selected.kind === 'load'} onLoad={() => setSelected({ kind: 'load' })} features={features} usage={barUsage} usageAge={acctUsage?.age ?? null} account={topLabel(accounts)} accounts={accounts} onSettings={() => setSettingsOpen(true)} today={today} tama={{ file: tama.file, widgetShown: tama.widgetShown, onToggle: () => widgetToggleRef.current() }} replayOn={spaceShown ? replayOpen : selected.kind === 'replay'} onReplay={() => replayRef.current('toggle')} reader={readerOpen} onReader={() => setReaderOpen((o) => !o)} office={space ? spaceOffice : office} onOffice={() => { if (space) { setSelected({ kind: 'orchestrator' }); setOfficeReq(spaceShown ? 'toggle' : 'open'); return; } setOffice(!office); setSelected({ kind: 'orchestrator' }); }} space={space} onView={(chat) => { setSpace(chat); setSelected({ kind: 'orchestrator' }); }} inboxCount={inbox.length + direct.inboxCards.length + remote.cards.length + loginCount + browserCount} onInbox={() => setInboxOpen((o) => !o)} harnitor={harnitorFloat || (spaceShown && harnitorOpen)} onHarnitor={() => harnitorRef.current('toggle')} tools={spaceShown ? toolsOpen : toolsFloat} onTools={() => toolsRef.current('toggle')} review={{ on: spaceShown ? reviewOpen : selected.kind === 'review', confirm: reviewConfirm }} onReview={() => reviewRef.current('toggle')} voice={voice} onVoice={() => turnVoice(!voice)} />
    <div className="app">
      {/* 채팅 뷰에선 세션 사이드바 대신 스페이스 메뉴(오케스트레이터·프로젝트 세션)가 ⌘B 자리 — 2026-09-30 사용자 */}
      {sidebarOpen && !spaceShown && <Sidebar
        statusOf={statusOf}
        routines={routineItems}
        orchestrator={groups.orchestrator}
        projects={groups.projects}
        selected={selected}
        onSelect={setSelected}
        onAddProject={config && env ? () => void addProjectFolder() : undefined}
        helpers={groups.helpers}
        loose={groups.loose}
        external={groups.external.map((x) => ({ id: x.id, name: x.name || x.project, line: tr(`외부 예약 · ${x.project} · ${x.origin?.via ?? ''}`, `External schedule · ${x.project} · ${x.origin?.via ?? ''}`) }))}
        footer={env ? `${env.claudeVersion || tr('claude 버전 확인 실패', 'Could not read the claude version')} · ${env.claudeBin}` : undefined}
        badges={badges}
        idleProjects={idleProjects}
        query={query}
        onQuery={setQuery}
        searchRef={searchRef}
        ctxOf={ctxOf}
      />}
      <div className="work">
      <div className="main">
        {/* 잠깐 떴다 사라지는 안내는 화면 위에 띄운다 — 줄로 끼면 세션을 띄우고 끌 때마다 화면 전체가 오르락내리락했다(2026-09-30 사용자) */}
        {(starting.length > 0 || closing.size > 0 || appNote) && (
          <div className="toasts">
            {appNote && <button className="banner quiet toast-go" onClick={() => { setAppNote(null); setInboxOpen(true); }}>{tr('참모 앱', 'Chammo')} · {appNote}</button>}
            {starting.length > 0 && <div className="banner quiet"><span className="spin" /> {tr('새 세션 띄우는 중', 'Starting new session')} · {starting.join(', ')}</div>}
            {closing.size > 0 && (
              <div className="banner quiet"><span className="spin" /> {tr('끄는 중', 'Stopping')} · {[...closing.values()].join(', ')} {tr('— 대화는 남아서 "꺼진 세션"에서 이어갈 수 있어', '— the conversation is kept; resume it from "Stopped sessions"')}</div>
            )}
          </div>
        )}
        {/* 새 버전 — 켜자마자·6시간마다 보고, 있으면 늘 띄운다(닫으면 그 버전만 안 띄움). 2026-10-01 사용자 */}
        {/* 업데이트 버튼 하나가 받기 → 설치 → 다시 켜기(ADR 0005). 안 되면(서명 불일치·업데이터 없는 판) 지금처럼 내려받기 링크 */}
        {updates.app && updDismissed !== `app:${updates.app.version}` && (
          <div className="banner warn">
            {appInstall.kind === 'get' || appInstall.kind === 'install' ? (
              <><span className="spin" /> <span>{tr(...installNote(appInstall, updates.app.version))}</span></>
            ) : appInstall.kind === 'failed' ? (
              <>
                <span>{tr(`자동 업데이트가 안 돼서 내려받는 곳을 열었어요. 받아서 설치해 주세요.`, `The automatic update didn't work, so the download page is open. Download and install it there.`)}</span>
                <IconButton size="l" tone="pri" label={tr('받기', 'Download')} title={tr(`받기 — Chammo ${updates.app.version} 내려받는 곳 열기`, `Download Chammo ${updates.app.version}`)} onClick={() => void openLink('url', updates.app!.url).catch(() => {})}><IconDownload /></IconButton>
              </>
            ) : (
              <>
                <span>{tr(`Chammo ${updates.app.version} 이 나왔어요 (지금 ${updates.appNow}). 업데이트하면 새 기능·고침이 들어가요.`, `Chammo ${updates.app.version} is out (you have ${updates.appNow}). Update to get the new features and fixes.`)}</span>
                <IconButton size="l" tone="pri" label={tr('업데이트', 'Update')} title={tr(`업데이트 — Chammo ${updates.app.version} 받아서 설치하고 다시 켜기`, `Update — download Chammo ${updates.app.version}, install and restart`)} onClick={() => { const url = updates.app!.url; void runInstall(appUpdateInstall, setAppInstall, () => openLink('url', url)); }}><IconUpdate /></IconButton>
              </>
            )}
            {appInstall.kind !== 'get' && appInstall.kind !== 'install' && (
              <IconButton label={tr('나중에', 'Later')} title={tr('나중에 — 이 버전은 다시 안 띄움', 'Later — skip this version')} onClick={() => setUpdDismissed(`app:${updates.app!.version}`)}><IconClose /></IconButton>
            )}
          </div>
        )}
        {/* 지난 Claude 업데이트(winget)가 중간에 끊겨 .old 만 남았던 걸 켤 때 되살렸다(2026-10-20 윈도우 시험 PC) */}
        {env?.claudeRestored && updDismissed !== `restored:${env.claudeRestored}` && (
          <div className="banner warn">
            <span>{tr(`Claude Code 업데이트가 중간에 끊겨 이전 판으로 되돌렸어요 (${verLabel(env.claudeVersion)}).`, `The Claude Code update was cut off, so the previous version was restored (${verLabel(env.claudeVersion)}).`)}</span>
            <IconButton label={tr('닫기', 'Close')} title={tr('닫기', 'Close')} onClick={() => setUpdDismissed(`restored:${env.claudeRestored}`)}><IconClose /></IconButton>
          </div>
        )}
        {updates.claude && updDismissed !== `claude:${updates.claude}` && (
          <div className="banner warn">
            <span>{tr(...claudeUpdateNote(updates.claude, env?.claudeVersion ?? ''))}</span>
            <button className="btn pri" onClick={() => { setSettingsStart('update'); setSettingsOpen(true); }}>{tr('업데이트', 'Update')}</button>
            <IconButton label={tr('나중에', 'Later')} title={tr('나중에 — 이 버전은 다시 안 띄움', 'Later — skip this version')} onClick={() => setUpdDismissed(`claude:${updates.claude}`)}><IconClose /></IconButton>
          </div>
        )}
        {env && !updates.claude && (() => {
          const w = versionWarning(env.claudeVersion, verDismissed);
          if (!w) return null;
          const v = env.claudeVersion.trim();
          const verShown = verLabel(v);
          return (
            <div className="banner warn">
              <span>{w === 'old'
                ? tr(`Claude Code ${verShown} 은 Chammo 가 기대는 기능보다 옛 버전이에요. 터미널에서 claude update 로 올려 주세요.`, `Claude Code ${verShown} is older than the features Chammo relies on. Please run claude update in a terminal.`)
                : tr(`Claude Code ${verShown} 은 아직 Chammo 에서 확인하지 않은 새 버전이에요. 대부분 잘 되지만, 이상하면 알려 주세요.`, `Claude Code ${verShown} is newer than what Chammo was tested with. It usually works — if something looks off, please let us know.`)}</span>
              <IconButton label={tr('닫기', 'Dismiss')} onClick={() => setVerDismissed(v)}><IconClose /></IconButton>
            </div>
          );
        })()}
        <AccessBanners access={access} copies={copies} home={env?.home ?? ''} accessDismissed={accessDismissed} copiesDismissed={copiesDismissed}
          onDismissAccess={setAccessDismissed} onDismissCopies={setCopiesDismissed} />
        {error && <div className="banner warn"><span>{error}</span><button className="ib" aria-label={tr('닫기', 'Dismiss')} title={tr('닫기', 'Dismiss')} onClick={() => setError(null)}><IconClose /></button></div>}
        {main}
      </div>
      {readerOpen && !spaceShown && <ReaderPanel width={readerWidth} onWidth={setReaderWidth} full={readerFull} onFull={() => setReaderFull((f) => !f)} onClose={() => setReaderOpen(false)} />}
      </div>
      {/* 작업 패널은 터미널 뷰에서만 — 채팅 뷰는 참모 대시보드가 같은 걸 보여 준다(2026-10-02 사용자 "채팅 뷰에선 필요 없다") */}
      {tasksOpen && !spaceShown && <TaskPanel width={tasksWidth} onWidth={setTasksWidth} cards={localCards} activities={activities} onOpen={openTarget}
        top={<>
          {features.review && <ReviewStrip data={review} onOpen={(key) => setSelected({ kind: 'review', key })} />}
        </>}
        onFinishMany={finishMany}
        orphanActions={(c) => <OrphanActions card={c} canResume={!!orphanSession(c.target, stopped)} onResume={resumeOrphan} onFinish={finishOrphan} />}
        bottom={allowLog.length > 0 && (
          <details className="allow-log">
            <summary className="tasks-sec fold">{tr('권한 창 자동 허용', 'Auto-allowed prompts')} <span className="tp-count">{allowLog.length}</span></summary>
            {allowLog.map((l, i) => (
              <div key={i} className="allow-row"><b>{l.where}</b> <span className="dim">{new Date(l.ts).toLocaleTimeString(getLang() === 'en' ? 'en-US' : 'ko-KR', { hour: '2-digit', minute: '2-digit' })}</span><br />{l.option ? `${l.option} → ` : ''}{l.result}</div>
            ))}
          </details>
        )} />}
    </div>
    {harnitorFloat && <HarnitorPanel float onClose={() => setHarnitorFloat(false)} />}
    {toolsFloat && !spaceShown && (() => {
      const hq = env?.orchestratorCwd ? [{ name: `${assistant()} HQ`, root: env.orchestratorCwd }] : [];
      const roots = [...hq, ...groups.projects.map((g) => ({ name: g.name, root: projectDir(g.name, env?.devRoot ?? '', env?.extraProjects ?? []) }))].filter((r, i, a) => r.root && a.findIndex((x) => x.root === r.root) === i);
      return <ToolsFloat root={groups.orchestrators[0]?.cwd || env?.orchestratorCwd || roots[0]?.root || ''} roots={roots} sessions={sessions}
        computerUse={{ all: features.computerUse, setAll: (on) => saveFeature('computerUse', on) }} onClose={() => setToolsFloat(false)} />;
    })()}
    <InboxPopover open={inboxOpen} onClose={() => setInboxOpen(false)} items={inbox} direct={direct.inboxNode || remote.node ? <>{direct.inboxNode}{remote.node}</> : null} directCount={direct.inboxCards.length + remote.cards.length} blockedWhy={(it) => replyBlocked(it, sessions)} onReply={replyItem} onOpen={openTarget} onDismiss={dismissItem} login={loginCount ? <>{login.need && <LoginCard need={login.need} claude={bin} fontSize={fontSize} />}<TermsCards cards={login.terms} onRetry={login.retryTerms} onClose={login.closeTerms} /></> : undefined} loginCount={loginCount} browser={browserNeeds.node || popupCards.length || askList.length ? <>{browserNeeds.node}<AskCards asks={askList} nameOf={(l) => askName(l, allSessions)} /><PopupCards lives={popupCards} nameOf={(l) => askName(l, allSessions)} /></> : undefined} browserCount={browserCount} />
    </div>
    </OrchActionsProvider>
  );
}

/** ⌘W(App 단축키)가 확인 창을 띄우게 — 확인 창은 OrchActionsProvider 안에 있다 */
function StopBridge({ to }: { to: React.MutableRefObject<((s: Session) => void) | null> }) {
  const a = useOrchActions();
  to.current = a ? (s) => a.askStop(s, undefined, 'cmd-w') : null;
  return null;
}

