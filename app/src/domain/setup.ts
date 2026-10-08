import { wizardAccess, type Access } from './access';
import { IS_WIN } from './reader';
// 환경 점검 판단 — Claude Code 버전이 확인된 범위인가, 설정을 끝내도 되나
// Chammo 는 Claude Code 의 백그라운드 세션 기능(--bg·agents --json·attach)에 기댄다. 확인한 범위는 2.1.280 이상의 2.1.x

export type EnvCheck = {
  claudePath: string | null;
  claudeVersion: string;
  loggedIn: boolean;
  clt: boolean;
  ghPath: string | null;
  ghUser: string | null;
  /** gh 가 쓰는 계정 토큰이 깨짐(만료·취소) — 다시 로그인 필요 */
  ghStale: boolean;
};

/** "2.1.283 (Claude Code)" → [2, 1, 283]. 모양이 다르면 null */
export function parseClaudeVersion(text: string): [number, number, number] | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export const MIN_PATCH = 280;

/** ok = 확인된 범위, old = 더 옛것(업데이트 필요), new = 더 새것(아마 되지만 확인 전), unknown = 못 읽음 */
export type VersionFit = 'ok' | 'old' | 'new' | 'unknown';

export function versionFit(text: string): VersionFit {
  const v = parseClaudeVersion(text);
  if (!v) return 'unknown';
  const [major, minor, patch] = v;
  if (major < 2 || (major === 2 && minor < 1) || (major === 2 && minor === 1 && patch < MIN_PATCH)) return 'old';
  if (major === 2 && minor === 1) return 'ok';
  return 'new';
}

/** 경고 배너를 띄울까 — 버전을 못 읽었거나(claude 가 없을 땐 설정 화면이 따로 안내) 이 버전을 이미 닫았으면 안 띄운다 */
export function versionWarning(text: string, dismissed: string | null): VersionFit | null {
  const fit = versionFit(text);
  if (fit === 'ok' || fit === 'unknown') return null;
  return dismissed === text.trim() ? null : fit;
}

/** 설정을 끝낼 수 있나 — Claude Code 설치·로그인·확인된 버전 이상, 명령줄 도구(git)는 꼭. gh 는 선택 */
export const setupReady = (c: EnvCheck | null): boolean => !!c && !!c.claudePath && c.loggedIn && c.clt && versionFit(c.claudeVersion) !== 'old';

/** 셸 작은따옴표로 감싸기 — 경로·안내 문장을 명령에 그대로 넣으려고 */
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export type SetupTask = 'install' | 'update' | 'login' | 'clt' | 'ghLogin' | 'trust';

/**
 * 설정 화면의 터미널에서 돌릴 한 번짜리 명령. 끝나면 무엇을 하면 되는지 한 줄 찍는다(done).
 * claude·gh 는 찾은 절대 경로로(앱의 PATH 에 없을 수 있어서)
 */
export function setupCommand(task: SetupTask, bins: { claude?: string | null; gh?: string | null }, done: string, dir?: string, win = IS_WIN): string {
  if (win) return winSetupCommand(task, bins, done, dir);
  const tail = `; echo; echo ${shq(done)}`;
  switch (task) {
    case 'install':
      return `curl -fsSL https://claude.ai/install.sh | bash${tail}`;
    case 'update': {
      // 앱이 쓰는 그 claude 의 실제 자리로 가른다 — brew(cask) 것이면 brew upgrade, 아니면(공식 설치·npm) claude update.
      // "brew 에 하나 있나"로 가르면 공식 설치본을 두고 brew 것만 올린다(아이맥 실측: 공식 2.1.263 + brew 2.1.267)
      const c = shq(bins.claude || 'claude');
      return `R=$(readlink -f ${c} 2>/dev/null || echo ${c}); case "$R" in */Caskroom/*) B=$(command -v brew || ls /opt/homebrew/bin/brew /usr/local/bin/brew 2>/dev/null | head -1); "$B" upgrade --cask claude-code ;; *) ${c} update ;; esac${tail}`;
    }
    case 'login':
      return `${shq(bins.claude || 'claude')} auth login${tail}`;
    case 'clt':
      return `xcode-select --install${tail}`;
    case 'ghLogin':
      return `${shq(bins.gh || 'gh')} auth login${tail}`;
    case 'trust':
      // 폴더 믿기 — 그 폴더에서 claude 를 대화형으로 켠다. 뜨는 질문에 Enter(예) → 기록되면 앱이 창을 닫는다(claude 도 같이 꺼진다)
      return `cd ${shq(dir ?? '.')} && exec ${shq(bins.claude || 'claude')}`;
  }
}

/** cmd 큰따옴표 */
const dq = (s: string) => `"${s.replace(/"/g, '""')}"`;
/** cmd echo 에 그대로 찍히게 — & | < > ^ 는 ^ 로 */
const cmdEcho = (s: string) => s.replace(/[&|<>^]/g, '^$&');

