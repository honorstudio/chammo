// Rust 커맨드 호출을 한 곳에 모은다. UI 는 이 파일만 알고, invoke 이름은 여기서만 쓴다.
import { Channel, invoke } from '@tauri-apps/api/core';
import type { Features } from '../domain/config';
import type { AccountsView } from '../domain/accounts';
import type { PreviewPhase } from '../domain/voiceDial';
import type { SayNow } from '../domain/speakGlow';
import type { ApiGot } from '../domain/accountAuto';
import type { DeviceRow } from '../domain/mobileDevices';
import { fwd } from '../domain/paths';

export type AppEnv = {
  home: string;
  devRoot: string;
  /** devRoot 밖에 따로 추가한 프로젝트 폴더들(푼 경로) */
  extraProjects: string[];
  orchestratorCwd: string;
  claudeBin: string;
  claudeVersion: string;
  /** 다마고치 CI 배틀용(설정 githubUser). 비면 CI 는 안 읽는다 */
  githubUser: string;
  /** 내 커밋을 가리는 작성자(git config --global user.email) */
  gitEmail: string;
  dataDir: string;
};

/** 경로는 fwd 로 — 윈도우는 C:\Users\me/.chammo/hq 처럼 섞여 와 claude agents 의 cwd 와 안 맞았다 */
export const getAppEnv = () => invoke<AppEnv>('app_env').then((e) => ({
  ...e,
  home: fwd(e.home),
  devRoot: fwd(e.devRoot),
  extraProjects: e.extraProjects.map(fwd),
  orchestratorCwd: fwd(e.orchestratorCwd),
  dataDir: fwd(e.dataDir),
}));

// ── 설정(config.json, Rust config.rs). 화면에 비추는 판단은 domain/config.ts ──
export type { Features };
export type Config = {
  language: string;
  assistantName: string;
  devRoot: string;
  /** devRoot 밖에 따로 추가한 프로젝트 폴더들(`~/…` 모양) */
  extraProjects: string[];
  hqDir: string;
  githubUser: string;
  ttsCommand: string;
  memoDir: string;
  features: Features;
  setupDone: boolean;
  /** 말하기 키 — '' 끔 · 'fn' 지구본 · 'right-option' 오른쪽 ⌥ */
  talkKey?: string;
  /** 앱 밖에서도 말하기 키를 본다(손쉬운 사용 권한) */
  talkAnywhere?: boolean;
};
/** 설정 읽기 — 새 설치면 기본값(GitHub 아이디는 gh 로 채워 본다) */
export const readConfig = () => invoke<Config>('read_config');
/** 설정 저장. 언어·비서 이름은 뜰 때 정하니 저장 뒤 창을 다시 연다 */
/** 설정 파일 다시 읽기 — 참모가 scripts/app project 로 config.json 을 고친 뒤 */
export const reloadConfig = () => invoke<Config>('reload_config');
export const writeConfig = (config: Config) => invoke<void>('write_config', { config });
/** 설정 저장 뒤 메뉴를 다시 만든다(언어·비서 이름·꺼 둔 기능) */
export const rebuildMenu = () => invoke<void>('rebuild_menu');

// ── HQ 폴더(Rust hq.rs) ──
export type HqReport = { written: string[]; kept: string[] };
/** HQ 폴더에 템플릿(비서용 CLAUDE.md·scripts)을 푼다. 있는 파일은 overwrite 일 때만 덮는다 */
export const createHq = (dir: string, overwrite = false) => invoke<HqReport>('create_hq', { dir, overwrite });
export type FolderStatus = { exists: boolean; hqReady: boolean };
export const folderStatus = (dir: string) => invoke<FolderStatus>('folder_status', { dir });
/** mkdir -p (`~/…` 가능) */
export const makeDir = (dir: string) => invoke<void>('make_dir', { dir });

