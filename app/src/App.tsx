import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { groupByProject, isOrchestratorName, nextOrchestratorName, orchView, parseAgents, projectDir, sessionsToStop, withinRoots, type Session } from './domain/session';
import { EMPTY_LAYOUT, layoutReducer, maxTarget, revealPane, type LayoutAction, type PaneLayout } from './domain/paneLayout';
import { readUsage, todayCommits, type RepoToday } from './data/tauri';
import { dayStart, parseUsage, type Usage } from './domain/usage';
import { TopBar } from './ui/TopBar';
import { Setup } from './ui/Setup';
import { Tour } from './ui/Tour';
import { QuitDialog } from './ui/QuitDialog';
import { RoutinePage } from './ui/RoutinePage';
import { parseRoutines, routineState, routineStateLabel, scheduleText, type Routine } from './domain/routine';
import { shouldShowTour } from './domain/tour';
import { useTama } from './ui/tama/useTama';
import { TamaPage } from './ui/tama/TamaPage';
import { ReplayPage } from './ui/ReplayPage';
import { LoadPage } from './ui/LoadPage';
import { useLoad } from './ui/useLoad';
import { level } from './domain/load';
import { pickFolder, readConfig, reloadConfig, routineDo, routinesList, tamaMore, type Config } from './data/tauri';
import { allowed, featuresOf, mirrorPlan } from './domain/config';
import { addExtraProject, versionWarning } from './domain/setup';
import { assistant, getLang, tr } from './i18n';
import { getAppEnv, listSessionsAllRaw, listSessionsRaw, readSay, writeVoiceMode, speak, projectScan, readTasks, readTranscriptTails, spawnSession, type AppEnv } from './data/tauri';
import { freshReplies, parseSay, pickSay, type ReplySeen } from './domain/voice';
import { blockedBody, readNoteTarget } from './domain/notify';
import { notifyOnce } from './ui/notifier';
import { activityStatus, docBadges, needsHarness, transitions, type ActivityStatus, type ProjectDoc } from './domain/status';
import { summarizeTranscript, type Activity } from './domain/activity';
import { clampFont, DEFAULT_FONT, dedupeMs, menuAction, onceWithin, shortcutFor, type Shortcut } from './domain/shortcuts';
import { foldTasks, parseTaskLog, type TaskEvent } from './domain/tasks';
import { TaskPanel, type SessionActivity } from './ui/TaskPanel';
import { invoke } from '@tauri-apps/api/core';
import { markReader, ReaderPanel, readerFocused } from './ui/reader/ReaderPanel';
import type { Surface } from './domain/reader';
import './ui/reader/reader.css';

