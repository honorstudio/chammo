import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { closableByShortcut, groupByProject, isOrchestratorName, nextOrchestratorName, orchView, parseAgents, projectDir, sessionsToStop, withinRoots, type Session } from './domain/session';
import { pinFirst } from './domain/orchPins';
import { EMPTY_LAYOUT, gridKeyOf, layoutReducer, maxTarget, revealPane, type LayoutAction, type PaneLayout } from './domain/paneLayout';
import { accountsApi, readUsage, todayCommits, type RepoToday, sendTextToSession } from './data/tauri';
import { ACCOUNTS_CHANGED, topLabel, usageOf, type AccountsView } from './domain/accounts';
import { useAccountAuto } from './ui/useAccountAuto';
import { dayStart, parseUsage, type Usage } from './domain/usage';
import { TopBar } from './ui/TopBar';
import { HarnitorPanel } from './ui/HarnitorPanel';
import { reportView } from './ui/viewReport';
import { selectionWord } from './domain/viewNow';
import { Setup } from './ui/Setup';
import { Tour } from './ui/Tour';
import { QuitDialog } from './ui/QuitDialog';
import { RoutinePage } from './ui/RoutinePage';
import { isCloud, parseRoutines, routineItem, routineState, type Routine } from './domain/routine';
import { shouldShowTour } from './domain/tour';
import { useTama } from './ui/tama/useTama';
import { PetView } from './ui/tama/PetView';
import { keeperOf } from './domain/tama/signals';
import { orchColor } from './domain/avatar';
import { ReplayPage } from './ui/ReplayPage';
import { LoadPage } from './ui/LoadPage';
import { useLoad } from './ui/useLoad';
import { level } from './domain/load';
import { pickFolder, readConfig, reloadConfig, routineDo, routinesList, type Config } from './data/tauri';
import { allowed, featuresOf, mirrorPlan } from './domain/config';
import { addExtraProject, versionWarning } from './domain/setup';
import { claudeUpdateNote, verLabel } from './domain/updates';
import { useUpdates } from './ui/useUpdates';
import { SPACE_NAV } from './ui/space/navSignal';
import { picking } from './ui/chat/modelPickRun';
import { openTarget as openLink } from './data/tauri';
import { assistant, getLang, josa, tr } from './i18n';
import { getAppEnv, listSessionsAllRaw, listSessionsRaw, readSay, writeVoiceMode, speak, projectScan, readTasks, readTranscriptTails, spawnSession, type AppEnv } from './data/tauri';
import { freshReplies, parseSay, pickSay, type ReplySeen } from './domain/voice';
import { baseVoice, voiceFor } from './domain/avatar';
import { avatarSnapshot, setAvatarTts } from './ui/avatar';
import { blockedBody, readNoteTarget } from './domain/notify';
import { notifyOnce } from './ui/notifier';
import { AgentAskHost, browserMenu, browserOwnsKey, openAgentModal } from './ui/AgentBrowserModal';
import { useDirectCards } from './ui/useDirectCards';
import { kindView } from './domain/directAsk';
import { useAgentLives } from './ui/AgentBrowser';
import { askName, liveOf } from './domain/agentBrowser';
import { activityStatus, docBadges, needsHarness, transitions, type ActivityStatus, type ProjectDoc } from './domain/status';
import { summarizeTranscript, type Activity } from './domain/activity';
import { clampFont, DEFAULT_FONT, dedupeMs, gotoOfNum, menuAction, onceAcross, onceWithin, shortcutFor, type Shortcut } from './domain/shortcuts';
import { foldTasks, parseTaskLog, splitCards, type TaskEvent } from './domain/tasks';
import { TaskPanel, type SessionActivity } from './ui/TaskPanel';
import { invoke } from '@tauri-apps/api/core';
import { OrchActionsProvider, useOrchActions } from './ui/orchActions';
import { orchDisplay, orchLabel, setOrchLabel, setOrchRoster, useOrchLabels } from './ui/orchLabels';
import { NameNew } from './ui/OrchDialogs';
import { dupRenames, labelRenames, nickProblem, renamesToSend, withNick, type RenameSent } from './domain/orchLabel';
import { markReader, ReaderPanel, readerFocused } from './ui/reader/ReaderPanel';
import { selectAllHere } from './ui/selectAll';
import type { Surface } from './domain/reader';
import './ui/reader/reader.css';

/** 리더 패널에서 보던 탭 닫기 */
const previewMaxFn = () => (window as unknown as { __previewMax?: () => void }).__previewMax;
const previewZoomFn = () => (window as unknown as { __previewZoom?: (d: 1 | -1 | 0) => void }).__previewZoom;
const readerZoom = (dir: 1 | -1 | 0) => (window as unknown as { __readerZoom?: (d: 1 | -1 | 0) => void }).__readerZoom?.(dir);
const readerCloseActive = async () => { const st = await invoke<Surface>('reader_state', { surface: 'dock' }); if (st.active) await invoke('reader_close', { surface: 'dock', path: st.active }); };
import { Sidebar, type Selection } from './ui/Sidebar';
import { AdoptCard } from './ui/AdoptCard';
import { ProjectBar } from './ui/ProjectBar';
import { SessionGrid, type MemoHooks } from './ui/SessionGrid';
import { MemoPanel } from './ui/MemoPanel';
import { useLessons } from './ui/useLessons';
import { useMemos } from './ui/useMemos';
import { TerminalPane } from './ui/TerminalPane';
import { StoppedStrip } from './ui/StoppedStrip';
import { isRemoteTarget } from './domain/orphans';
import { allDue, singleFlight } from './domain/pollGate';
import { orphanSession, parseStopped, recentDelegated, resumable, stoppedOrchs, type StoppedSession } from './domain/stopped';
import { arrivedOrch, creatingRow } from './domain/orchRows';
import { inferRoles, parseRoles, roleHeir, type RoleMap } from './domain/orchRoles';
import { setOrchRoleData, saveOrchRole, orchRoleOf, onOrchRolesSaved } from './ui/orchRoleStore';
import { autoRestore, parseSnap, stepSnapshot, type LiveSnap, type SnapSession } from './domain/revive';
import { useLostTriage } from './ui/useLostTriage';
import { isHqOrch } from './domain/lostTriage';
import { parseSpawnOutput } from './domain/adopt';
import { OrphanActions } from './ui/Revive';
import { OfficeView } from './ui/office/OfficeView';
import { SpaceView } from './ui/space/SpaceView';
import { OrchHome } from './ui/space/OrchHome';
import { resumedOrch, showHome } from './domain/orchHome';
import { OfficeDock } from './ui/office/OfficeDock';
import { noteOf } from './domain/dock';
import { skinOf } from './ui/office/skins';
import { Shop } from './ui/gacha/Shop';
import { FurnitureTray } from './ui/office/FurniturePanel';
import { OfficeModal, OfficeTools, type OfficeTab } from './ui/office/OfficeMenu';
import { useGacha } from './ui/gacha/useGacha';
import { EMPTY_GACHA, ownedOf, ownedSkins } from './domain/gacha';
import { workAct } from './domain/activity';
import { canPlace, delivery, planRoom, seatSlots, stampSeen, withLounge, type Seat } from './domain/office';
import { spriteOf } from './ui/tama/lcd';
import { Grip } from './ui/TaskPanel';
import { IconClose, IconStack, IconTabs } from './ui/Icons';
import type { TaskCard } from './domain/tasks';
import { sessionOrigins } from './data/tauri';
import { appendTaskEvent, removeSession, daemonStartedAt, readOrchPins, setOrchPin, readOrchRoles, readLiveSnap, resumeSession, writeLiveSnap, newSession, readAutoAllow, readCtx, sendToSession, setBadge, stopSession, tamaWidget, writeClipboard } from './data/tauri';
import { parseAllowLog, type AllowLog } from './domain/autoAllow';
import { useAutoAllow } from './ui/useAutoAllow';
import { useForwardQuestions } from './ui/useForwardQuestions';
import { bornAfter, buildInbox, findTarget, freshItems, popoverOpen, replyBlocked, RESUME_MSG, type InboxItem } from './domain/inbox';
import { InboxPopover } from './ui/Inbox';
import { ctxAlerts, parseCtx, type Ctx } from './domain/ctx';
import { useReview } from './ui/useReview';
import { ReviewPage } from './ui/ReviewPage';
import { ReviewStrip } from './ui/ReviewStrip';
import { splitOpen } from './domain/reviewSummary';
import { focusPlan, intentOf, openShortcut, withFeature } from './domain/appctl';
import { rebuildMenu, writeConfig } from './data/tauri';
import { useSpeakGlowPoll } from './ui/speakGlow';
import { attachCommand } from './domain/termCommand';

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