// ── 환경 점검(Rust setup.rs, 판단은 domain/setup.ts) ──
export const checkEnv = () => invoke<import('../domain/setup').EnvCheck>('check_env');
/** Claude Code 가 이 폴더(또는 위 폴더)를 믿나 — ~/.claude.json */
export const claudeTrusted = (dir: string) => invoke<boolean>('claude_trusted', { dir });
/** 프로젝트 폴더를 실제로 읽어 본다(dir 를 안 주면 저장된 devRoot — 잘 읽히면 그 아래 믿음도 챙긴다). 판단은 domain/access.ts */
export const projectAccess = (dir?: string) => invoke<import('../domain/access').Access>('project_access', { dir: dir ?? null });
/** 같은 앱이 여러 벌 깔렸나·떠 있나(맥, .app 일 때만) */
export const appCopies = () => invoke<import('../domain/access').Copies>('app_copies');
/** 저장 전의 음성 명령으로 한 번 읽어 보기 */
export const ttsTest = (command: string, text: string) => invoke<void>('tts_test', { command, text });
/** Supertonic — 설정에 적힐 실행기 경로와 받기가 끝났나 */
export type SupertonicStatus = { runner: string; ready: boolean };
export const supertonicStatus = () => invoke<SupertonicStatus>('supertonic_status');
/** Supertonic 받기(약 550MB, 몇 분). 실패하면 설치 기록 끝부분 */
export const supertonicInstall = () => invoke<void>('supertonic_install');
/** `say -v ?` 목록 그대로 — 거르기는 domain/tts nativeVoices */
export const nativeVoicesList = () => invoke<string>('native_voices');
/** macOS 목소리를 소리 없이 미리 불러 둔다(들어보기 첫 지연 줄이기). 다른 음성 명령이면 아무것도 안 한다 */
/** 대화형 세션 pid → 어디서 떴나(origin.rs). unattended = 예약 작업·붙은 사람 없는 tmux */
export const sessionOrigins = (pids: number[]) => invoke<Record<string, { unattended: boolean; via: string }>>('session_origins', { pids });
export const ttsWarm = (command: string) => invoke<void>('tts_warm', { command });

/** `claude agents --json` 원문. 파싱은 domain/session.ts 의 parseAgents */
export const listSessionsRaw = () => invoke<string>('list_sessions');

export const spawnSession = (cwd: string, name: string, prompt: string) =>
  invoke<string>('spawn_session', { cwd, name, prompt });

export function openPty(
  command: string,
  cwd: string | undefined,
  cols: number,
  rows: number,
  onData: (bytes: Uint8Array) => void,
): Promise<number> {
  const onDataCh = new Channel<ArrayBuffer | number[]>();
  onDataCh.onmessage = (d) => onData(d instanceof ArrayBuffer ? new Uint8Array(d) : Uint8Array.from(d));
  return invoke<number>('pty_open', { command, cwd, cols, rows, onData: onDataCh });
}

export const writePty = (id: number, data: string) => invoke<void>('pty_write', { id, data });
export const resizePty = (id: number, cols: number, rows: number) => invoke<void>('pty_resize', { id, cols, rows });
export const closePty = (id: number) => invoke<void>('pty_close', { id });
/** 지구본(fn) 키 말하기가 스페이스를 흘릴 pty — 마지막으로 포커스를 받은 입력 창 */
export const pttTarget = (id: number | null) => invoke<void>('ptt_target', { id });
/** 지구본 키 말하기가 끝난 pty 를 받는다(한 번만 등록 — 여러 창은 TerminalPane 이 나눠 듣는다) */
export const pttWatch = (cb: (ptyId: number) => void) => {
  const ch = new Channel<number>();
  ch.onmessage = cb;
  return invoke<void>('ptt_watch', { onStop: ch });
};

/** 터미널 대화형 세션을 끝내고 같은 대화를 백그라운드로 이어간다. 돌려주는 건 `claude --bg` 출력 */
export const adoptSession = (pid: number, sessionId: string, cwd: string, name: string) =>
  invoke<string>('adopt_session', { pid, sessionId, cwd, name });

