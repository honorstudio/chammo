// Rust 커맨드 호출을 한 곳에 모은다. UI 는 이 파일만 알고, invoke 이름은 여기서만 쓴다.
import { Channel, invoke } from '@tauri-apps/api/core';
import type { Features } from '../domain/config';

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

export const getAppEnv = () => invoke<AppEnv>('app_env');

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

/** 터미널 대화형 세션을 끝내고 같은 대화를 백그라운드로 이어간다. 돌려주는 건 `claude --bg` 출력 */
export const adoptSession = (pid: number, sessionId: string, cwd: string, name: string) =>
  invoke<string>('adopt_session', { pid, sessionId, cwd, name });

/** 프로젝트 폴더에서 새 백그라운드 세션. worktree 를 주면 `-w <이름>` */
export const newSession = (cwd: string, name: string, worktree?: string) =>
  invoke<string>('new_session', { cwd, name, worktree: worktree ?? null });

/** 백그라운드 세션을 끈다. 대화는 남는다 */
export const stopSession = (id: string) => invoke<string>('stop_session', { id });

/** 참모 작업 기록(tasks.jsonl) 원문 */
export const readTasks = () => invoke<string>('read_tasks');

/** 세션 대화 기록 꼬리 — { sessionId: 원문 } */
export const readTranscriptTails = (sessionIds: string[]) =>
  invoke<Record<string, string>>('read_transcript_tails', { sessionIds });

/** dev 아래 프로젝트들의 CLAUDE.md·starter 상태 */
export const projectScan = (devRoot: string) => invoke<import('../domain/status').ProjectDoc[]>('project_scan', { devRoot });

/** macOS 알림 */
/** 참모세이로 읽기(음성 모드). 차례로 말한다 */
export const speak = (text: string) => invoke<void>('speak', { text });
/** target = 알림을 누르면 갈 곳(domain/notify noteTarget) — 눌리면 window.__notifyClick(target) 으로 돌아온다 */
export const notify = (title: string, body: string, target: string) => invoke<void>('notify', { title, body, target });

/** 꺼진 세션까지 포함한 `agents --json --all` 원문 */
export const listSessionsAllRaw = () => invoke<string>('list_sessions_all');

/** 꺼진 세션을 같은 대화 그대로 다시 띄운다 */
export const resumeSession = (cwd: string, sessionId: string) => invoke<string>('resume_session', { cwd, sessionId });

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
export const tamaMore = () => invoke<void>('tama_more');
export const harnessProject = (dir: string) => invoke<{ written: string[]; kept: string[] }>('harness_project', { dir });
export const browserStatus = () => invoke<import('../domain/setup').BrowserStatus>('browser_status');
export const browserInstallCommand = () => invoke<string>('browser_install_command');
export const routinesList = () => invoke<string>('routines_list');
export const routineDo = (name: string, action: 'run' | 'pause' | 'resume' | 'remove') => invoke<string>('routine_do', { name, action });

// ── 부하 모니터(Rust load.rs). 세션별로 가르는 건 domain/load ──
export const loadSample = () => invoke<{ ps: string; sys: string }>('load_sample');
export const loadEnv = (pids: number[]) => invoke<string>('load_env', { pids });
/** 주인 없는 프로세스 끄기 — Claude 가 띄운 것만(Rust 가 확인). 끈 프로세스 수 */
export const loadKill = (pid: number) => invoke<number>('load_kill', { pid });
export const loadSave = (json: string) => invoke<void>('load_save', { json });