export default function App() {
  const [env, setEnv] = useState<AppEnv | null>(null);
  const updates = useUpdates(env?.claudeVersion);
  // 설정(config.json) — 못 읽은 동안엔 기능을 다 켠 것으로(featuresOf)
  const [config, setConfig] = useState<Config | null>(null);
  // 참모 목소리 — 설정 음성 명령을 프사 저장소에 알린다(고르기 창·참모 답 읽기가 쓴다)
  useEffect(() => { if (config) setAvatarTts(config.ttsCommand); }, [config]);
  const features = featuresOf(config);
  const featuresRef = useRef(features);
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
  const [quitOpen, setQuitOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const toolsSwitched = useRef(false);
  const toolsRef = useRef<(req: 'open' | 'close' | 'toggle') => void>(() => {});
  const [settingsStart, setSettingsStart] = useState<'update' | undefined>();
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
    const t = setInterval(pullRoutines, 5000);
    return () => clearInterval(t);
  }, [pullRoutines]);
  const [error, setError] = useState<string | null>(null);
  // 목록 읽기가 낸 오류만 목록 읽기가 지운다 — 예전엔 폴링이 성공할 때마다 지워서 참모 띄우기 실패 같은 오류가 몇 초 만에 사라졌다(2026-10-03 QA 2번)
  const listFailed = useRef(false);
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
  const [officeSkin, setOfficeSkin] = useState<string>(() => load('officeSkin', 'wood'));
  useEffect(() => save('officeSkin', officeSkin), [officeSkin]);
  // 사무실 앞줄 자리표 — 한 번 앉은 세션은 그 자리 그대로(domain/office seatSlots)
  const [seats, setSeats] = useState<(string | null)[]>(() => load('officeSeats', []));
  useEffect(() => save('officeSeats', seats), [seats]);
  const seenSends = useRef(new Map<string, number>()); // 배달 연출: send 를 처음 본 시각(domain/office stampSeen)
  // 스페이스 모드: 참모 화면 = [리더][참모 채팅 — 쌓기/탭] (2026-09-30 사용자, Chammo 0.2.0 방향)
  const [space, setSpace] = useState<boolean>(() => load('spaceMode', true)); // 기본 켬(2026-09-30 사용자)
  const labelMap = useOrchLabels(); // 참모 별명이 바뀌면 탭·메뉴 이름을 다시 그린다
  useEffect(() => save('spaceMode', space), [space]);
  const [chatView, setChatView] = useState<'stack' | 'tabs'>(() => load('spaceChatView', 'stack'));
  useEffect(() => save('spaceChatView', chatView), [chatView]);
  const [chatWidth, setChatWidth] = useState<number>(() => load('officeChatWidth', 420));
  useEffect(() => save('officeChatWidth', chatWidth), [chatWidth]);
  const [inboxOpen, setInboxOpen] = useState(false);
  // Claude Code 버전이 확인된 범위(2.1.28x) 밖이면 경고 한 줄 — 막지는 않는다. 닫으면 그 버전은 다시 안 띄운다
  const [verDismissed, setVerDismissed] = useState<string | null>(() => load('claudeVersionDismissed', null));
  const [updDismissed, setUpdDismissed] = useState<string | null>(() => load('updateDismissed', null));
  useEffect(() => save('updateDismissed', updDismissed), [updDismissed]);
  useEffect(() => save('claudeVersionDismissed', verDismissed), [verDismissed]);
  // 음성 모드: 참모가 답을 마치면 참모세이로 읽는다(누워 있을 때). 켜 둔 건 다음에 켜도 남는다
  const [voice, setVoice] = useState<boolean>(() => load('voiceMode', false));
  useSpeakGlowPoll(voice); // 음성 모드면 지금 말하는 참모를 빛낸다
  useEffect(() => { save('voiceMode', voice); void writeVoiceMode(voice).catch(() => {}); }, [voice]);
  const voiceRef = useRef(voice);
  voiceRef.current = voice && features.voice;
  // 상단 바 스피커 버튼·참모 scripts/app 이 같이 쓴다 — 켤 때 한마디
  const turnVoice = (on: boolean) => setVoice((v) => { if (on && !v) void speak(tr(`음성 모드 켰어. ${assistant()}가 답하면 읽어줄게`, `Voice mode on. I will read ${assistant()}'s replies aloud`)).catch(() => {}); return on; });
  const [memoOpen, setMemoOpen] = useState<string | null>(null); // 메모판을 띄운 창(세션 id)
  const prevInbox = useRef<Set<string> | null>(null);
  const [taskEvents, setTaskEvents] = useState<TaskEvent[]>([]);
  const [activity, setActivity] = useState<Record<string, Activity>>({});
  const [docs, setDocs] = useState<ProjectDoc[]>([]);
  const [stopped, setStopped] = useState<StoppedSession[]>([]);
  // 꺼진 세션 목록을 한 번이라도 읽었나 — 첫 참모 자동 시작이 빈 목록을 보고 '이어 켤 게 없다'로 판단하지 않게(snapReady 는 그보다 먼저 켜진다)
  const [stoppedReady, setStoppedReady] = useState(false);
  // 살아 있는 세션 기록(live.json) — undefined = 아직 파일을 안 읽음. 관리 프로그램 재시작으로 꺼진 세션을 찾는다(domain/revive)
  const snapRef = useRef<LiveSnap | null | undefined>(undefined);
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
  // 화면(격자)마다 마지막으로 누른 창 — ⌘1·⌘2 로 오가도 그 창이 바로 입력을 받게. activeGrid = 지금 보이는 격자(⌘₩ 대상)
  const focusedBy = useRef(new Map<string, string>());
  const activeGrid = useRef<string | null>(null);
  // "그 세션으로 가기"(알림·작업 패널·결정 대기함) — n 이 바뀔 때마다 그 격자가 그 창에 포커스를 준다
  const [focusReq, setFocusReq] = useState<{ key: string; id: string; n: number } | null>(null);
  const gridFocus = (key: string) => {
    activeGrid.current = key;
    return { gridId: key, initialFocus: focusedBy.current.get(key), focusRequest: focusReq?.key === key ? focusReq : undefined, onFocusSession: (id: string) => {
      focused.current = id; focusedBy.current.set(key, id);
      // 채팅 탭(참모)이 바뀌면 바로 다시 그린다 — 참조만 바꾸면 스페이스가 몇 초 뒤 갱신 때 따라와서 빨리 옮기면 안 바뀌었다(2026-09-30 사용자)
      if (key === 'orch-col') setChatTab((t) => (t === id ? t : id));
    } };
  };
  const [, setChatTab] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState<string[]>([]); // ⌘T로 띄우는 중인 세션 이름 — claude --bg 가 1초 남짓 걸린다
  // 끄는 중인 세션: claude stop 이 0.7초쯤 걸린다(실측) — 누르는 순간 화면에서 먼저 치우고 뒤에서 끈다
  const [closing, setClosing] = useState<Map<string, string>>(new Map());
  const closeSession = (s: Session) => {
    const label = s.workspace ? `${s.project} / ${s.workspace}` : s.project;
    setClosing((m) => new Map(m).set(s.id, label));
    if (focused.current === s.id) focused.current = null;
    void stopSession(s.id)
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
  const seenReplies = useRef<ReplySeen | null>(null); // 참모 답 중 이미 읽은(또는 처음 보고 넘긴) 것
  const spokenSay = useRef<Record<string, string>>({});
  const appStartedAt = useRef(new Date().toISOString()); // 세션 id → 이미 읽은 scripts/say 말의 마지막 ts(domain/voice pickSay)
  useEffect(() => save('fontSize', fontSize), [fontSize]);
  useEffect(() => save('sidebarOpen', sidebarOpen), [sidebarOpen]);
  useEffect(() => save('tasksOpen', tasksOpen), [tasksOpen]);

  // 단축키 = 메뉴바 항목과 같은 동작. 창 전체에서 capture 로 먼저 받는다 — 터미널(xterm)보다 앞에서 가로채야 Claude 입력칸에 안 들어간다.
  // 메뉴(Rust main.rs)에도 같은 단축키가 걸려 있어서 둘 다 올 수 있다 → 잠깐 사이(dedupeMs)의 같은 동작은 한 번만
  const runRef = useRef<(sc: Shortcut) => void>(() => {});
  runRef.current = (sc: Shortcut) => {
    // ⌘1~9: 스페이스면 채팅 탭 N번(참모 화면으로 가서), 아니면 예전 화면 이동(⌘1~4) — 2026-09-30 사용자
    if (sc.type === 'num') {
      if (!space) { const g = gotoOfNum(sc.n); if (g) runRef.current(g); return; }
      const o = groups.orchestrators[sc.n - 1];
      if (!o) return;
      setSelected({ kind: 'orchestrator' });
      setFocusReq((r) => ({ key: 'orch-col', id: o.id, n: (r?.n ?? 0) + 1 }));
      return;
    }
    if (!allowed(sc, featuresRef.current)) return; // 꺼 둔 기능(사무실·다마고치·리뷰)의 입구
    // ⌘1 = 참모 터미널 격자(사무실 끔) · ⌘4 = 사무실 뷰(사무실 켬) · ⌘3 = 리뷰 (2026-09-27 사용자)
    if (sc.type === 'goto') {
      if (sc.to === 'tama') { openPetRef.current(); return; } // 도감·보관함 = 돌보는 참모 대시보드의 펫 탭
      // 채팅 뷰면 스페이스 칸에 사무실(지금 탭) — 터미널 뷰로 넘어가지 않는다(2026-10-03 사용자 A)
      if (sc.to === 'office' && spaceShownRef.current) { setOfficeTab('office'); setOfficeReq('open'); }
      else if (sc.to === 'office') { setOffice(true); setOfficeTab('office'); setSelected({ kind: 'orchestrator' }); }
      else { if (sc.to === 'orchestrator') setOffice(false); setSelected({ kind: sc.to }); }
    }
    // 미리보기 모달이 떠 있으면 ⌘+ ⌘- ⌘0 은 모달만(2026-09-30 사용자 "리더처럼")
    else if ((sc.type === 'font' || sc.type === 'fontReset') && previewZoomFn()) previewZoomFn()!(sc.type === 'fontReset' ? 0 : sc.delta);
    // 리더를 보고 있으면 ⌘+ ⌘- ⌘0 은 리더만 — 터미널 글자는 그대로(사용자 2026-09-29)
    else if ((sc.type === 'font' || sc.type === 'fontReset') && readerOpen && readerFocused()) readerZoom(sc.type === 'fontReset' ? 0 : sc.delta);
    else if (sc.type === 'font') setFontSize((f) => clampFont(f + sc.delta));
    else if (sc.type === 'fontReset') setFontSize(DEFAULT_FONT);
    else if (sc.type === 'selectAll') selectAllHere(readerOpen && readerFocused(), document.querySelector('.reader-panel'));
    else if (sc.type === 'toggleSidebar') setSidebarOpen((o) => !o);
    else if (sc.type === 'toggleTasks') setTasksOpen((o) => !o);
    else if (sc.type === 'search' && (window as unknown as { __docFind?: () => void }).__docFind) (window as unknown as { __docFind: () => void }).__docFind(); // 문서가 열려 있으면 문서 찾기
    else if (sc.type === 'search') {
      setSidebarOpen(true);
      setTimeout(() => searchRef.current?.focus(), 0);
    } else if (sc.type === 'closePane') {
      // 리더를 보고 있으면 ⌘W 는 탭 닫기(세션 끄기 아님)
      if (readerFocused()) void readerCloseActive();
      else closePaneRef.current();
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
    else if (sc.type === 'quitAsk') setQuitOpen(true);
    // 미리보기 모달이 떠 있으면 ⌘` 는 모달을 스페이스 가득으로(2026-09-30 사용자)
    else if (sc.type === 'maximizePane' && previewMaxFn()) previewMaxFn()!();
    else if (sc.type === 'maximizePane' && readerOpen && readerFocused()) setReaderFull((f) => !f); // 리더를 보고 있으면 리더를 크게·작게(사용자: 보고 있는 곳 기준)
    else if (sc.type === 'maximizePane') {
      // ⌘₩ — 지금 보이는 격자에서 마지막으로 누른 창을 크게, 이미 크면 되돌리기(포커스는 SessionGrid 가 그 창에 돌려준다)
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
    else if (sc.type === 'newSession') newSessionRef.current();
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
    const w = window as unknown as { __menu?: (id: string) => void };
    w.__menu = (id) => { if (browserMenu(id)) return; const sc = menuAction(id); if (sc) run(sc, 'menu'); };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); delete w.__menu; };
  }, []);
  const widgetToggleRef = useRef<() => void>(() => {});
  // 화면(프로젝트 이름 / 'all')마다 따로 기억한다 — 프로젝트를 오가도 크게·접기가 유지되게
  const [layouts, setLayouts] = useState<Record<string, PaneLayout>>({});
  const layoutOf = (key: string) => layouts[key] ?? EMPTY_LAYOUT;
  const dispatchFor = (key: string) => (a: LayoutAction) =>
    setLayouts((m) => ({ ...m, [key]: layoutReducer(m[key] ?? EMPTY_LAYOUT, a) }));

  // 따로 추가한 프로젝트 폴더가 바뀌면(설정 화면·참모 scripts/app project) 환경을 다시 읽는다 — 세션 판별·스캔이 새 폴더를 보게
  const extrasKey = JSON.stringify(config?.extraProjects ?? []);
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
      const live = withinRoots(everyone, [env.devRoot, env.orchestratorCwd, ...env.extraProjects]);
      setSessions(live);
      // 재시작 감지가 실패해도 세션 목록은 살린다 — 따로 잡는다
      try {
        if (snapRef.current === undefined) snapRef.current = parseSnap(await readLiveSnap());
        // 시작 시각을 먼저 받고 기록을 읽는다 — 기다리는 사이 꺼진 세션 처리(useLostTriage)가 지운 걸 옛 기록으로 되살리지 않게
        const daemon = await daemonStartedAt();
        const snap = stepSnapshot(snapRef.current, daemon, live, Date.now());
        if (snap && JSON.stringify(snap) !== JSON.stringify(snapRef.current)) void writeLiveSnap(JSON.stringify(snap)).catch(() => {});
        snapRef.current = snap;
        setLost(snap?.lost ?? []);
        setSnapReady(true);
      } catch {
        // 다음 폴링에서 다시
      }
      setTaskEvents(parseTaskLog(await readTasks()));
      const liveIds = live.map((x) => x.sessionId ?? x.id);
      if (allDue({ lastAt: allAt.current, now: Date.now(), force, prevLive: prevLive.current, live: liveIds })) {
        setStopped(withinRoots(parseStopped(await listSessionsAllRaw(), env.devRoot, env.extraProjects), [env.devRoot, env.orchestratorCwd, ...env.extraProjects]));
        allAt.current = Date.now();
        setStoppedReady(true);
      }
      prevLive.current = liveIds;
      setCtx(parseCtx(await readCtx()));
      if (listFailed.current) { listFailed.current = false; setError(null); }
    } catch (e: unknown) {
      // 옛 claude(--json 없음)나 로그인 풀림이 여기로 온다 — 숨기지 않고 배너로
      listFailed.current = true;
      setError(tr(`세션 목록 실패: ${String(e)}`, `Could not list sessions: ${String(e)}`));
    }
  }, [env]);
  // 앞 차례가 안 끝났으면 겹쳐 부르지 않는다 — 맥이 바쁘면 agents 한 번이 3초를 넘겨 쌓였다. 폴링은 버리고, 사람이 부른 것(refresh)은 끝난 뒤 한 번 더
  const gate = useMemo(() => singleFlight(refreshOnce), [refreshOnce]);
  const refresh = useCallback(() => gate(true), [gate]);

  useEffect(() => {
    if (!env || firstRun) return; // 첫 실행 안내 중엔 claude 가 아직 없을 수 있다 — 끝나면 창을 다시 연다
    void gate(true);
    const t = setInterval(() => void gate(false), POLL_MS);
    return () => clearInterval(t);
  }, [env, gate, firstRun]);

  // 리뷰: 열린 PR·오늘 머지된 PR(gh, 2분마다). 리뷰 화면을 열면 30초 넘게 묵은 경우 바로 다시 읽는다
  const review = useReview(features.review ? env : null, () => void refresh());
  const reviewConfirm = splitOpen(review.open, review.later, Date.now()).confirm.length;
  useEffect(() => {
    if (selected.kind === 'review' && (!review.scannedAt || Date.now() - review.scannedAt > 30_000)) review.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.kind]);

  // 세션 현황: 대화 기록 꼬리는 무거우니 세션 목록(3초)보다 느리게 10초마다.
  // 패널을 닫아도 읽는다 — 결정 대기·알림이 이걸로 판단하는데, 닫으면 안 읽어서 결정을 놓쳤다(2026-09-27 사용자). 명령은 뒤에서 돌아 화면은 안 막는다
  useEffect(() => {
    const tick = async () => {
      const ids = sessions.map((s) => s.sessionId).filter((x): x is string => !!x);
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
  }, [sessions.map((s) => s.sessionId).join(',')]);

  // 프로젝트 문서 상태: git 을 30번 넘게 부르니 5분마다
  useEffect(() => {
    if (!env) return;
    const scan = () => projectScan(env.devRoot).then(setDocs).catch(() => {});
    void scan();
    const t = setInterval(scan, 5 * 60_000);
    return () => clearInterval(t);
  }, [env]);

  // 상단 바: 사용 한도는 상태줄이 갱신할 때마다 바뀌니 15초, 오늘 커밋은 git 을 저장소마다 부르니 1분
  useEffect(() => {
    if (!env) return;
    // 지금 계정은 ~/.claude.json 만 읽어서 싸다 — 사용량과 같이, 설정에서 바꾸면 바로
    const a = () => accountsApi.view().then(setAccounts).catch(() => setAccounts(null));
    const u = () => { void a(); return readUsage().then((j) => setUsage(parseUsage(j, Date.now()))).catch(() => {}); };
    const c = () => todayCommits(env.devRoot, env.gitEmail, dayStart(new Date())).then(setToday).catch(() => {});
    void u();
    void c();
    const t1 = setInterval(u, 15_000);
    const t2 = setInterval(c, 60_000);
    window.addEventListener(ACCOUNTS_CHANGED, a);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
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
    const t = window.setInterval(load, 5000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  const pinOrch = (s: Session, on: boolean) => { if (s.sessionId) void setOrchPin(s.sessionId, on).then(setOrchPins, (e: unknown) => setError(tr(`고정 실패: ${String(e)}`, `Pin failed: ${String(e)}`))); };
  const groups = useMemo(() => {
    const g = groupByProject(visibleSessions, env?.orchestratorCwd ?? '');
    return { ...g, orchestrators: pinFirst(g.orchestrators, orchPins, (s) => s.sessionId) };
  }, [visibleSessions, env, orchPins]);
  // 사이드바 오케스트레이터 칸은 끄는 중인 참모도 그대로 둔다(줄·순서 색 유지, 상태만 '끄는 중') — domain/orchRows
  const navOrchs = useMemo(() => pinFirst(groupByProject(sessions, env?.orchestratorCwd ?? '').orchestrators, orchPins, (s) => s.sessionId), [sessions, env, orchPins]);
  // 화면 이름이 겹칠 때만 꼬리 — 같이 보이는 참모(살아 있는 + 꺼진)를 알린다(ui/orchLabels orchDisplay)
  useEffect(() => {
    const off = stoppedOrchs(resumable(stopped, sessions), env?.orchestratorCwd ?? '', navOrchs);
    setOrchRoster([...navOrchs, ...off].map((x) => ({ id: x.id, name: x.name })));
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
    const t = window.setInterval(load, 5000);
    const off = onOrchRolesSaved((m) => setOrchRoles(m));
    return () => { alive = false; window.clearInterval(t); off(); };
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
  /** nick 이 있으면 '참모-N · 별명'(N 은 꺼진 참모 번호까지 피해서), 없으면 첫 참모 이름(설정 이름) — 자동 시작·빈 화면 버튼 */
  const spawnOrchestrator = async (nick?: string, role = '') => {
    if (!env || spawningRef.current) return; // + 를 연달아 눌러도 하나만(띄우는 데 1초 남짓)
    spawningRef.current = true;
    setSpawning(true);
    try {
      const name = nick ? withNick(nextOrchestratorName([...navOrchs, ...offOrchList].map((s) => s.name)), nick) : nextOrchestratorName(groups.orchestrators.map((s) => s.name));
      if (nick) setCreating(name);
      // 맡은 일·태어난 때를 먼저 적는다 — 꺼진 참모를 지워 번호가 다시 쓰이면 옛 맡은 일·기록이 새 참모에 붙었다(2026-10-04 QA ⑥·리뷰)
      await saveOrchRole(name, role, true).catch(() => {});
      await spawnSession(env.orchestratorCwd, name, tr('준비만 해 둬 — 답은 "준비됐어" 한 줄로, 묻지 말고 다음 지시를 기다려.', 'Just get ready — reply "Ready." in one line, ask nothing, and wait for the next instruction.') /* 첫 인사를 '뭐부터 할까?'로 물어 결정 대기 창이 채팅을 덮었다(2026-09-30 시험) */);
      await refresh();
    } catch (e: unknown) {
      setError(tr(`${assistant()} 띄우기 실패: ${String(e)}`, `Could not start ${assistant()}: ${String(e)}`));
      setCreating(null);
    } finally {
      spawningRef.current = false;
      setSpawning(false);
    }
  };
  const spawningRef = useRef(false);

  // 다마고치: 1분마다 작업 기록을 먹여 tama.json 에 쓴다(위젯 창은 읽기만)
  const openPetRef = useRef(() => {});
  const tama = useTama(env, sessions, taskEvents, routines, navOrchs, (k) => { if (k === 'dex' || k === 'pet') openPetRef.current(); });
  // 펫 = 참모가 키운다(시안 tama-v2 B) — 더보기·도감은 돌보는 참모(마지막으로 먹인 참모) 대시보드의 펫 탭
  const [petReq, setPetReq] = useState<{ id: string; n: number } | null>(null);
  const petWho = (id: string) => { const o = navOrchs.find((x) => x.id === id); return o ? { name: o.name, color: orchColor(o.name) } : null; };
  // 펫 탭 코인 = 사무실과 같은 상점 창(뽑기·도감·스킨) — 펫 탭에서 뽑아도 뽑은 걸 바로 본다
  const shopSkins = () => { const owned = ownedSkins(gacha.file ?? EMPTY_GACHA); return { owned, current: owned.includes(officeSkin) ? officeSkin : 'wood', onSkin: setOfficeSkin }; };
  const petNode = (who: typeof petWho) => <PetView file={tama.file} apply={tama.apply} feed={tama.feed} who={who} coins={features.gacha ? gacha.file?.coins ?? 0 : undefined}
    shop={features.gacha ? (view, onView, close) => <Shop view={view} onView={onView} file={gacha.file} draw={gacha.draw} equip={(id) => void gacha.equip(id)} skins={shopSkins()} onClose={close} /> : undefined} />;
  const gacha = useGacha(env, tama.feed);
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
  const RANK: Record<ActivityStatus, number> = { asks: 0, blocked: 0, working: 1, done: 2, idle: 3, stale: 4 };
  const now = Date.now();
  const activities: SessionActivity[] = groups.projects
    .flatMap((p) => p.sessions)
    .map((s) => {
      const a = (s.sessionId && activity[s.sessionId]) || {};
      return { session: s, activity: a, status: activityStatus(s.state, a, now) };
    })
    .sort((a, b) => {
      if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] - RANK[b.status];
      const ta = a.activity.reply?.ts ?? a.activity.prompt?.ts ?? '';
      const tb = b.activity.reply?.ts ?? b.activity.prompt?.ts ?? '';
      return ta < tb ? 1 : ta > tb ? -1 : 0;
    });
  // 참모 세션까지 — 결정 대기·알림·인계는 참모도 본다(작업 패널 목록은 하위 세션만)
  const orchActs: SessionActivity[] = groups.orchestrators.map((s) => {
    const a = (s.sessionId && activity[s.sessionId]) || {};
    return { session: s, activity: a, status: activityStatus(s.state, a, now) };
  });
  const allActs = [...orchActs, ...activities];
  // 도우미·프로젝트 밖 세션 — 대시보드 '지금 하는 일' 줄에만(결정 대기함·알림 범위는 그대로). 빠져 있어서 일하는 도우미가 '쉼'으로 보였다(2026-10-02 사용자)
  const sideActs: SessionActivity[] = [...groups.helpers, ...groups.loose].map((s) => {
    const a = (s.sessionId && activity[s.sessionId]) || {};
    return { session: s, activity: a, status: activityStatus(s.state, a, now) };
  });
  // 계정 자동 전환 — 계정 보기가 15초마다 새로 올 때 한 번씩(한도로 멈춘 세션은 참모·하위·도우미 다)
  useAccountAuto(accounts, [...allActs, ...sideActs], voice && features.voice);
  // 위 막대 사용량 — 지금 계정 칸 기록(계정 토큰으로 물은 값)이 있으면 그걸로: 계정을 바꾸면 세션 대화 없이도 바로 바뀐다. 없으면 상태줄 값
  const acctUsage = usageOf(accounts, now);
  const barUsage = acctUsage?.usage ?? usage;
  const orchIds = new Set(groups.orchestrators.map((s) => s.id));
  const orchKey = orchActs.map((x) => `${x.session.id}:${x.status}:${x.session.state}:${x.activity.reply?.ts}:${x.activity.reply?.midTurn}`).join(',');
  const badges = useMemo(() => Object.fromEntries(docs.map((d) => [d.name, docBadges(d)])), [docs]);
  const running = new Set(groups.projects.map((p) => p.name));
  const idleProjects = docs.map((d) => d.name).filter((n) => !running.has(n) && n !== env?.orchestratorCwd.split('/').pop());
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
    prevStatus.current = next;
    // 참모가 새로 마친 답 — 답 ts 로 한 번만(상태 바뀜으로 보면 10초 늦은 대화 기록 탓에 옛 답을 또 읽었다, domain/voice)
    const r = freshReplies(seenReplies.current, orchActs.map((x) => ({ id: x.session.id, state: x.session.state, activity: x.activity })));
    seenReplies.current = r.seen;
    for (const f of r.fresh) {
      const x = orchActs.find((a) => a.session.id === f.id)!;
      const s = x.session;
      // 참모가 음성용 말을 따로 넘겼으면(scripts/say) 그걸, 아니면 답 앞부분 + 끝 질문
      if (voiceRef.current) void readSay().catch(() => '').then((log) => {
        // 앱을 켜기 전에 넘긴 말은 안 읽는다 — 켤 때마다 '이미 읽은 말' 기억이 비어 옛 말을 몰아 읽었다
        const since = [x.activity.prompt?.ts ?? '', appStartedAt.current].sort().pop()!;
        const p = pickSay(parseSay(log), [s.id, s.sessionId], since, spokenSay.current[s.id]);
        if (p) spokenSay.current[s.id] = p.last; // 읽은 말은 다음 답에서 다시 안 읽는다
        return p?.text ?? f.reply.say;
      }).then((t) => {
        if (!t) return undefined;
        // 그 참모 목소리로(프로필 voice, 없으면 번호 순 기본 배정) — 설정이 Supertonic 실행기가 아니면 Rust 가 설정 그대로 읽는다
        const a = avatarSnapshot();
        const base = baseVoice(a.ttsCommand);
        return speak(t, base ? voiceFor(a.saved, s.name || '', base) : undefined, s.id);
      }).catch(() => {});
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

  // ⌘W: 보고 있는 창의 세션을 끈다(대화는 남아 "꺼진 세션"에서 이어갈 수 있다). 참모 자신은 안 끈다
  const spaceShownRef = useRef(false);
  const askStopRef = useRef<((s: Session) => void) | null>(null);
  const closePaneRef = useRef<() => void>(() => {});
  closePaneRef.current = () => {
    const id = focused.current;
    const s = sessions.find((x) => x.id === id);
    // 채팅 뷰: 참모 탭도 ⌘W 로 끈다 — 대신 확인 창(2026-09-30 사용자). 터미널 뷰는 예전대로(리더 ⌘W 에 참모가 꺼진 적이 있다)
    if (s && spaceShownRef.current && groups.orchestrators.some((o) => o.id === s.id)) { askStopRef.current?.(s); return; }
    if (!s || !closableByShortcut(s, groups.orchestrators)) { // 비서(참모·참모-2…)는 ⌘W 로 안 끈다 — 리더 탭 닫으려던 ⌘W 에 참모-2 가 꺼졌다(2026-09-28)
      setError(s ? tr(`${assistant()}는 ⌘W로 안 꺼져 — 창 버튼의 끄기를 써줘`, `⌘W does not stop ${assistant()} — use the pane's stop button`) : tr('끌 창을 먼저 한 번 클릭해줘', 'Click the pane you want to stop first'));
      return;
    }
    if (s.kind !== 'background') return;
    closeSession(s);
  };

  // ⌘T: 보고 있는 프로젝트에 세션 하나 더. 참모 화면이면 참모를 하나 더(참모-2 …) — 한 참모가 바쁠 때 다른 참모로 위임하려고.
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
        setError(tr(`⌘T 는 프로젝트나 ${assistant()} 화면에서 — 전체 보기에선 창을 먼저 한 번 클릭해줘`, `Use ⌘T on a project or the ${assistant()} view — in All sessions, click a pane first`));
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
      />
    ),
  };

  // 도구 권한 창은 앱이 이름으로 Allow 를 찾아 자동 허용 (결정 대기함엔 선택지 질문·민감한 창만 남는다)
  useAutoAllow(sessions, env?.devRoot, loadAllowLog);
  // 하위 세션 선택지 창은 참모에게 넘긴다 — 참모가 골라 답하거나 사용자에게 묻는다. 사용자가 그 화면을 보고 있으면 안 넘긴다
  const subSessions = useMemo(() => [...groups.helpers, ...groups.loose, ...groups.projects.flatMap((p) => p.sessions)], [groups]);
  useForwardQuestions(subSessions, groups.orchestrator, (s) =>
    document.hasFocus() && (selected.kind === 'project' ? selected.name === s.project : selected.kind === 'helpers' ? groups.helpers.includes(s) : selected.kind === 'loose' && groups.loose.includes(s)),
    allActs.filter(({ session: s }) => !orchIds.has(s.id)),
    groups.orchestrators.map((o) => o.sessionId).filter((x): x is string => !!x), taskEvents, groups.orchestrators, sessions, heirOf);
  // 직접 답하기 카드 — 하위 세션이 본인 승인을 원하면 맡긴 참모 채팅에 카드(사람이 누르면 그 세션에 사람 말로)
  const direct = useDirectCards(sessions, allActs, taskEvents, groups.orchestrators, groups.orchestrator, agentLives, (c, name) => notifyOnce({
    kind: 'human', session: c.from, orch: false,
    title: tr(`${josa(name, '이', '가')} 네 답을 기다려`, `${name} needs your answer`),
    body: `${kindView(c.kind).word}${c.amount ? ` ${c.amount}` : ''} — ${c.q}`,
  }), heirOf);
  const inbox = buildInbox(allActs, taskEvents, new Set(dismissed), sessions, (s) => orchIds.has(s.id), groups.orchestrators.length > 1 ? (s) => orchDisplay(s) || assistant() : undefined).filter((i) => !(i.kind === 'blocked' && picking.has(i.target ?? '')));
  // 새 결정이 생기면: 종 아래 드롭다운이 저절로 펼쳐짐 + macOS 알림. 개수는 상단 바 종·Dock 뱃지
  const inboxKeys = inbox.map((i) => i.key).join('|');
  useEffect(() => {
    const prev = prevInbox.current;
    const fresh = freshItems(prev, inbox);
    setInboxOpen((o) => popoverOpen(o, prev, inbox));
    prevInbox.current = new Set(inbox.map((i) => i.key));
    if (fresh.length) {
      // 참모 물어봄·확인창은 위에서 따로 알린다 — 여기선 결정(task ask)·로그인 오류만
      for (const f of fresh.filter((x) => x.kind === 'decide' && bornAfter(x, APP_STARTED))) notifyOnce({ kind: 'decide', session: f.key, orch: false, title: tr(`결정 대기 — ${f.project}`, `Decision needed — ${f.project}`), body: f.text });
      const logins = fresh.filter((x) => x.kind === 'login');
      // 로그인이 풀리면 세션 여럿이 한꺼번에 멈춘다 — 알림은 한 번에 묶어서
      if (logins.length) notifyOnce({ kind: 'login', session: 'login', orch: false, title: tr(`로그인 오류 — 세션 ${logins.length}개 멈춤`, `Sign-in error — ${logins.length} sessions stopped`), body: logins.map((x) => x.project).join(', ') });
    }
    void setBadge(inbox.length).catch(() => {});
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

  // 로그인 오류로 멈춘 세션들에 '이어서' — 하나씩 차례로(attach 가 한꺼번에 몰리지 않게)
  const resumeItems = async (items: InboxItem[]) => {
    for (const item of items) {
      const s = findTarget(sessions, item.target);
      if (!s) continue;
      try {
        await sendToSession(s.id, RESUME_MSG);
        setDismissed((d) => [...d, item.key]);
      } catch (e: unknown) {
        setError(tr(`${item.project} 이어서 실패: ${String(e)}`, `Could not resume ${item.project}: ${String(e)}`));
      }
    }
    void refresh();
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
  // 터미널 뷰면 뷰를 안 바꾸고 다마고치 페이지로(같은 PetView), 채팅 뷰면 돌보는 참모 대시보드의 펫 탭으로
  openPetRef.current = () => {
    const id = keeperOf(tama.feed, navOrchs.map((o) => o.id));
    if (!spaceShownRef.current || !id) { setSelected({ kind: 'tama' }); return; }
    goOrch(id);
    setPetReq((r) => ({ id, n: (r?.n ?? 0) + 1 }));
  };
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
    // 참모(들)는 프로젝트가 아니라 참모 화면에, 도우미는 도우미 화면에 있다
    const orch = groups.orchestrators.some((o) => o.id === s.id);
    const helper = groups.helpers.some((h) => h.id === s.id);
    const loose = groups.loose.some((h) => h.id === s.id);
    setSelected(orch ? { kind: 'orchestrator' } : helper ? { kind: 'helpers' } : loose ? { kind: 'loose' } : { kind: 'project', name: s.project });
    // 가서 바로 칠 수 있게 — 가려져 있으면 드러내고 그 창에 포커스(사용자 2026-09-28: 알림 눌러 가도 다시 클릭해야 했다)
    const key = gridKeyOf(orch ? { kind: 'orch' } : helper ? { kind: 'helper' } : { kind: 'project', project: s.project }, { space, office });
    for (const a of revealPane(layoutOf(key), s.id)) dispatchFor(key)(a);
    focusedBy.current.set(key, s.id);
    focused.current = s.id;
    setFocusReq((r) => ({ key, id: s.id, n: (r?.n ?? 0) + 1 }));
  };
  // macOS 알림을 누르면 Rust(notify_mac)가 창을 앞으로 가져오고 window.__notifyClick('<갈 곳>') 을 부른다
  const noteClickRef = useRef<(t: string) => void>(() => {});
  noteClickRef.current = (raw) => {
    const t = readNoteTarget(raw);
    if (t?.to === 'inbox') setInboxOpen(true);
    else if (t?.to === 'session') openTarget(t.id);
  };
  useEffect(() => {
    const w = window as unknown as { __notifyClick?: (t: string) => void };
    w.__notifyClick = (t) => noteClickRef.current(t);
    return () => { delete w.__notifyClick; };
  }, []);
  // 참모 scripts/app — Rust(appctl.rs)가 app.jsonl 새 줄을 window.__appctl 로 넘긴다. 무엇을 할지는 domain/appctl
  const configRef = useRef(config);
  configRef.current = config;
  const saveFeature = (name: keyof typeof features, on: boolean) => {
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
    } else if (it.kind === 'feature') saveFeature(it.name, it.on);
    else if (it.kind === 'label') {
      // 폰에서 바꾼 별명 — 앱 별명에 넣고, 진짜 이름은 쉬는 때(위 renamesToSend)
      const o = navOrchs.find((x) => x.id === it.id);
      setOrchLabel(it.id, it.nick);
      if (o) wantNick(o, it.nick);
    }
    else if (it.kind === 'open') {
      const sc = openShortcut(it.what);
      if (sc) runRef.current(sc);
      else if (it.what === 'reader') setReaderOpen(true);
      else if (it.what === 'tasks') setTasksOpen(true);
      else if (it.what === 'inbox') setInboxOpen(true);
      else if (it.what === 'replay') setSelected({ kind: 'replay' });
      else if (it.what === 'load') setSelected({ kind: 'load' });
      else if (it.what === 'harnitor') harnitorRef.current('open');
      else if (it.what === 'tools') toolsRef.current('open');
    } else if (it.kind === 'close') {
      if (it.what === 'settings') setSettingsOpen(false);
      else if (it.what === 'office') { if (spaceShownRef.current) setOfficeReq('close'); else setOffice(false); }
      else if (it.what === 'reader') setReaderOpen(false);
      else if (it.what === 'tasks') setTasksOpen(false);
      else if (it.what === 'harnitor') harnitorRef.current('close');
      else if (it.what === 'tools') toolsRef.current('close');
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
  const officeCol = (open: (id: string) => void, dim?: (id: string) => boolean) => {
    // 사람 필요 책상·카드를 누르면 그 세션 브라우저 모달(지금 것) — 나머지는 부르는 쪽 길(채팅 뷰 = 사무실 위 창)
    const onOpen = (id: string) => {
      const s = sessions.find((x) => x.id === id);
      const b = s && !s.finished ? liveOf(s, agentLives) : undefined;
      if (b?.ask) openAgentModal(b.profile); else open(id);
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
    ), ownedOf(g, 'furn'), g.placed);
    const deco = { hat: g.equip.hat, window: g.equip.window, fx: g.equip.fx, dance: g.equip.action === 'action.dance', coffee: g.equip.action === 'action.coffee', hasCat: (g.owned['friend.cat'] ?? 0) > 0 };
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
    const skin = skins.includes(officeSkin) ? officeSkin : 'wood';
    const editing = officeTab === 'furniture';
    const closeModal = () => setOfficeTab('office');
    const modal = officeTab === 'gacha' || officeTab === 'dex' || officeTab === 'skins'
      ? <Shop view={officeTab} onView={setOfficeTab} file={gacha.file} draw={gacha.draw} equip={(id) => void gacha.equip(id)} skins={{ owned: skins, current: skin, onSkin: setOfficeSkin }} onClose={closeModal} />
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
        <OfficeView dim={dim} room={room} skin={skin} menu={features.gacha ? <OfficeTools tab={officeTab} onTab={setOfficeTab} /> : undefined} bottom={editing ? 190 : 0} coins={g.coins} gain={gacha.gain} onGacha={editing || !features.gacha ? undefined : () => setOfficeTab('gacha')} bossIn={bossIn} deco={deco}
          edit={editing ? { drag: furnPick, ok: (c) => canPlace(room, c), onPick: setFurnPick, onDrop: drop } : undefined}
          peek={(id, doing) => {
            const ss = sessions.find((x) => x.id === id);
            if (!ss || orchIds.has(id) || ss.kind !== 'background') return null;
            return <TerminalPane command={attachCommand(bin, id)} title={ss.workspace ? `${ss.project} / ${ss.workspace}` : ss.project} subtitle={doing ?? ss.name} fontSize={Math.max(9, fontSize - 2)} readOnly linkBase={ss.cwd} home={env?.home} />;
          }}
          deliver={(t) => delivery(stampSeen(taskEvents, seenSends.current, t), room, (target) => findTarget(sessions, target)?.id, t)} onOpen={onOpen} />
        {editing
          ? <FurnitureTray file={gacha.file} drag={furnPick} onGrab={setFurnPick} onDone={closeModal} pushed={room.furniture.filter((f) => f.pushed).map((f) => f.id)} />
          : <OfficeDock dim={dim} desks={room.desks.filter((d) => !d.boss && !d.empty)} sk={skinOf(skin)} notes={Object.fromEntries(allActs.map(({ session: s, activity: a }) => [s.id, a.reply?.ask?.q || noteOf(a.reply?.say ?? a.reply?.text)]))} onOpen={onOpen} />}
        {modal && <OfficeModal onClose={closeModal}>{modal}</OfficeModal>}
      </div>
    );
    return left;
  };
  let main;
  let spaceShown = false; // 스페이스 모드면 리더가 왼쪽 칸이라 오른쪽 리더 패널은 안 띄운다
  // 대시보드·오케스트레이터 홈 "지금 하는 일" 한 줄 — 일하면 마지막 도구, 물으면 답 끝, 쉬면 쉼
  const liveLines = Object.fromEntries([...allActs, ...sideActs].map(({ session: x, activity: a, status }) => {
    const tool = a.tool ? `${a.tool.name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '')} ${a.tool.target}`.trim() : '';
    const st: 'run' | 'ask' | 'wait' = status === 'working' ? 'run' : status === 'asks' || status === 'blocked' ? 'ask' : 'wait';
    const line = st === 'run' ? tool || tr('생각 중', 'Thinking') : st === 'ask' ? (a.reply?.tail ?? a.reply?.text ?? '').replace(/^…/, '').slice(-60) : tr('쉼', 'Idle');
    return [x.id, { status: st, line, st: status }];
  }));
  // 오케스트레이터 홈 — 어떤 참모를 켤지(앱은 스스로 켜지 않는다, 2026-10-03 사용자). 채팅 뷰 스페이스·터미널 뷰 같은 화면
  const homeNode = (onGo: (id: string) => void) => (
    <OrchHome live={navOrchs} off={offOrchList} ctx={ctx} lines={liveLines} starting={resuming} ready={stoppedReady} creating={creating} waiting={lostHold}
      nameOf={(x) => orchDisplay(x)} colorOf={orchColor}
      onGo={onGo} onResume={resumeFromHome} onNew={env && !spawning ? () => setNaming(true) : undefined} />
  );
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
      main = (
        <div className="office-mode space-mode">
          {/* 왼쪽 = 스페이스: 문서 + 지금 채팅 탭 참모가 잡고 있는 세션(터미널·보여 준 파일) — 2026-09-30 사용자, 리더는 터미널 뷰의 레거시 */}
          <SpaceView pet={features.tama ? petNode : undefined} petReq={petReq} office={features.office ? officeCol : undefined} officeReq={officeReq} onOfficeReq={() => setOfficeReq(null)} onOfficeShown={setSpaceOffice}
            harnitorReq={harnitorReq} onHarnitorReq={() => setHarnitorReq(null)} onHarnitorShown={setHarnitorOpen}
            onHarnitorClosed={() => { if (harnitorSwitched.current) { harnitorSwitched.current = false; setSpace(false); } }}
            toolsReq={toolsReq} onToolsReq={() => setToolsReq(null)} onToolsShown={setToolsOpen} computerUse={{ all: features.computerUse, setAll: (on) => saveFeature('computerUse', on) }}
            onToolsClosed={() => { if (toolsSwitched.current) { toolsSwitched.current = false; setSpace(false); } }} orch={spaceOrch} orchs={navOrchs} orchPins={orchPins} stoppingIds={[...closing.keys()]} startingOrchs={creating && !arrivedOrch(creating, navOrchs) ? [...startingOrchs, creatingRow(creating, env?.orchestratorCwd ?? '')] : startingOrchs} projectSessions={groups.projects.flatMap((p) => p.sessions)} menuOpen={sidebarOpen}
            orchHome={homeNode}
            idle={idleProjects.map((n) => ({ name: n, root: projectDir(n, env?.devRoot ?? '', env?.extraProjects ?? []) }))}
            stopped={resumable(stopped, sessions, pending)} orchCwd={env?.orchestratorCwd ?? ''}
            tasks={{ orphaned: splitCards(localCards, Date.now()).orphaned, known: knownSessions, canResume: (c) => !!orphanSession(c.target, stopped), onResume: resumeOrphan, onFinish: finishOrphan }}
            onResume={(x) => { markPending(x.sessionId); markResuming(x.sessionId); void resumeSession(x.cwd, x.sessionId, x.id).then(() => onMessage(null), (e: unknown) => onMessage(tr(`이어서 띄우기 실패: ${String(e)}`, `Resume failed: ${String(e)}`))); }}
            onChatTab={(id) => { focusedBy.current.set('orch-col', id); setChatTab(id); setFocusReq((r) => ({ key: 'orch-col', id, n: (r?.n ?? 0) + 1 })); }}
            helpers={groups.helpers}
            loose={groups.loose}
            ctxOf={ctxOf} onAddProject={config && env ? () => void addProjectFolder() : undefined}
            onRemoveStopped={(x) => { markPending(x.sessionId); void removeSession(x.id).then(() => refresh(), (e: unknown) => onMessage(tr(`지우기 실패: ${String(e)}`, `Remove failed: ${String(e)}`))); }}
            onNewOrch={env ? () => setNaming(true) : undefined}
            routines={routineItems} routinePage={routinePage}
            review={features.review ? { confirm: reviewConfirm, open: review.open.length } : undefined}
            reviewPage={features.review ? (key, onKey, onOpen) => <ReviewPage data={review} sessions={sessions} stopped={stopped} taskEvents={taskEvents} selectedKey={key} onSelectKey={onKey} onOpenSession={onOpen} /> : undefined}
            onNewSession={(root, name) => void newSession(root, name).then(() => onMessage(null), (e: unknown) => onMessage(tr(`새 세션 실패: ${String(e)}`, `New session failed: ${String(e)}`)))}
            sessions={sessions} events={taskEvents} claudeBin={bin} fontSize={fontSize} home={env?.home} live={liveLines}
            onClose={() => setSpace(false)} onOpenSession={(id) => { setSpace(false); openTarget(id); }}
            sendTo={spaceOrch ? orchDisplay(spaceOrch) || assistant() : assistant()} send={async (text) => {
              if (!spaceOrch) throw new Error(tr(`${assistant()} 세션이 없어`, `No ${assistant()} session`));
              // 그 참모 채팅에 "보내는 중" 말풍선 — 참모가 일하는 중이면 줄 서 있다가 들어가서, 표시가 없으면 안 간 줄 알았다(2026-09-30 사용자)
              window.dispatchEvent(new CustomEvent('chat-pending', { detail: { id: spaceOrch.id, text } }));
              await sendTextToSession(spaceOrch.id, text);
            }} />
          {groups.orchestrators.length > 0 && <div className="office-chats" style={{ flex: `0 0 ${chatWidth}px`, width: chatWidth, ['--chat-k' as string]: fontSize / DEFAULT_FONT }}>
            <Grip width={chatWidth} onWidth={setChatWidth} min={280} max={900} />
            <div className="space-chat-head">
              <b>{tr('채팅', 'Chat')}</b>
              <span className="seg" role="group" aria-label={tr('보기', 'View')}>
                <button className={chatView === 'stack' ? 'on' : ''} aria-pressed={chatView === 'stack'} aria-label={tr('쌓기', 'Stack')} title={tr('쌓기 — 세션을 위아래로', 'Stack — sessions top to bottom')} onClick={() => setChatView('stack')}><IconStack /></button>
                <button className={chatView === 'tabs' ? 'on' : ''} aria-pressed={chatView === 'tabs'} aria-label={tr('탭', 'Tabs')} title={tr('탭 — 한 번에 한 세션', 'Tabs — one session at a time')} onClick={() => setChatView('tabs')}><IconTabs /></button>
              </span>
            </div>
            <SessionGrid column chat={chatView} extraOf={direct.extraOf} ctxOf={ctxOf} modelOf={modelOf} onAdd={env ? () => setNaming(true) : undefined} sessions={groups.orchestrators} pinnedIds={groups.orchestrators.filter((o) => o.sessionId && orchPins.includes(o.sessionId)).map((o) => o.id)} claudeBin={bin} fontSize={fontSize} home={env?.home} titleOf={(s) => orchDisplay(s) || assistant()} subOf={(s) => orchRoleOf(s.name)?.text} {...gridFocus('orch-col')} onStop={closeSession} layout={layoutOf('orch-col')} dispatch={dispatchFor('orch-col')} onMessage={onMessage} memo={memo} />
          </div>}
        </div>
      );
    } else if (view === 'grid' && office && features.office) {
      main = (
        <div className="office-mode">
          {officeCol((id) => { if (!orchIds.has(id)) openTarget(id); })}
          <div className="office-chats" style={{ flex: `0 0 ${chatWidth}px`, width: chatWidth, ['--chat-k' as string]: fontSize / DEFAULT_FONT }}>
            <Grip width={chatWidth} onWidth={setChatWidth} min={280} max={900} />
            <SessionGrid column sessions={groups.orchestrators} claudeBin={bin} fontSize={fontSize} home={env?.home} titleOf={(s) => orchDisplay(s) || assistant()} subOf={(s) => orchRoleOf(s.name)?.text} {...gridFocus('orch-col')} onStop={closeSession} layout={layoutOf('orch-col')} dispatch={dispatchFor('orch-col')} onMessage={onMessage} memo={memo} />
          </div>
        </div>
      );
    } else if (view === 'grid') {
      // 하나든 ⌘T로 여럿이든 프로젝트 화면처럼 격자로(크기 조절·크게·접기·메모 그대로)
      main = (
        <div className="orch">
          <div className="panes">
            <SessionGrid sessions={groups.orchestrators} claudeBin={bin} fontSize={fontSize} home={env?.home} titleOf={(s) => orchDisplay(s) || assistant()} subOf={(s) => orchRoleOf(s.name)?.text} {...gridFocus('orch')} onStop={closeSession} layout={layoutOf('orch')} dispatch={dispatchFor('orch')} onMessage={onMessage} memo={memo} />
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
      <SessionGrid sessions={groups.helpers} claudeBin={bin} fontSize={fontSize} home={env?.home} titleOf={(s) => s.name} {...gridFocus('helpers')} onStop={closeSession} layout={layoutOf('helpers')} dispatch={dispatchFor('helpers')} onMessage={onMessage} memo={memo} />
    ) : (
      <div className="empty"><b>{tr('도우미 세션이 없어요', 'No helper sessions')}</b></div>
    );
  } else if (selected.kind === 'loose') {
    main = groups.loose.length ? (
      <SessionGrid sessions={groups.loose} claudeBin={bin} fontSize={fontSize} home={env?.home} titleOf={(s) => s.name || s.id} {...gridFocus('loose')} onStop={closeSession} layout={layoutOf('loose')} dispatch={dispatchFor('loose')} onMessage={onMessage} memo={memo} />
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
      <SessionGrid sessions={all} claudeBin={bin} fontSize={fontSize} home={env?.home} {...gridFocus('all')} onStop={closeSession} layout={layoutOf('all')} dispatch={dispatchFor('all')} onMessage={onMessage} memo={memo} />
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
          <SessionGrid sessions={list} claudeBin={bin} fontSize={fontSize} home={env?.home} {...gridFocus(`p:${selected.name}`)} onStop={closeSession} layout={layoutOf(`p:${selected.name}`)} dispatch={dispatchFor(`p:${selected.name}`)} onMessage={onMessage} memo={memo} />
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
    const hq = (env?.orchestratorCwd ?? '').replace(/\/+$/, '');
    const taken = stopped.filter((x) => x.cwd.replace(/\/+$/, '') === hq).map((x) => x.name);
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
    setHarnitorFloat(true);
  };
  toolsRef.current = (req) => {
    if (spaceShown) { setToolsReq(req); return; }
    if (req === 'close') return;
    // 채팅 뷰 스페이스는 참모가 없어도 뜬다(오케스트레이터 홈) — 터미널 뷰 'adopt'(붙인 세션 하나)만 스페이스가 없다
    if (orchView(groups.orchestrators) !== 'adopt') { toolsSwitched.current = true; setSpace(true); setSelected({ kind: 'orchestrator' }); setToolsReq('open'); }
  };

  const setup = config && (firstRun || settingsOpen) && (
    <Setup config={config} firstRun={firstRun} fontSize={fontSize} start={settingsStart} onClose={() => { setSettingsOpen(false); setSettingsStart(undefined); void getAppEnv().then(setEnv).catch(() => {}); /* 업데이트했으면 새 버전 번호로 */ }} />
  );
  if (firstRun) return setup;

  return (
    <OrchActionsProvider pins={orchPins} onPin={pinOrch} onNick={wantNick} onStop={closeSession} onRemove={(id) => { markPending(stopped.find((x) => x.id === id)?.sessionId ?? id); void removeSession(id).then(() => refresh(), (e: unknown) => setError(tr(`지우기 실패: ${String(e)}`, `Remove failed: ${String(e)}`))); }}>
      {naming && <NameNew baseName={nextOrchestratorName([...navOrchs, ...offOrchList].map((s) => s.name))} color={orchColor(nextOrchestratorName([...navOrchs, ...offOrchList].map((s) => s.name)))} check={(v) => nickProblem(v, [...navOrchs, ...offOrchList].map((x) => orchDisplay(x)))} onCancel={() => setNaming(false)} onMake={(v, role) => { setNaming(false); void spawnOrchestrator(v, role); }} />}
    <StopBridge to={askStopRef} />
    <div className="shell">
    {setup}
    {tourOpen && <Tour onClose={closeTour} />}
    {/* 세션 브라우저가 사람을 부르면(browser_ask_human) 어느 화면에서든 크게 띄우고 알린다 */}
    <AgentAskHost lives={agentLives} nameOf={(l) => askName(l, sessions)} notify={(profile, reason) => notifyOnce({ kind: 'human', session: profile, orch: false, title: tr('세션이 사람을 불러요', 'A session needs you'), body: reason || tr('브라우저에서 직접 해 줄 일이 있어요', 'Something to do in the browser') })} />
    {quitOpen && (() => {
      const mine = sessionsToStop(sessions, [env?.devRoot ?? '', env?.orchestratorCwd ?? '', ...(env?.extraProjects ?? [])]);
      return (
        <QuitDialog running={mine.length} onCancel={() => setQuitOpen(false)} onQuit={async (all) => {
          if (all) await Promise.allSettled(mine.map((x) => stopSession(x.id)));
          await invoke('app_exit');
        }} />
      );
    })()}
    <TopBar load={loadMon.sys ? { level: level(loadMon.sys), load1: loadMon.sys.load1, cores: loadMon.sys.cores, swapGb: loadMon.sys.swapUsedMb / 1024 } : undefined} loadOn={selected.kind === 'load'} onLoad={() => setSelected({ kind: 'load' })} features={features} usage={barUsage} usageAge={acctUsage?.age ?? null} account={topLabel(accounts)} accounts={accounts} onSettings={() => setSettingsOpen(true)} today={today} tama={{ file: tama.file, widgetShown: tama.widgetShown, onToggle: () => widgetToggleRef.current() }} replayOn={selected.kind === 'replay'} onReplay={() => setSelected({ kind: 'replay' })} reader={readerOpen} onReader={() => setReaderOpen((o) => !o)} office={space ? spaceOffice : office} onOffice={() => { if (space) { setSelected({ kind: 'orchestrator' }); setOfficeReq(spaceShown ? 'toggle' : 'open'); return; } setOffice(!office); setSelected({ kind: 'orchestrator' }); }} space={space} onView={(chat) => { setSpace(chat); setSelected({ kind: 'orchestrator' }); }} inboxCount={inbox.length} onInbox={() => setInboxOpen((o) => !o)} harnitor={harnitorFloat || (spaceShown && harnitorOpen)} onHarnitor={() => harnitorRef.current('toggle')} tools={spaceShown && toolsOpen} onTools={() => toolsRef.current('toggle')} voice={voice} onVoice={() => turnVoice(!voice)} />
    <div className="app">
      {/* 채팅 뷰에선 세션 사이드바 대신 스페이스 메뉴(오케스트레이터·프로젝트 세션)가 ⌘B 자리 — 2026-09-30 사용자 */}
      {sidebarOpen && !spaceShown && <Sidebar
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
        review={features.review ? { confirm: reviewConfirm, open: review.open.length } : undefined}
      />}
      <div className="work">
      <div className="main">
        {/* 잠깐 떴다 사라지는 안내는 화면 위에 띄운다 — 줄로 끼면 세션을 띄우고 끌 때마다 화면 전체가 오르락내리락했다(2026-09-30 사용자) */}
        {(starting.length > 0 || closing.size > 0) && (
          <div className="toasts">
            {starting.length > 0 && <div className="banner quiet"><span className="spin" /> {tr('새 세션 띄우는 중', 'Starting new session')} · {starting.join(', ')}</div>}
            {closing.size > 0 && (
              <div className="banner quiet"><span className="spin" /> {tr('끄는 중', 'Stopping')} · {[...closing.values()].join(', ')} {tr('— 대화는 남아서 "꺼진 세션"에서 이어갈 수 있어', '— the conversation is kept; resume it from "Stopped sessions"')}</div>
            )}
          </div>
        )}
        {/* 새 버전 — 켜자마자·6시간마다 보고, 있으면 늘 띄운다(닫으면 그 버전만 안 띄움). 2026-10-01 사용자 */}
        {updates.app && updDismissed !== `app:${updates.app.version}` && (
          <div className="banner warn">
            <span>{tr(`Chammo ${updates.app.version} 이 나왔어요 (지금 ${updates.appNow}). 받아서 설치하면 새 기능·고침이 들어가요.`, `Chammo ${updates.app.version} is out (you have ${updates.appNow}). Download and install it to get the new features and fixes.`)}</span>
            <button className="btn pri" onClick={() => void openLink('url', updates.app!.url).catch(() => {})}>{tr('받기', 'Download')}</button>
            <button className="btn" onClick={() => setUpdDismissed(`app:${updates.app!.version}`)}>{tr('나중에', 'Later')}</button>
          </div>
        )}
        {updates.claude && updDismissed !== `claude:${updates.claude}` && (
          <div className="banner warn">
            <span>{tr(...claudeUpdateNote(updates.claude, env?.claudeVersion ?? ''))}</span>
            <button className="btn pri" onClick={() => { setSettingsStart('update'); setSettingsOpen(true); }}>{tr('업데이트', 'Update')}</button>
            <button className="btn" onClick={() => setUpdDismissed(`claude:${updates.claude}`)}>{tr('나중에', 'Later')}</button>
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
              <button className="btn" onClick={() => setVerDismissed(v)}>{tr('닫기', 'Dismiss')}</button>
            </div>
          );
        })()}
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
    <InboxPopover open={inboxOpen} onClose={() => setInboxOpen(false)} items={inbox} blockedWhy={(it) => replyBlocked(it, sessions)} onReply={replyItem} onOpen={openTarget} onDismiss={dismissItem} onResume={resumeItems} />
    </div>
    </OrchActionsProvider>
  );
}

/** ⌘W(App 단축키)가 확인 창을 띄우게 — 확인 창은 OrchActionsProvider 안에 있다 */
function StopBridge({ to }: { to: React.MutableRefObject<((s: Session) => void) | null> }) {
  const a = useOrchActions();
  to.current = a?.askStop ?? null;
  return null;
}