/** 프로젝트 폴더에서 새 백그라운드 세션. worktree 를 주면 `-w <이름>` */
export const newSession = (cwd: string, name: string, worktree?: string) =>
  invoke<string>('new_session', { cwd, name, worktree: worktree ?? null });

/** 백그라운드 세션을 끈다. 대화는 남는다 */
/** 참모 고정 — <데이터>/orch-pins.json(폰과 같은 파일), 대화 id 를 고정한 순서대로 */
export const readOrchPins = () => invoke<string[]>('read_orch_pins');
export const setOrchPin = (sessionId: string, on: boolean) => invoke<string[]>('set_orch_pin', { sessionId, on });
/** 참모 맡은 일 — <데이터>/orch-roles.json(폰·이름표 훅과 같은 파일), 기본 이름(참모-3)별. name 에 별명이 붙어 있어도 된다 */
export const readOrchRoles = () => invoke<Record<string, { role: string; at: number }>>('read_orch_roles');
/** fresh = 새 참모를 띄울 때 — 옛 번호의 맡은 일을 덮고 태어난 때(born)를 적는다(그 전 기록은 안 센다) */
export const setOrchRole = (name: string, role: string, fresh = false) => invoke<Record<string, { role: string; at: number; born?: number }>>('set_orch_role', { name, role, fresh });
export const stopSession = (id: string) => invoke<string>('stop_session', { id });
/** 세션을 끄고 목록에서도 지운다(claude stop + rm). 대화 기록 파일은 남는다 */
export const removeSession = (id: string) => invoke<string>('remove_session', { id });

/** 참모 작업 기록(tasks.jsonl) 원문 */
export const readTasks = () => invoke<string>('read_tasks');

/** 세션 대화 기록 꼬리 — { sessionId: 원문 } */
/** 참모 대화 기록에서 세션 띄움·말 건 줄만, from 바이트 뒤로(처음은 0 = 전체) */
export const spawnLines = (sessionId: string, from: number) => invoke<{ lines: string[]; next: number } | null>('spawn_lines', { sessionId, from });
/** 참모가 띄운 분신(Agent) 기록 꼬리 — ids = Agent 호출 tool_use id */
export const subagentTails = (sessionId: string, ids: string[]) => invoke<{ toolUseId: string; agentId: string; mtime: number; tail: string }[]>('subagent_tails', { sessionId, ids });
export const readTranscriptTails = (sessionIds: string[]) =>
  invoke<Record<string, string>>('read_transcript_tails', { sessionIds });

/** dev 아래 프로젝트들의 CLAUDE.md·starter 상태 */
export const projectScan = (devRoot: string) => invoke<import('../domain/status').ProjectDoc[]>('project_scan', { devRoot });

/** macOS 알림 */
/** 참모세이로 읽기(음성 모드). 차례로 말한다 */
/** voice = 그 참모 목소리(M1~F5) — 설정이 Supertonic 실행기일 때만 바뀐다(Rust tts::with_voice) */
/** from = 읽는 말의 주인(참모 세션 id) — 그 참모 탭·프사가 소리 크기대로 빛난다(speakGlow) */
export const speak = (text: string, voice?: string, from?: string) => invoke<void>('speak', { text, voice: voice ?? null, from: from ?? null });
export const speakNowState = (known: number) => invoke<SayNow>('speak_now_state', { known });
/** 프사 창 들어 보기 — id 는 부를 때마다 늘리는 번호. 상태(준비 중·재생 중·끝·멈춤)는 speakPreviewState 로 묻는다 */
export const speakPreview = (id: number, text: string, voice: string) => invoke<void>('speak_preview', { id, text, voice });
export const speakPreviewState = () => invoke<{ id: number; phase: PreviewPhase }>('speak_preview_state');
export const speakPreviewStop = (id: number) => invoke<void>('speak_preview_stop', { id });
/** target = 알림을 누르면 갈 곳(domain/notify noteTarget) — 눌리면 window.__notifyClick(target) 으로 돌아온다 */
export const notify = (title: string, body: string, target: string) => invoke<void>('notify', { title, body, target });
/** 메인 창을 보고 있나(보임·최소화 아님·앞) — 윈도우 알림 판단용 */
export const mainWatched = () => invoke<boolean>('main_watched');