/** winget 으로 깐 claude 올리기. 돌고 있는 claude(참모 세션 등)가 claude.exe 를 잡고 있으면 winget 이 옛 파일을 못 지워
 *  `Access is denied` · 0x8a150003 으로 끝났다(2026-10-01 윈도우 PC, 세션 4개). 윈도우는 실행 중인 exe 도 이름은 바뀐다 —
 *  먼저 claude.exe.old-<시각> 으로 비켜 두고 올리고, 실패하면 되돌린다. 지난번에 비켜 둔 건 지우되 아직 잠겨 있으면 넘어간다.
 *  돌던 세션은 다시 켜기 전까지 옛 버전 그대로다 */
const WIN_WINGET_UPGRADE = [
  // 진행 표시가 cmd 창에 #< CLIXML 덩어리로 깨져 나왔다(참모 PC 실측)
  "$ProgressPreference = 'SilentlyContinue'",
  "$pkg = Join-Path $env:LOCALAPPDATA 'Microsoft\\WinGet\\Packages'",
  "$dir = Get-ChildItem -LiteralPath $pkg -Directory -Filter 'Anthropic.ClaudeCode_*' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName",
  '$old = $null',
  'if ($dir) {',
  "  Get-ChildItem -LiteralPath $dir -Filter 'claude.exe.old-*' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue",
  "  $exe = Join-Path $dir 'claude.exe'",
  "  if (Test-Path -LiteralPath $exe) { $old = 'claude.exe.old-' + (Get-Date -Format 'yyyyMMddHHmmss'); Rename-Item -LiteralPath $exe -NewName $old -ErrorAction SilentlyContinue; if (Test-Path -LiteralPath $exe) { $old = $null } }",
  '}',
  'winget upgrade -e --id Anthropic.ClaudeCode --accept-source-agreements --accept-package-agreements',
  '$code = $LASTEXITCODE',
  // 0x8A15002B = '올릴 게 없다'(이미 최신) — 실패가 아니다
  'if ($code -eq -1978335189) { $code = 0 }',
  "if ($old -and -not (Test-Path -LiteralPath (Join-Path $dir 'claude.exe'))) { Rename-Item -LiteralPath (Join-Path $dir $old) -NewName 'claude.exe' -ErrorAction SilentlyContinue }",
  'exit $code',
].join('\n');

/** PowerShell -EncodedCommand 값(UTF-16LE base64) — cmd /C 안에서 따옴표·$ 를 이스케이프하지 않아도 된다 */
function psEncode(script: string): string {
  let bin = '';
  for (let i = 0; i < script.length; i++) {
    const c = script.charCodeAt(i);
    bin += String.fromCharCode(c & 0xff, c >> 8);
  }
  return btoa(bin);
}

/** 윈도우 설정 명령 — cmd /C 가 읽는다(작은따옴표·exec·; 가 안 먹어서 폴더 믿기가 "구문이 잘못됨"으로 끝났다, 윈도우판) */
function winSetupCommand(task: SetupTask, bins: { claude?: string | null; gh?: string | null }, done: string, dir?: string): string {
  const tail = done ? ` & echo. & echo ${cmdEcho(done)}` : '';
  const claude = dq(bins.claude || 'claude');
  switch (task) {
    case 'install':
      return `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"${tail}`;
    case 'update':
      // winget 으로 깐 claude(…\WinGet\Links·Packages)는 claude update 로 못 올린다 — 자기가 "winget upgrade" 하라고 한다(2026-10-01 윈도우 PC)
      if (/\\WinGet\\/i.test(bins.claude ?? '')) return `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${psEncode(WIN_WINGET_UPGRADE)}${tail}`;
      return `${claude} update${tail}`;
    case 'login':
      return `${claude} auth login${tail}`;
    case 'clt':
      return `winget install -e --id Git.Git${tail}`;
    case 'ghLogin':
      return `${dq(bins.gh || 'gh')} auth login${tail}`;
    case 'trust':
      return `cd /d ${dq((dir ?? '.').replace(/\//g, '\\'))} && ${claude}`;
  }
}

/** 첫 실행 마법사 — 한 화면에 한 단계(사용자 2026-09-28 "설정 마법사같은 거"). 설정 메뉴로 열면 한 페이지 그대로 */
export type WizardStep = 'welcome' | 'check' | 'basics' | 'features' | 'ready';
export const WIZARD: WizardStep[] = ['welcome', 'check', 'basics', 'features', 'ready'];
/** 폴더 믿음 — 프로젝트 폴더·HQ (Claude Code 가 새 폴더에선 믿기 전에 세션을 안 띄운다) */
export type Trust = { dev: boolean; hq: boolean };
/** 다음으로 넘어갈 수 있나 — 점검 단계는 Claude Code 설치·로그인·명령줄 도구가, 기본 설정 단계는 두 폴더 믿기가 다 돼야.
 *  마지막 단계는 '시작하기'라 다음이 없다 */
export function canNext(step: WizardStep, check: EnvCheck | null, trust?: Trust, access?: Access | null): boolean {
  if (step === 'check') return setupReady(check);
  // 고른 프로젝트 폴더를 맥이 막고 있으면 세션이 'Unexpected' 로만 실패한다(이슈 #1) — 여기서 멈춰 세운다
  if (step === 'basics') return !!trust?.dev && !!trust?.hq && !wizardAccess(access ?? null).block;
  return step !== 'ready';
}