/** 리더 패널에서 보던 탭 닫기 */
const readerCloseActive = async () => { const st = await invoke<Surface>('reader_state', { surface: 'dock' }); if (st.active) await invoke('reader_close', { surface: 'dock', path: st.active }); };
import { Sidebar, type Selection } from './ui/Sidebar';
import { AdoptCard } from './ui/AdoptCard';
import { ProjectBar } from './ui/ProjectBar';
import { SessionGrid, type MemoHooks } from './ui/SessionGrid';
import { MemoPanel } from './ui/MemoPanel';
import { useMemos } from './ui/useMemos';
import { TerminalPane } from './ui/TerminalPane';
import { StoppedStrip } from './ui/StoppedStrip';
import { orphanSession, parseStopped, recentDelegated, resumable, type StoppedSession } from './domain/stopped';
import { dismissLost, parseSnap, stepSnapshot, type LiveSnap, type SnapSession } from './domain/revive';
import { parseSpawnOutput } from './domain/adopt';
import { LostSessions, OrphanActions } from './ui/Revive';
import { OfficeView } from './ui/office/OfficeView';
import { OfficeDock } from './ui/office/OfficeDock';
import { noteOf } from './domain/dock';
import { skinOf } from './ui/office/skins';
import { GachaPage } from './ui/gacha/GachaPage';
import { DexView } from './ui/gacha/DexView';
import { SkinsView } from './ui/office/SkinsView';
import { FurnitureTray } from './ui/office/FurniturePanel';
import { OfficeModal, OfficeTools, type OfficeTab } from './ui/office/OfficeMenu';
import { useGacha } from './ui/gacha/useGacha';
import { EMPTY_GACHA, ownedOf, ownedSkins } from './domain/gacha';
import { workAct } from './domain/activity';
import { canPlace, delivery, planRoom, seatSlots, stampSeen, withLounge, type Seat } from './domain/office';
import { spriteOf } from './ui/tama/lcd';
import { Grip } from './ui/TaskPanel';
import type { TaskCard } from './domain/tasks';
import { appendTaskEvent, daemonStartedAt, readLiveSnap, resumeSession, writeLiveSnap, newSession, readAutoAllow, readCtx, sendToSession, setBadge, stopSession, tamaWidget, writeClipboard } from './data/tauri';
import { parseAllowLog, type AllowLog } from './domain/autoAllow';
import { useAutoAllow } from './ui/useAutoAllow';
import { buildInbox, findTarget, freshItems, popoverOpen, replyBlocked, RESUME_MSG, type InboxItem } from './domain/inbox';
import { InboxPopover } from './ui/Inbox';
import { ctxAlerts, parseCtx, type Ctx } from './domain/ctx';
import { useReview } from './ui/useReview';
import { ReviewPage } from './ui/ReviewPage';
import { ReviewStrip } from './ui/ReviewStrip';
import { splitOpen } from './domain/reviewSummary';
import { focusPlan, intentOf, openShortcut, withFeature } from './domain/appctl';
import { rebuildMenu, writeConfig } from './data/tauri';

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
  // 설정(config.json) — 못 읽은 동안엔 기능을 다 켠 것으로(featuresOf)
  const [config, setConfig] = useState<Config | null>(null);
  const features = featuresOf(config);
  const featuresRef = useRef(features);
  // 첫 실행(설정 파일에 setupDone 없음)이면 설정 화면이 안내를 겸한다. 메뉴 설정…(⌘,)으로 언제든 연다
  const firstRun = config?.setupDone === false;
  // 둘러보기 — 마법사를 끝낸 뒤 한 번, 그다음은 ⌘/ · Chammo 메뉴 > 둘러보기
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    if (config && shouldShowTour({ setupDone: config.setupDone, seen: load('tourSeen', false) })) setTourOpen(true);
  }, [config?.setupDone]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeTour = () => { setTourOpen(false); save('tourSeen', true); };
  // ⌘Q 종료 확인 — 앱만 끌지, Chammo 가 다루는 세션까지 끌지
  const [quitOpen, setQuitOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [chatWidth, setChatWidth] = useState<number>(() => load('officeChatWidth', 420));
  useEffect(() => save('officeChatWidth', chatWidth), [chatWidth]);
  const [inboxOpen, setInboxOpen] = useState(false);
  // Claude Code 버전이 확인된 범위(2.1.28x) 밖이면 경고 한 줄 — 막지는 않는다. 닫으면 그 버전은 다시 안 띄운다
  const [verDismissed, setVerDismissed] = useState<string | null>(() => load('claudeVersionDismissed', null));
  useEffect(() => save('claudeVersionDismissed', verDismissed), [verDismissed]);
  // 음성 모드: 참모가 답을 마치면 참모세이로 읽는다(누워 있을 때). 켜 둔 건 다음에 켜도 남는다
  const [voice, setVoice] = useState<boolean>(() => load('voiceMode', false));
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
  // 살아 있는 세션 기록(live.json) — undefined = 아직 파일을 안 읽음. 관리 프로그램 재시작으로 꺼진 세션을 찾는다(domain/revive)
  const snapRef = useRef<LiveSnap | null | undefined>(undefined);
  const [lost, setLost] = useState<SnapSession[]>([]);
  const [usage, setUsage] = useState<Usage>({});
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
  // 화면(격자)마다 마지막으로 누른 창 — ⌘1·⌘2 로 오가도 그 창이 바로 입력을 받게. activeGrid = 지금 보이는 격자(⌘Enter 대상)
  const focusedBy = useRef(new Map<string, string>());
  const activeGrid = useRef<string | null>(null);
  // "그 세션으로 가기"(알림·작업 패널·결정 대기함) — n 이 바뀔 때마다 그 격자가 그 창에 포커스를 준다
  const [focusReq, setFocusReq] = useState<{ key: string; id: string; n: number } | null>(null);
  const gridFocus = (key: string) => {
    activeGrid.current = key;
    return { gridId: key, initialFocus: focusedBy.current.get(key), focusRequest: focusReq?.key === key ? focusReq : undefined, onFocusSession: (id: string) => { focused.current = id; focusedBy.current.set(key, id); } };
  };
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
  const markPending = (sid: string) => {
    setPending((p) => new Set(p).add(sid));
    // 목록이 갱신돼 살아 있는 세션으로 잡히면 resumable 이 알아서 빼니, 잠깐만 들고 있는다
    setTimeout(() => setPending((p) => { const n = new Set(p); n.delete(sid); return n; }), 15_000);
  };
  const prevStatus = useRef<Record<string, ActivityStatus>>({});
  const seenReplies = useRef<ReplySeen | null>(null); // 참모 답 중 이미 읽은(또는 처음 보고 넘긴) 것
  useEffect(() => save('fontSize', fontSize), [fontSize]);
  useEffect(() => save('sidebarOpen', sidebarOpen), [sidebarOpen]);
  useEffect(() => save('tasksOpen', tasksOpen), [tasksOpen]);

  // 단축키 = 메뉴바 항목과 같은 동작. 창 전체에서 capture 로 먼저 받는다 — 터미널(xterm)보다 앞에서 가로채야 Claude 입력칸에 안 들어간다.
  // 메뉴(Rust main.rs)에도 같은 단축키가 걸려 있어서 둘 다 올 수 있다 → 잠깐 사이(dedupeMs)의 같은 동작은 한 번만
  const runRef = useRef<(sc: Shortcut) => void>(() => {});
  runRef.current = (sc: Shortcut) => {
    if (!allowed(sc, featuresRef.current)) return; // 꺼 둔 기능(사무실·다마고치·리뷰)의 입구
    // ⌘1 = 참모 터미널 격자(사무실 끔) · ⌘4 = 사무실 뷰(사무실 켬) · ⌘3 = 리뷰 (2026-09-27 사용자)
    if (sc.type === 'goto') {
      if (sc.to === 'tama') { void tamaMore().catch(() => {}); return; } // 도감·보관함 = 다마고치 틀의 따로 창
      if (sc.to === 'office') { setOffice(true); setOfficeTab('office'); setSelected({ kind: 'orchestrator' }); }
      else { if (sc.to === 'orchestrator') setOffice(false); setSelected({ kind: sc.to }); }
    }
    else if (sc.type === 'font') setFontSize((f) => clampFont(f + sc.delta));
    else if (sc.type === 'fontReset') setFontSize(DEFAULT_FONT);
    else if (sc.type === 'toggleSidebar') setSidebarOpen((o) => !o);
    else if (sc.type === 'toggleTasks') setTasksOpen((o) => !o);
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
    else if (sc.type === 'tour') setTourOpen(true);
    else if (sc.type === 'quitAsk') setQuitOpen(true);
    else if (sc.type === 'maximizePane' && readerOpen && readerFocused()) setReaderFull((f) => !f); // 리더를 보고 있으면 리더를 크게·작게(사용자: 보고 있는 곳 기준)
    else if (sc.type === 'maximizePane') {
      // ⌘Enter — 지금 보이는 격자에서 마지막으로 누른 창을 크게, 이미 크면 되돌리기(포커스는 SessionGrid 가 그 창에 돌려준다)
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
    const run = (sc: Shortcut) => { const ms = dedupeMs(sc); if (ms === 0 || (ms === 150 ? fast : slow)(JSON.stringify(sc), Date.now())) runRef.current(sc); };
    const onKey = (e: KeyboardEvent) => {
      const sc = shortcutFor(e);
      if (!sc) return;
      e.preventDefault();
      e.stopPropagation();
      run(sc);
    };
    // 메뉴바 항목을 누르면 Rust 가 window.__menu('<id>') 를 부른다
    const w = window as unknown as { __menu?: (id: string) => void };
    w.__menu = (id) => { const sc = menuAction(id); if (sc) run(sc); };
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

  const refresh = useCallback(async () => {
    if (!env) return;
    try {
      // 내 프로젝트 폴더·HQ 안의 세션만 — 이 맥의 다른 데서 띄운 Claude 세션이 섞이지 않게
      const everyone = parseAgents(await listSessionsRaw(), env.devRoot, env.extraProjects);
      setAllSessions(everyone);
      const live = withinRoots(everyone, [env.devRoot, env.orchestratorCwd, ...env.extraProjects]);
      setSessions(live);
      // 재시작 감지가 실패해도 세션 목록은 살린다 — 따로 잡는다
      try {
        if (snapRef.current === undefined) snapRef.current = parseSnap(await readLiveSnap());
        const snap = stepSnapshot(snapRef.current, await daemonStartedAt(), live, Date.now());
        if (snap && JSON.stringify(snap) !== JSON.stringify(snapRef.current)) void writeLiveSnap(JSON.stringify(snap)).catch(() => {});
        snapRef.current = snap;
        setLost(snap?.lost ?? []);
      } catch {
        // 다음 폴링에서 다시
      }
      setTaskEvents(parseTaskLog(await readTasks()));
      setStopped(withinRoots(parseStopped(await listSessionsAllRaw(), env.devRoot, env.extraProjects), [env.devRoot, env.orchestratorCwd, ...env.extraProjects]));
      setCtx(parseCtx(await readCtx()));
      setError(null);
    } catch (e: unknown) {
      // 옛 claude(--json 없음)나 로그인 풀림이 여기로 온다 — 숨기지 않고 배너로
      setError(tr(`세션 목록 실패: ${String(e)}`, `Could not list sessions: ${String(e)}`));
    }
  }, [env]);

  useEffect(() => {
    if (!env || firstRun) return; // 첫 실행 안내 중엔 claude 가 아직 없을 수 있다 — 끝나면 창을 다시 연다
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [env, refresh, firstRun]);

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
    const u = () => readUsage().then((j) => setUsage(parseUsage(j, Date.now()))).catch(() => {});
    const c = () => todayCommits(env.devRoot, env.gitEmail, dayStart(new Date())).then(setToday).catch(() => {});
    void u();
    void c();
    const t1 = setInterval(u, 15_000);
    const t2 = setInterval(c, 60_000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
  }, [env]);

  const visibleSessions = useMemo(() => sessions.filter((s) => !closing.has(s.id)), [sessions, closing]);
  const groups = useMemo(
    () => groupByProject(visibleSessions, env?.orchestratorCwd ?? ''),
    [visibleSessions, env],
  );

  const spawnOrchestrator = async () => {
    if (!env) return;
    setSpawning(true);
    try {
      await spawnSession(env.orchestratorCwd, nextOrchestratorName(groups.orchestrators.map((s) => s.name)), tr('세션 준비됐어. 지시 기다릴게.', 'Session ready. Waiting for instructions.'));
      await refresh();
    } catch (e: unknown) {
      setError(tr(`${assistant()} 띄우기 실패: ${String(e)}`, `Could not start ${assistant()}: ${String(e)}`));
    } finally {
      setSpawning(false);
    }
  };

  // 다마고치: 1분마다 작업 기록을 먹여 tama.json 에 쓴다(위젯 창은 읽기만)
  const tama = useTama(env, sessions, taskEvents, (k) => { if (k === 'dex') setSelected({ kind: 'tama' }); });
  const gacha = useGacha(env, tama.feed);
  widgetToggleRef.current = () => (tama.widgetShown ? void tamaWidget(false) : tama.showWidget());
  // 꺼 둔 기능: 떠 있던 다마고치 위젯은 숨기고, 그 화면을 보고 있었으면 비서 화면으로
  useEffect(() => { if (!features.tama && tama.widgetShown) void tamaWidget(false).catch(() => {}); }, [features.tama, tama.widgetShown]);
  useEffect(() => {
    if ((selected.kind === 'review' && !features.review) || (selected.kind === 'tama' && !features.tama)) setSelected({ kind: 'orchestrator' });
  }, [selected.kind, features.review, features.tama]);

  const bin = env?.claudeBin ?? 'claude';
  const cards = useMemo(() => foldTasks(taskEvents, sessions), [taskEvents, sessions]);
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
      if (!x || t.to !== 'blocked') continue;
      const name = x.session.name || assistant();
      const body = blockedBody(x.session.waitingFor);
      if (voiceRef.current) void speak(`${name} ${body}`).catch(() => {});
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
      if (voiceRef.current) void readSay().catch(() => '').then((log) => pickSay(parseSay(log), s.id, x.activity.prompt?.ts ?? '') ?? f.reply.say).then((t) => (t ? speak(t) : undefined)).catch(() => {});
      if (f.reply.asks) notifyOnce({ kind: 'asks', session: s.id, orch: true, title: tr(`${s.name || assistant()} 답이 필요해`, `${s.name || assistant()} needs your answer`), body: f.reply.text });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orchKey, Object.keys(activity).length > 0]);

  // 컨텍스트 80% 를 넘는 순간 macOS 알림 — 곧 자동 요약되니 /compact 하거나 새 세션으로 넘길 때. 참모 세션만(하위 세션은 참모가 챙긴다)
  const ctxOf = (s: Session) => (s.sessionId ? ctx[s.sessionId]?.used : undefined);
  useEffect(() => {
    const now = Object.fromEntries(Object.entries(ctx).map(([k, v]) => [k, v.used]));
    if (prevCtx.current) {
      for (const sid of ctxAlerts(prevCtx.current, now)) {
        const s = sessions.find((x) => x.sessionId === sid);
        const orch = !!s && orchIds.has(s.id);
        const where = s ? (orch ? s.name || assistant() : s.workspace ? `${s.project} / ${s.workspace}` : s.project) : sid.slice(0, 8);
        notifyOnce({ kind: 'ctx', session: sid, orch, title: tr(`${where} 대화 ${now[sid]}% 찼어`, `${where} conversation is ${now[sid]}% full`), body: tr('곧 자동 요약돼 — /compact 하거나 새 세션으로 넘길 때야', 'It will be summarized soon — time to /compact or hand off to a new session') });
      }
    }
    prevCtx.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  // ⌘W: 보고 있는 창의 세션을 끈다(대화는 남아 "꺼진 세션"에서 이어갈 수 있다). 참모 자신은 안 끈다
  const closePaneRef = useRef<() => void>(() => {});
  closePaneRef.current = () => {
    const id = focused.current;
    const s = sessions.find((x) => x.id === id);
    if (!s || s.id === groups.orchestrator?.id || isOrchestratorName(s.name)) { // 대표 비서(설정 이름·옛 이름)는 ⌘W 로 안 끈다
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
    if (selected.kind === 'orchestrator') {
      cwd = env.orchestratorCwd;
      name = nextOrchestratorName(groups.orchestrators.map((s) => s.name));
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
      />
    ),
  };

  // 도구 권한 창은 앱이 이름으로 Allow 를 찾아 자동 허용 (결정 대기함엔 선택지 질문·민감한 창만 남는다)
  useAutoAllow(sessions, env?.devRoot, loadAllowLog);
  const inbox = buildInbox(allActs, taskEvents, new Set(dismissed), sessions, (s) => orchIds.has(s.id));
  // 새 결정이 생기면: 종 아래 드롭다운이 저절로 펼쳐짐 + macOS 알림. 개수는 상단 바 종·Dock 뱃지
  const inboxKeys = inbox.map((i) => i.key).join('|');
  useEffect(() => {
    const prev = prevInbox.current;
    const fresh = freshItems(prev, inbox);
    setInboxOpen((o) => popoverOpen(o, prev, inbox));
    prevInbox.current = new Set(inbox.map((i) => i.key));
    if (fresh.length) {
      // 참모 물어봄·확인창은 위에서 따로 알린다 — 여기선 결정(task ask)·로그인 오류만
      for (const f of fresh.filter((x) => x.kind === 'decide')) notifyOnce({ kind: 'decide', session: f.key, orch: false, title: tr(`결정 대기 — ${f.project}`, `Decision needed — ${f.project}`), body: f.text });
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

  // 재시작으로 꺼진 세션 — 한 번에 하나씩 이어서 켠다(동시에 띄우면 관리 프로그램이 몰린다)
  const reviveAll = async () => {
    const fails: string[] = [];
    for (const s of lost) {
      markPending(s.sessionId);
      try {
        await resumeSession(s.cwd, s.sessionId);
      } catch (e: unknown) {
        fails.push(`${s.name}: ${String(e)}`);
      }
    }
    if (fails.length) setError(tr(`이어서 켜기 실패 ${fails.length}개 — ${fails.join(' · ')}`, `${fails.length} sessions could not be resumed — ${fails.join(' · ')}`));
    await refresh();
  };
  const dismissRevive = () => {
    if (!snapRef.current) return;
    snapRef.current = dismissLost(snapRef.current);
    setLost([]);
    void writeLiveSnap(JSON.stringify(snapRef.current)).catch(() => {});
  };
  // 주인 잃은 일 — 그 세션을 이어서 켜고, 이름이 바뀌어 못 찾을 수 있으면 작업 기록의 대상을 새 id 로 옮긴다
  const resumeOrphan = async (c: TaskCard) => {
    const st = orphanSession(c.target, stopped);
    if (!st) return;
    markPending(st.sessionId);
    try {
      const out = await resumeSession(st.cwd, st.sessionId);
      if (st.name !== c.target) {
        const { id } = parseSpawnOutput(out);
        await appendTaskEvent({ ts: new Date().toISOString(), type: 'note', task: c.id, note: tr('이어서 켬', 'Resumed'), target: id });
      }
    } catch (e: unknown) {
      setError(tr(`${c.target} 이어서 켜기 실패: ${String(e)}`, `Could not resume ${c.target}: ${String(e)}`));
    }
    await refresh();
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
    // 참모(들)는 프로젝트가 아니라 참모 화면에 있다
    const orch = groups.orchestrators.some((o) => o.id === s.id);
    setSelected(orch ? { kind: 'orchestrator' } : { kind: 'project', name: s.project });
    // 가서 바로 칠 수 있게 — 가려져 있으면 드러내고 그 창에 포커스(사용자 2026-09-28: 알림 눌러 가도 다시 클릭해야 했다)
    const key = orch ? (office ? 'orch-col' : 'orch') : `p:${s.project}`;
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
    else if (it.kind === 'open') {
      const sc = openShortcut(it.what);
      if (sc) runRef.current(sc);
      else if (it.what === 'reader') setReaderOpen(true);
      else if (it.what === 'tasks') setTasksOpen(true);
      else if (it.what === 'inbox') setInboxOpen(true);
      else if (it.what === 'replay') setSelected({ kind: 'replay' });
      else if (it.what === 'load') setSelected({ kind: 'load' });
    } else if (it.kind === 'close') {
      if (it.what === 'settings') setSettingsOpen(false);
      else if (it.what === 'office') setOffice(false);
      else if (it.what === 'reader') setReaderOpen(false);
      else if (it.what === 'tasks') setTasksOpen(false);
      else setInboxOpen(false);
    } else if (it.kind === 'focus') {
      const plan = focusPlan(it.target, sessions, docs.map((d) => d.name));
      if (!plan) setError(tr(`${it.target} 세션·프로젝트를 못 찾았어`, `No session or project named ${it.target}`));
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
  const delegated = recentDelegated(cards, sessions);
  const runningStrip = delegated.length > 0 && (
    <div className="running">
      <div className="running-head">{tr('지금 시킨 일', 'Delegated now')} · {delegated.length} <span className="dim">{tr('— 누르면 그 세션으로', '— click to open that session')}</span></div>
      {/* 한 줄로만 — 2줄로 쌓이면 칸이 반쯤 비어 깨진 화면처럼 보인다(2026-09-27 사용자) */}
      <div className="grid" style={{ gridTemplateColumns: `repeat(${delegated.length}, 1fr)`, gridTemplateRows: '1fr' }}>
        {delegated.map((s) => (
          <TerminalPane
            key={`run-${s.id}`}
            command={`exec '${bin}' attach ${s.id}`}
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
  let main;
  if (selected.kind === 'orchestrator') {
    const o = groups.orchestrator;
    const view = orchView(groups.orchestrators);
    if (view === 'grid' && office && features.office) {
      // 작업 중이면 마지막 도구로 행동·머리 위 한 줄(지시 뒤에 부른 도구만 — 옛 도구로 흉내 내지 않게)
      const seat = ({ session: s, status, activity: a }: SessionActivity): Seat => {
        const tool = status === 'working' && a.tool && (!a.prompt || a.tool.ts >= a.prompt.ts) ? a.tool : undefined;
        const name = tool ? tool.name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '') : '';
        return {
          // 사무실 이름표엔 브랜치(worktree)를 안 쓴다 — 프로젝트 이름만(사용자 2026-09-27)
          id: s.id, label: s.project, project: s.project, status, startedAt: s.startedAt,
          ...(status === 'working' ? { act: workAct(tool), ...(tool ? { doing: `${name} ${tool.target}`.trim() } : {}) } : {}),
        };
      };
      const pet = tama.file?.pet;
      const g = gacha.file ?? EMPTY_GACHA;
      const room = withLounge(planRoom(
        orchActs.map((a) => ({ ...seat(a), label: a.session.name || assistant() })),
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
      const modal =
        officeTab === 'gacha' ? <GachaPage file={gacha.file} draw={gacha.draw} onClose={closeModal} /> :
        officeTab === 'dex' ? <DexView file={gacha.file} equip={(id) => void gacha.equip(id)} onClose={closeModal} /> :
        officeTab === 'skins' ? <SkinsView owned={skins} current={skin} onSkin={setOfficeSkin} coins={g.coins} onClose={closeModal} /> : null;
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
          <OfficeView room={room} skin={skin} menu={features.gacha ? <OfficeTools tab={officeTab} onTab={setOfficeTab} /> : undefined} bottom={editing ? 190 : 0} coins={g.coins} gain={gacha.gain} onGacha={editing || !features.gacha ? undefined : () => setOfficeTab('gacha')} bossIn={bossIn} deco={deco}
            edit={editing ? { drag: furnPick, ok: (c) => canPlace(room, c), onPick: setFurnPick, onDrop: drop } : undefined}
            peek={(id, doing) => {
              const ss = sessions.find((x) => x.id === id);
              if (!ss || orchIds.has(id) || ss.kind !== 'background') return null;
              return <TerminalPane command={`exec '${bin}' attach ${id}`} title={ss.workspace ? `${ss.project} / ${ss.workspace}` : ss.project} subtitle={doing ?? ss.name} fontSize={Math.max(9, fontSize - 2)} readOnly linkBase={ss.cwd} home={env?.home} />;
            }}
            deliver={(t) => delivery(stampSeen(taskEvents, seenSends.current, t), room, (target) => findTarget(sessions, target)?.id, t)} onOpen={(id) => { if (!orchIds.has(id)) openTarget(id); }} />
          {editing
            ? <FurnitureTray file={gacha.file} drag={furnPick} onGrab={setFurnPick} onDone={closeModal} pushed={room.furniture.filter((f) => f.pushed).map((f) => f.id)} />
            : <OfficeDock desks={room.desks.filter((d) => !d.boss && !d.empty)} sk={skinOf(skin)} notes={Object.fromEntries(allActs.map(({ session: s, activity: a }) => [s.id, a.reply?.ask?.q || noteOf(a.reply?.say ?? a.reply?.text)]))} onOpen={(id) => { if (!orchIds.has(id)) openTarget(id); }} />}
          {modal && <OfficeModal onClose={closeModal}>{modal}</OfficeModal>}
        </div>
      );
      main = (
        <div className="office-mode">
          {left}
          <div className="office-chats" style={{ flex: `0 0 ${chatWidth}px`, width: chatWidth }}>
            <Grip width={chatWidth} onWidth={setChatWidth} min={280} max={900} />
            <SessionGrid column sessions={groups.orchestrators} claudeBin={bin} fontSize={fontSize} home={env?.home} titleOf={(s) => s.name || assistant()} {...gridFocus('orch-col')} onStop={closeSession} layout={layoutOf('orch-col')} dispatch={dispatchFor('orch-col')} onMessage={onMessage} memo={memo} />
          </div>
        </div>
      );
    } else if (view === 'grid') {
      // 하나든 ⌘T로 여럿이든 프로젝트 화면처럼 격자로(크기 조절·크게·접기·메모 그대로)
      main = (
        <div className="orch">
          <div className="panes">
            <SessionGrid sessions={groups.orchestrators} claudeBin={bin} fontSize={fontSize} home={env?.home} titleOf={(s) => s.name || assistant()} {...gridFocus('orch')} onStop={closeSession} layout={layoutOf('orch')} dispatch={dispatchFor('orch')} onMessage={onMessage} memo={memo} />
          </div>
          {runningStrip}
        </div>
      );
    } else if (view === 'adopt' && o) {
      main = <div className="orch"><div className="panes"><AdoptCard session={o} title={assistant()} isOrchestrator onDone={onMessage} /></div>{runningStrip}</div>;
    } else {
      main = (
        <div className="empty">
          <b>{tr(`${assistant()} 세션이 없어요`, `No ${assistant()} session yet`)}</b>
          <span>{env?.orchestratorCwd}</span>
          <button className="btn pri" disabled={spawning || !env} onClick={() => void spawnOrchestrator()}>
            {spawning ? tr('띄우는 중…', 'Starting…') : tr(`${assistant()} 띄우기`, `Start ${assistant()}`)}
          </button>
        </div>
      );
    }
  } else if (selected.kind === 'tama') {
    main = <TamaPage file={tama.file} apply={tama.apply} />;
  } else if (selected.kind === 'routine') {
    const r = routines.find((x) => x.name === selected.name);
    const live = allSessions.find((x) => x.name === `routine-${selected.name}` && x.state !== 'idle');
    main = r ? (
      <RoutinePage routine={r} state={routineState(r, allSessions)} liveSession={live?.id ?? null} claudeBin={bin} fontSize={fontSize}
        onAction={async (a) => {
          try { await routineDo(r.name, a); } catch (e: unknown) { setError(tr(`루틴 ${r.name}: ${String(e)}`, `Routine ${r.name}: ${String(e)}`)); }
          if (a === 'remove') setSelected({ kind: 'orchestrator' });
          pullRoutines();
          void refresh();
        }} />
    ) : <div className="empty"><b>{tr('루틴을 찾을 수 없어요', 'Routine not found')}</b></div>;
  } else if (selected.kind === 'review') {
    main = <ReviewPage data={review} sessions={sessions} stopped={stopped} taskEvents={taskEvents} selectedKey={selected.key} onSelectKey={(key) => setSelected({ kind: 'review', key })} onOpenSession={openTarget} />;
  } else if (selected.kind === 'load') {
    main = <LoadPage sys={loadMon.sys} report={loadMon.report} onOpen={openTarget} onKilled={() => void loadMon.refresh()} />;
  } else if (selected.kind === 'replay') {
    main = env ? <ReplayPage devRoot={env.devRoot} author={env.gitEmail} tasks={taskEvents} tama={tama.file} /> : null;
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

  const setup = config && (firstRun || settingsOpen) && (
    <Setup config={config} firstRun={firstRun} orchestratorNames={groups.orchestrators.map((s) => s.name)} fontSize={fontSize} onClose={() => setSettingsOpen(false)} />
  );
  if (firstRun) return setup;

  return (
    <div className="shell">
    {setup}
    {tourOpen && <Tour onClose={closeTour} />}
    {quitOpen && (() => {
      const mine = sessionsToStop(sessions, [env?.devRoot ?? '', env?.orchestratorCwd ?? '', ...(env?.extraProjects ?? [])]);
      return (
        <QuitDialog running={mine.length} onCancel={() => setQuitOpen(false)} onQuit={async (all) => {
          if (all) await Promise.allSettled(mine.map((x) => stopSession(x.id)));
          await invoke('app_exit');
        }} />
      );
    })()}
    <TopBar load={loadMon.sys ? { level: level(loadMon.sys), load1: loadMon.sys.load1, cores: loadMon.sys.cores, swapGb: loadMon.sys.swapUsedMb / 1024 } : undefined} loadOn={selected.kind === 'load'} onLoad={() => setSelected({ kind: 'load' })} features={features} usage={usage} today={today} tama={{ file: tama.file, widgetShown: tama.widgetShown, onToggle: () => widgetToggleRef.current() }} replayOn={selected.kind === 'replay'} onReplay={() => setSelected({ kind: 'replay' })} reader={readerOpen} onReader={() => setReaderOpen((o) => !o)} office={office} onOffice={() => { setOffice((v) => !v); setSelected({ kind: 'orchestrator' }); }} inboxCount={inbox.length} onInbox={() => setInboxOpen((o) => !o)} onSettings={() => setSettingsOpen(true)} voice={voice} onVoice={() => turnVoice(!voice)} />
    <div className="app">
      {sidebarOpen && <Sidebar
        routines={routines.map((r) => { const st = routineState(r, allSessions); return { name: r.name, state: st, line: `${scheduleText(r.schedule)} · ${routineStateLabel(st)}` }; })}
        orchestrator={groups.orchestrator}
        projects={groups.projects}
        selected={selected}
        onSelect={setSelected}
        onAddProject={config && env ? () => void addProjectFolder() : undefined}
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
        {starting.length > 0 && <div className="banner quiet"><span className="spin" /> {tr('새 세션 띄우는 중', 'Starting new session')} · {starting.join(', ')}</div>}
        {closing.size > 0 && (
          <div className="banner quiet"><span className="spin" /> {tr('끄는 중', 'Stopping')} · {[...closing.values()].join(', ')} {tr('— 대화는 남아서 "꺼진 세션"에서 이어갈 수 있어', '— the conversation is kept; resume it from "Stopped sessions"')}</div>
        )}
        {env && (() => {
          const w = versionWarning(env.claudeVersion, verDismissed);
          if (!w) return null;
          const v = env.claudeVersion.trim();
          return (
            <div className="banner warn">
              <span>{w === 'old'
                ? tr(`Claude Code ${v} 은 Chammo 가 기대는 기능보다 옛 버전이에요. 터미널에서 claude update 로 올려 주세요.`, `Claude Code ${v} is older than the features Chammo relies on. Please run claude update in a terminal.`)
                : tr(`Claude Code ${v} 은 아직 Chammo 에서 확인하지 않은 새 버전이에요. 대부분 잘 되지만, 이상하면 알려 주세요.`, `Claude Code ${v} is newer than what Chammo was tested with. It usually works — if something looks off, please let us know.`)}</span>
              <button className="btn" onClick={() => setVerDismissed(v)}>{tr('닫기', 'Dismiss')}</button>
            </div>
          );
        })()}
        {error && <div className="banner">{error}</div>}
        {main}
      </div>
      {readerOpen && <ReaderPanel width={readerWidth} onWidth={setReaderWidth} full={readerFull} onFull={() => setReaderFull((f) => !f)} onClose={() => setReaderOpen(false)} />}
      </div>
      {tasksOpen && <TaskPanel width={tasksWidth} onWidth={setTasksWidth} cards={cards} activities={activities} onOpen={openTarget}
        top={<>
          <LostSessions lost={lost} onReviveAll={reviveAll} onDismiss={dismissRevive} />
          {features.review && <ReviewStrip data={review} onOpen={(key) => setSelected({ kind: 'review', key })} />}
        </>}
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
    <InboxPopover open={inboxOpen} onClose={() => setInboxOpen(false)} items={inbox} blockedWhy={(it) => replyBlocked(it, sessions)} onReply={replyItem} onOpen={openTarget} onDismiss={dismissItem} onResume={resumeItems} />
    </div>
  );
}