/** 꺼진 세션까지 포함한 `agents --json --all` 원문 */
export const listSessionsAllRaw = () => invoke<string>('list_sessions_all');

/** 꺼진 세션을 같은 대화 그대로 다시 띄운다 */
/** id = `agents --json` 의 짧은 번호 — 주면 같은 번호로 되살린다(respawn), 없으면 새 번호 복사본(--bg --resume) */
export const resumeSession = (cwd: string, sessionId: string, id?: string) => invoke<string>('resume_session', { cwd, sessionId, id: id ?? null });

/** 관리 프로그램(claude daemon) 시작 시각 ms — 바뀌면 재시작. 안 떠 있으면 null */
export const daemonStartedAt = () => invoke<number | null>('daemon_started_at');
/** 살아 있는 세션 기록 ~/.honor-orchestrator/live.json (없으면 '') */
export const readLiveSnap = () => invoke<string>('read_live_snap');
export const readSay = () => invoke<string>('read_say');
export const writeVoiceMode = (on: boolean) => invoke<void>('write_voice_mode', { on });
export const writeLiveSnap = (json: string) => invoke<void>('write_live_snap', { json });

/** 상태줄이 남긴 최신 입력(사용 한도) 원문 */
export const readUsage = () => invoke<string>('read_usage');

export type RepoToday = { name: string; commits: number; added: number; deleted: number };
/** 오늘 내가 한 커밋 (저장소별) */
/** 다마고치 먹이용 커밋 원문 (파싱은 domain/tama/sources.ts) */
export const commitLog = (devRoot: string, author: string, since: string, until?: string) =>
  invoke<string>('commit_log', { devRoot, author, since, until: until ?? null });

/** 다마고치 배틀용 GitHub Actions 실행 원문 (파싱은 domain/tama/sources.ts). since = YYYY-MM-DD */
export const ciRuns = (devRoot: string, user: string, since: string) =>
  invoke<string>('ci_runs', { devRoot, user, since });

/** 머지 가챠 저장 파일 ~/.honor-orchestrator/gacha.json (없으면 '') */
export const readGacha = () => invoke<string>('read_gacha');
export const writeGacha = (json: string) => invoke<void>('write_gacha', { json });

/** 다마고치 저장 파일 ~/.honor-orchestrator/tama.json (없으면 '') */
export const readTama = () => invoke<string>('read_tama');
export const writeTama = (json: string) => invoke<void>('write_tama', { json });
/** 테두리 없는 위젯 창 끌어 옮기기 시작 */
export const tamaDrag = () => invoke<void>('tama_drag');
/** 위젯 보이기/숨기기. 인자 없이 부르면 지금 보이는지만 */
export const tamaWidget = (visible?: boolean) => invoke<boolean>('tama_widget', { visible: visible ?? null });
/** 위젯 → 메인 창 부탁. kind 를 주면 보내고(메인 창을 앞으로), 안 주면 온 부탁을 꺼낸다 */
export const tamaRequest = (kind?: string) => invoke<string | null>('tama_request', { kind: kind ?? null });

/** 세션별 컨텍스트 사용량 파일 원문들 (파싱은 domain/ctx.ts) */
export const readCtx = () => invoke<string[]>('read_ctx');

/** 결정 대기함 답장 — 세션에 잠깐 attach 해서 글자 + Enter */
export const sendToSession = (id: string, text: string) => invoke<void>('send_to_session', { id, text });
/** 작업 기록에 이벤트 한 줄 (answer 등) */
export const appendTaskEvent = (ev: object) => invoke<void>('append_task_event', { line: JSON.stringify(ev) });