/** 폴더 고르기 창이 준 절대 경로를 입력칸 모양으로 — 홈 안이면 ~/… (설정 파일에도 이렇게 저장된다) */
export function tildify(path: string, home: string): string {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const h = home.replace(/\/+$/, '');
  if (!h) return p;
  if (p === h) return '~';
  return p.startsWith(h + '/') ? '~' + p.slice(h.length) : p;
}

/** GitHub CLI 줄 — 깨진 토큰은 '로그인됨'이 아니라 다시 로그인(이름만 보고 됨이라 했다, 2026-10-05) */
export function ghRow(c: Pick<EnvCheck, 'ghPath' | 'ghUser' | 'ghStale'>): 'ok' | 'relogin' | 'login' | 'install' {
  if (c.ghStale) return 'relogin';
  if (c.ghUser) return 'ok';
  return c.ghPath ? 'login' : 'install';
}

/** macOS 알림 권한 — Rust notify_status 가 준다 */
export type NotifyStatus = 'granted' | 'denied' | 'notDetermined' | 'unavailable';

/** 마법사 기능 단계의 알림 줄. 거부는 앱이 다시 물을 수 없어서 시스템 설정으로 보낸다. 막지는 않는다(알림 없이도 앱은 돈다) */
export function notifyRow(s: NotifyStatus): { state: 'ok' | 'need' | 'opt'; action: 'request' | 'settings' | null } {
  if (s === 'granted') return { state: 'ok', action: null };
  if (s === 'notDetermined') return { state: 'need', action: 'request' };
  if (s === 'denied') return { state: 'need', action: 'settings' };
  return { state: 'opt', action: null };
}

/** Rust browser_status — 확인 목록(Node · 크롬 베타 · 도구 부품 · 시험 열기) */
export type BrowserStatus = {
  node: string | null; nodeVersion: string; nodeOk: boolean; nodeSource: 'system' | 'ours' | '';
  installed: boolean; chrome: boolean; chromeBeta: boolean; checked: boolean; ready: boolean;
};
export type BrowserStep = 'node' | 'chrome' | 'parts' | 'check';
/** Rust browser_setup_state — '설치' 한 바퀴의 진행 */
/** note = 끝났는데 남은 것 한 줄(맥 권한 창 답 대기 등) — 완료는 막지 않는다 */
export type BrowserSetupState = { running: boolean; step: BrowserStep | null; pct: number | null; text: string; error: string | null; done: boolean; note?: string | null };

/** 브라우저 자동화 줄 — 막지 않는 선택 기능. 하나라도 없으면 '설치' 하나(Node·크롬 베타까지 앱이 받는다), 실패하면 '다시 시도' */
export function browserRow(s: BrowserStatus | null, run: BrowserSetupState | null): { state: 'ok' | 'opt'; action: 'install' | 'retry' | null; busy: boolean } {
  if (run?.running) return { state: 'opt', action: null, busy: true };
  if (!s) return { state: 'opt', action: null, busy: false };
  if (s.ready) return { state: 'ok', action: null, busy: false };
  return { state: 'opt', action: run?.error ? 'retry' : 'install', busy: false };
}

/** 확인 목록 네 칸 — ok 있음 · now 지금 하는 중 · fail 여기서 멈춤 · todo 받을 것 */
export function browserChecklist(s: BrowserStatus | null, run: BrowserSetupState | null): { key: BrowserStep; state: 'ok' | 'now' | 'fail' | 'todo' }[] {
  const have: Record<BrowserStep, boolean> = { node: !!s?.nodeOk, chrome: !!s?.chromeBeta, parts: !!s?.installed, check: !!s?.checked };
  return (['node', 'chrome', 'parts', 'check'] as const).map((key) => ({
    key,
    state: run?.step === key && run.running ? 'now' : run?.step === key && run.error ? 'fail' : have[key] ? 'ok' : 'todo',
  }));
}

/**
 * 프로젝트 폴더(devRoot) 밖 폴더를 프로젝트로 하나 추가 — 옮길 수 없는 폴더(아이맥 ~/automation/… 등, 2026-09-28 사용자).
 * picked = 폴더 고르기 창이 준 절대 경로. 결과 목록은 `~/…` 모양. note: dup 이미 있음 · inside 프로젝트 폴더 안이라 이미 보임 · root 프로젝트 폴더 자체·홈 전체
 */
export function addExtraProject(list: string[], picked: string, devRoot: string, home: string): { list: string[]; note?: 'dup' | 'inside' | 'root' } {
  const p = tildify(picked, home);
  const root = tildify(devRoot.replace(/^~(?=\/|$)/, home), home);
  if (p === '~' || p === '/' || p === root) return { list, note: 'root' };
  if (p.startsWith(root + '/')) return { list, note: 'inside' };
  if (list.some((x) => tildify(x.replace(/^~(?=\/|$)/, home), home) === p)) return { list, note: 'dup' };
  return { list: [...list, p] };
}