/** 권한 창 자동 허용: 화면 글자 → (domain/autoAllow 판단) → 키 */
export const sessionScreen = (id: string) => invoke<string>('session_screen', { id });
export const sendKeys = (id: string, keys: string) => invoke<void>('send_keys', { id, keys });
export const logAutoAllow = (ev: object) => invoke<void>('log_auto_allow', { line: JSON.stringify(ev) });
/** 프로젝트 이름 → HOLO MEMO 파일 내용(없으면 빈 문자열) */
export const readMemos = (names: string[]) => invoke<Record<string, string>>('read_memos', { names });
export const writeMemo = (name: string, content: string) => invoke<void>('write_memo', { name, content });
export const readLessons = (names: string[]) => invoke<Record<string, string>>('read_lessons', { names });
export const writeLessons = (name: string, content: string) => invoke<void>('write_lessons', { name, content });
export const unmirrorLesson = (project: string, lesson: string) => invoke<boolean>('unmirror_lesson', { project, lesson });
export const appendMemo = (name: string, entry: string) => invoke<void>('append_memo', { name, entry });
export const readAutoAllow = () => invoke<string>('read_auto_allow');
/** 한글 입력 진단 — <데이터 폴더>/ime-debug.on 이 있을 때만 켜진다(null = 꺼짐, 아니면 그 파일 내용) */
export const imeDebugMode = () => invoke<string | null>('ime_debug_mode');
export const imeLog = (lines: string) => invoke<void>('ime_log', { lines });

/** Dock 아이콘 뱃지 숫자 (0 이면 지움) */
export const setBadge = (count: number) => invoke<void>('set_badge', { count });

export const todayCommits = (devRoot: string, author: string, since: string) =>
  invoke<RepoToday[]>('today_commits', { devRoot, author, since });

/** ⌘+클릭 링크 열기 (url = 브라우저, file = 기본 앱) */
/** 클립보드에 글자 넣기 (Rust pbcopy — 웹뷰 clipboard API 는 입력 도중이 아니면 막힌다) */
export const writeClipboard = (text: string) => invoke<void>('clipboard_write', { text });

/** 이 앱 버전 — 새 버전 알림용 */
/** 모델 칩이 실패했을 때 그때 터미널 화면을 로컬 로그(<데이터>/pick-debug.log)에 */
export const pickLog = (text: string) => invoke<void>('pick_log', { text });
/** 채팅 뷰 스페이스가 바뀐 한 줄(종류만) — <데이터>/space-trace.log. 또 튀면 어느 길인지 보려고(2026-10-06) */
export const spaceTrace = (line: string) => invoke<void>('space_trace', { line });
/** Claude 기본값 칸(model·effortLevel·modelSettings) 떠 두기·되돌리기 — 모델 칩이 /model·/effort 를 친 뒤 "이 세션만"으로 돌린다 */
export const claudeDefaults = {
  snapshot: () => invoke<string>('claude_defaults_snapshot'),
  restore: (snap: string) => invoke<boolean>('claude_defaults_restore', { snap }),
};
/** 계정 칸 — 로그인을 칸마다 키체인에 보관해 두고 바꿔 끼운다. 토큰은 화면에 안 온다 */
export const accountsApi = {
  view: () => invoke<AccountsView>('accounts_view'),
  capture: (name?: string) => invoke<AccountsView>('accounts_capture', { name: name ?? null }),
  switchTo: (id: string) => invoke<AccountsView>('accounts_switch', { id }),
  rename: (id: string, name: string) => invoke<AccountsView>('accounts_rename', { id, name }),
  reorder: (ids: string[]) => invoke<AccountsView>('accounts_reorder', { ids }),
  remove: (id: string) => invoke<AccountsView>('accounts_remove', { id }),
  /** 자동 전환 상태 윗단 키 합치기(null = 지움) */
  autoPatch: (patch: Record<string, unknown>) => invoke<AccountsView>('accounts_auto_patch', { patch }),
  /** 상태줄 사용량 + 파일 고친 시각(ms) */
  usageAt: () => invoke<{ json: string; at: number }>('read_usage_at'),
  /** 칸마다 사용량을 그 계정 토큰으로 바로(Rust 가 토큰을 쥐고 묻는다 — 여기엔 퍼센트·시각만). live = 지금 로그인도 */
  usage: (ids: string[], live: boolean) => invoke<ApiGot[]>('accounts_usage', { ids, live }),
};
export const appVersion = () => invoke<string>('app_version');
export const openTarget = (kind: 'url' | 'file', target: string) => invoke<void>('open_target', { kind, target });

// ── 리뷰·머지 (Rust review.rs, 파싱은 domain/reviewSource.ts) ──
/** dev 아래 폴더마다 `폴더\t origin url` */
export const repoMap = (devRoot: string) => invoke<string>('repo_map', { devRoot });
/** 내가 만든 PR 검색 원문 — mergedSince(ISO) 가 없으면 열린 것, 있으면 그 뒤에 머지된 것 */
export const prSearch = (mergedSince?: string) => invoke<string>('pr_search', { mergedSince: mergedSince ?? null });
/** PR 상세 원문 여러 건(동시에). 못 읽은 건 '' */
export const prViews = (items: { repo: string; number: number }[]) => invoke<string[]>('pr_views', { items });
export const prDiff = (repo: string, number: number) => invoke<string>('pr_diff', { repo, number });
/** 스쿼시 머지 */
export const prMerge = (repo: string, number: number) => invoke<string>('pr_merge', { repo, number });
/** revert PR 을 만들기만(머지 안 함). 돌려주는 건 {"number","url"} JSON */
export const prRevert = (id: string, title: string, body: string) => invoke<string>('pr_revert', { id, title, body });
/** ~/.honor-orchestrator/review.json — 참모가 머지 전에 읽는 판정 */
export const writeReviewState = (json: string) => invoke<void>('write_review_state', { json });
export const pickFolder = (prompt: string, start?: string) => invoke<string | null>('pick_folder', { prompt, start: start ?? null });
export const notifyStatus = () => invoke<'granted' | 'denied' | 'notDetermined' | 'unavailable'>('notify_status');
export const notifyRequest = () => invoke<boolean>('notify_request');
export const notifyOpenSettings = () => invoke<void>('notify_open_settings');
/** 이 프로젝트 브라우저(chammo-browser)가 붙었나 / 붙이기 — 저장소 .mcp.json 은 안 건드린다(GitHub #2) */
export const projectBrowser = (dir: string) => invoke<import('../domain/browserNeed').BrowserLink>('project_browser', { dir });
export const projectBrowserAttach = (dir: string) => invoke<import('../domain/browserNeed').BrowserLink>('project_browser_attach', { dir });
export const harnessProject = (dir: string) => invoke<{ written: string[]; kept: string[] }>('harness_project', { dir });
export const browserStatus = () => invoke<import('../domain/setup').BrowserStatus>('browser_status');
export const browserSetupStart = () => invoke<void>('browser_setup_start');
export const browserSetupState = () => invoke<import('../domain/setup').BrowserSetupState>('browser_setup_state');
export const routinesList = () => invoke<string>('routines_list');
export const routineDo = (name: string, action: 'run' | 'pause' | 'resume' | 'remove') => invoke<string>('routine_do', { name, action });

// ── 부하 모니터(Rust load.rs). 세션별로 가르는 건 domain/load ──
export const loadSample = () => invoke<{ ps: string; sys: string }>('load_sample');
export const loadEnv = (pids: number[]) => invoke<string>('load_env', { pids });
/** 주인 없는 프로세스 끄기 — Claude 가 띄운 것만(Rust 가 확인). 끈 프로세스 수 */
export const loadKill = (pid: number) => invoke<number>('load_kill', { pid });
export const loadSave = (json: string) => invoke<void>('load_save', { json });
/** 로그인 풀림(login.rs) — 맥 로그인 상태(auth status + 로그인 칸 고친 시각) · 화면 판단을 폰에(<데이터>/login.json) */
export const loginProbe = () => invoke<unknown>('login_probe');
export const loginSave = (json: string) => invoke<void>('login_save', { json });

/** 채팅 보기용 대화 기록 이어 읽기 — from 을 안 주면 끝 1MB 부터. reset 이면 처음부터 다시 그린다 */
/** start = text 첫 줄의 파일 자리(폰이 그 앞을 거슬러 읽는다) */
export type TranscriptChunk = { text: string; next: number; reset: boolean; start?: number };
export const readTranscript = (sessionId: string, from?: number) =>
  invoke<TranscriptChunk>('read_transcript', { sessionId, from: from ?? null });

/** 세션 할 일 목록(Claude Code TaskCreate) — 다 끝나면 빈 목록 */
export type SessionTask = { id: string; subject: string; status: string; activeForm?: string };
export const readSessionTasks = (sessionId: string) => invoke<SessionTask[]>('read_session_tasks', { sessionId });

/** 여러 줄 글을 그 세션 입력칸에 치고 보낸다(스페이스 → 참모). 줄바꿈 = Option+Enter */
export const sendTextToSession = (id: string, text: string) => invoke<void>('send_text_to_session', { id, text });

/** scripts/show 기록 꼬리 — 세션마다 보여 준 파일(domain/spaceNav shownFiles) */
export const readShowLog = () => invoke<string>('read_show_log');
/** 다마고치 '대화' 먹이 — 대화 기록 id 들에 사람이 건 말의 시각(`id\t시각` 줄, 새로 붙은 줄만 읽는다) */
export const humanTurns = (sessionIds: string[]) => invoke<string>('human_turns', { sessionIds });
/** space-log.jsonl 꼬리 — 다마고치 목욕·놀아주기 */
export const readSpaceLog = () => invoke<string>('read_space_log');

/** 참모 프사(Rust avatar.rs) — 거르기는 domain/avatar parseEntries. 그림은 Array.from 으로(save_asset 과 같은 길) */
export const readAvatars = () => invoke<unknown>('avatars_read');
export const saveAvatarFile = (key: string, avatar: unknown, image: Uint8Array | null) =>
  invoke<unknown>('avatar_save', { key, avatar, image: image ? Array.from(image) : null });
export const deleteAvatarFile = (key: string) => invoke<void>('avatar_delete', { key });

/** 모바일(폰 → 테일스케일) — 켜고 끄기·짝짓기 QR·연결된 기기(Rust mobile.rs·mobile_pair.rs). 마스터 열쇠는 폰으로 안 나간다 */
/** 기기 줄 하나 = 열쇠 하나(사파리·홈 화면 앱은 따로) — group 이 같으면 같은 폰(domain/mobileDevices) */
export type MobileDevice = DeviceRow;
export type MobileStatus = { on: boolean; running: boolean; bind: string | null; error: string | null; https: boolean; httpsNote: string | null; devices: MobileDevice[] };
/** 짝짓기 QR — 10분 지나거나 한 번 쓰면 죽는다 */
export type PairQr = { url: string; qrSvg: string | null; expires: number };
export const mobileApi = {
  status: () => invoke<MobileStatus>('mobile_status'),
  set: (on: boolean) => invoke<MobileStatus>('mobile_set', { on }),
  pairNew: () => invoke<PairQr>('mobile_pair_new'),
  /** 폰 하나 끊기 — group 을 주면 그 폰의 사파리·홈 화면 앱 둘 다 */
  removeDevice: (id: string) => invoke<MobileStatus>('mobile_device_remove', { id }),
  clearDevices: () => invoke<MobileStatus>('mobile_devices_clear'),
};
