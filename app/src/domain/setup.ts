import { tr } from '../i18n';
import { IS_WIN } from './reader';
import { pathKey } from './paths';
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
  /** 끊긴 winget 업그레이드가 남긴 claude.exe.old-* 를 이번 점검에서 되살렸으면 그 이름(윈도우) */
  claudeRestored?: string | null;
  /** 파이썬 3(윈도우만 판정 — scripts/*·참모 앱·예약이 쓴다). 맥은 늘 true */
  python?: boolean;
  /** 로그인 확인이 10초 안에 안 끝남 — 안 됨이 아니라 모름(느린 PC 첫 실행, win-env M2) */
  loginUnknown?: boolean;
  /** 윈도우 winget 이 도나 — git·파이썬이 없을 때만 잰다(없으면 받기 링크로, win-env H3) */
  winget?: boolean;
  /** git 전역 이름·메일(git 이 있을 때만 잰다, 없으면 '') — 새 PC 는 비어 새 프로젝트마다 첫 커밋을 못 했다(win-first M1) */
  gitName?: string;
  gitEmail?: string;
};

/** git 이름·메일 줄 — git 이 없으면(그 줄이 묻는다)·옛 점검 결과(칸 없음)·'코드 프로젝트에 git 쓰기'를 끈 사람(gitOn, ADR 0024)이면 숨김 */
export const gitIdentityRow = (c: Pick<EnvCheck, 'clt' | 'gitName' | 'gitEmail'>, gitOn = true): 'ok' | 'need' | 'hidden' =>
  !gitOn || !c.clt || c.gitName === undefined ? 'hidden' : c.gitName.trim() && (c.gitEmail ?? '').trim() ? 'ok' : 'need';

/** 입력 검사 — 앱 Rust(setup::git_identity_ok)와 같은 규칙. 'name'·'email' = 어느 칸이 틀렸나 */
export function gitIdentityError(name: string, email: string): 'name' | 'email' | null {
  const n = name.trim(), e = email.trim();
  if (!n || n.length > 100 || /[\u0000-\u001f\u007f]/.test(n)) return 'name';
  if (e.length > 200 || e.endsWith('.') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'email';
  return null;
}

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

/** 사람이 '나중에 하기'로 넘길 수 있는 것 — 윈도우 git·파이썬(관리자 권한·winget 없는 회사 PC, win-env H3), git 이름·메일 */
export type SkipKey = SetupTask | 'gitId';

/** Claude 로그인 줄 — 확인이 시간 안에 안 끝났으면 '로그인 필요'가 아니라 '다시 확인'(win-env M2) */
export const loginRow = (c: Pick<EnvCheck, 'loggedIn' | 'loginUnknown'>): 'ok' | 'need' | 'unknown' => (c.loggedIn ? 'ok' : c.loginUnknown ? 'unknown' : 'need');

/** 윈도우 git·파이썬을 직접 받는 곳(winget 이 없거나 관리자 권한이 없을 때 — 공식 설치기는 '이 사용자만'을 고를 수 있다) */
export const GET_URL = { clt: 'https://git-scm.com/download/win', python: 'https://www.python.org/downloads/windows/' } as const;

/** 화면 언어를 모를 때(시험) 쓰는 기본 문구 — Setup 이 tr 로 넘긴다 */
const WIN_NOTES: WinNotes = { busy: 'Claude is running ({0}) — those sessions keep the old version until restarted.', back: 'Update failed — restored the previous version.' };

/** 윈도우 설치·업데이트 터미널 안내 줄(화면 언어) — 마법사와 'Claude 다시 설치' 카드가 같이 쓴다. {0} = 돌고 있는 claude 수.
 *  fetch 가 없으면 설치 스크립트가 200MB 를 받는 몇 분 동안 터미널이 빈 채였다(2026-11-01 win-first M2, 카드 쪽은 같은 날 시험판 실측) */
export const winSetupNotes = (): WinNotes => ({
  busy: tr('Claude 가 {0}개 돌고 있어요(세션). 업데이트는 하지만 그 세션들은 다시 켜기 전까지 옛 버전이에요.', 'Claude is running ({0}, your sessions). Updating anyway — those sessions keep the old version until restarted.'),
  back: tr('업데이트 실패, 이전 판으로 되돌렸어요.', 'Update failed — restored the previous version.'),
  fetch: tr('공식 설치 파일을 받고 있어요. 약 200MB라서 망에 따라 몇 분 걸릴 수 있어요. 받는 동안 화면에 글이 안 나올 수 있으니 창을 닫지 마세요.', 'Downloading the official installer, about 200 MB. It can take a few minutes depending on your network. The screen may stay quiet while it downloads, so do not close this window.'),
});

/** 설정 터미널 명령이 실패로 끝났을 때 마지막에 찍는 줄 — 성공 줄(done)과 갈라 찍는다(2026-11-01 win-first M3: & 로 이어 실패해도 '끝났어요'였다).
 *  setupFailed 가 터미널이 닫힐 때 화면에서 이 줄을 찾는다(설치 실패를 '깔렸는데 못 찾아요'로 말하지 않게) */
export const setupFailLine = () => tr('명령이 실패로 끝났어요. 위에 나온 글을 읽고 다시 눌러 보세요.', 'The command failed. Read the message above and try again.');

/** 터미널 화면(onExit) 에 실패 줄이 있나 = 앞 명령이 0 아닌 코드로 끝났다 */
export const setupFailed = (screen: string, fail: string = setupFailLine()) => !!screen && screen.includes(fail);

/** 셸 작은따옴표로 감싸기 — 경로·안내 문장을 명령에 그대로 넣으려고 */
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export type SetupTask = 'install' | 'update' | 'login' | 'clt' | 'python' | 'ghLogin';

/**
 * 설정 화면의 터미널에서 돌릴 한 번짜리 명령. 끝나면 무엇을 하면 되는지 한 줄 찍는다(done).
 * claude·gh 는 찾은 절대 경로로(앱의 PATH 에 없을 수 있어서)
 */
export function setupCommand(task: SetupTask, bins: { claude?: string | null; gh?: string | null; getter?: string | null }, done: string, _dir?: string, win = IS_WIN, notes: WinNotes = WIN_NOTES, fail: string = setupFailLine()): string {
  if (win) return winSetupCommand(task, bins, done, notes, fail);
  const tail = `; r=$?; echo; if [ $r -eq 0 ]; then echo ${shq(done)}; else echo ${shq(fail)}; fi`;
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
    // 맥 — 명령줄 도구 대신 앱이 받는다(base_tools, ADR 0027)
    case 'clt':
      return `${shq(bins.getter || 'chammo-get-tool')} git${tail}`;
    case 'python':
      return `${shq(bins.getter || 'chammo-get-tool')} python${tail}`;
    case 'ghLogin':
      return `${shq(bins.gh || 'gh')} auth login${tail}`;
  }
}

/** cmd 큰따옴표 */
const dq = (s: string) => `"${s.replace(/"/g, '""')}"`;
/** cmd echo 에 그대로 찍히게 — & | < > ^ 는 ^ 로. ( ) 도 — 끝 안내가 괄호 묶음 안에 들어간다 */
const cmdEcho = (s: string) => s.replace(/[&|<>^()]/g, '^$&');

/** winget 업데이트 터미널에 찍을 두 줄 — busy 의 {0} 은 돌고 있는 claude 수. fetch = 설치 스크립트가 받는 동안 먼저 찍는 한 줄 */
export type WinNotes = { busy: string; back: string; fetch?: string };

/** PowerShell 작은따옴표 글자 */
const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** winget 으로 깐 claude 올리기. 돌고 있는 claude(참모 세션 등)가 claude.exe 를 잡고 있으면 winget 이 옛 파일을 못 지워
 *  `Access is denied` · 0x8a150003 으로 끝났다(2026-10-01 윈도우 PC, 세션 4개). 윈도우는 실행 중인 exe 도 이름은 바뀐다 —
 *  먼저 claude.exe.old-<시각> 으로 비켜 두고 올린다. 돌던 세션은 다시 켜기 전까지 옛 버전 그대로라 먼저 알린다.
 *  winget 이 중간에 죽으면(2026-10-20 윈도우 시험 PC — 로그가 3초 만에 끊김) .old 만 남아 claude 가 사라진다 —
 *  끝나면 claude.exe 가 실제로 도는지 보고 아니면 가장 새 .old 로 되돌린다. 다음 번엔 .old 를 지우기 전에 먼저 되살린다
 *  (스크립트째 죽은 경우는 앱 점검·켤 때 Rust claude_src::heal 이 되살린다) */
const winWingetUpgrade = (n: WinNotes) => [
  // 진행 표시가 cmd 창에 #< CLIXML 덩어리로 깨져 나왔다(참모 PC 실측)
  "$ProgressPreference = 'SilentlyContinue'",
  "$pkg = Join-Path $env:LOCALAPPDATA 'Microsoft\\WinGet\\Packages'",
  "$dir = Get-ChildItem -LiteralPath $pkg -Directory -Filter 'Anthropic.ClaudeCode_*' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName",
  '$busy = @(Get-Process -Name claude -ErrorAction SilentlyContinue).Count',
  `if ($busy -gt 0) { Write-Output (${psq(n.busy)} -f $busy) }`,
  '$old = $null',
  'if ($dir) {',
  "  $exe = Join-Path $dir 'claude.exe'",
  "  if (-not (Test-Path -LiteralPath $exe)) { $last = Get-ChildItem -LiteralPath $dir -Filter 'claude.exe.old-*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1; if ($last) { Copy-Item -LiteralPath $last.FullName -Destination $exe -Force -ErrorAction SilentlyContinue } }",
  "  if (Test-Path -LiteralPath $exe) { Get-ChildItem -LiteralPath $dir -Filter 'claude.exe.old-*' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue }",
  "  if (Test-Path -LiteralPath $exe) { $old = 'claude.exe.old-' + (Get-Date -Format 'yyyyMMddHHmmss'); Rename-Item -LiteralPath $exe -NewName $old -ErrorAction SilentlyContinue; if (Test-Path -LiteralPath $exe) { $old = $null } }",
  '}',
  'winget upgrade -e --id Anthropic.ClaudeCode --accept-source-agreements --accept-package-agreements',
  '$code = $LASTEXITCODE',
  // 0x8A15002B = '올릴 게 없다'(이미 최신) — 실패가 아니다
  '$latest = $code -eq -1978335189',
  'if ($latest) { $code = 0 }',
  'if ($dir) {',
  "  $exe = Join-Path $dir 'claude.exe'",
  '  $ok = $false',
  // 깨진 파일은 '실행 실패'를 던지고 $LASTEXITCODE 엔 winget 값이 남는다 — try 로 받아 실패로 친다
  '  if (Test-Path -LiteralPath $exe) { try { & $exe --version *> $null; $ok = $LASTEXITCODE -eq 0 } catch { $ok = $false } }',
  '  if (-not $ok) {',
  "    $last = Get-ChildItem -LiteralPath $dir -Filter 'claude.exe.old-*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1",
  '    if ($last) {',
  '      Remove-Item -LiteralPath $exe -Force -ErrorAction SilentlyContinue',
  '      Copy-Item -LiteralPath $last.FullName -Destination $exe -Force -ErrorAction SilentlyContinue',
  `      if (-not $latest) { Write-Output ${psq(n.back)}; if ($code -eq 0) { $code = 1 } }`,
  '    }',
  '  }',
  '}',
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
function winSetupCommand(task: SetupTask, bins: { claude?: string | null; gh?: string | null }, done: string, notes: WinNotes, fail: string): string {
  // && / || 는 & 보다 먼저 묶인다 — 'echo 받는 중 & 명령 && (성공) || (실패)' 는 명령의 종료 코드로 갈린다(winget 의 음수 코드도 실패)
  const tail = done ? ` && (echo.& echo ${cmdEcho(done)}) || (echo.& echo ${cmdEcho(fail)})` : '';
  const claude = dq(bins.claude || 'claude');
  switch (task) {
    case 'install': {
      // 받는 동안 한 줄을 먼저 — PS5 진행 표시는 ConPTY 에 안 그려져 12분 동안 빈 칸만 보였다(2026-11-01 win-first M2). 진행 표시 끄기는 winInstall 이 한다
      const head = notes.fetch ? `echo ${cmdEcho(notes.fetch)} & ` : '';
      return `${head}powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${psEncode(winInstall())}${tail}`;
    }
    case 'update':
      // winget 으로 깐 claude(…\WinGet\Links·Packages)는 claude update 로 못 올린다 — 자기가 "winget upgrade" 하라고 한다(2026-10-01 윈도우 PC)
      if (/\\WinGet\\/i.test(bins.claude ?? '')) return `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${psEncode(winWingetUpgrade(notes))}${tail}`;
      if (/\\npm\\/i.test(bins.claude ?? '')) return `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${psEncode(winNpmUpdate(bins.claude ?? 'claude'))}${tail}`;
      return `${claude} update${tail}`;
    case 'login':
      return `${claude} auth login${tail}`;
    case 'clt':
      // 사용자 범위 — 기본(모든 사용자)은 관리자 창이 떠서 회사 PC 에서 막혔다. 동의 플래그가 없으면 처음 쓰는 winget 이 [Y/N] 에서 멈춘다(win-env H3·L3)
      return `winget install -e --id Git.Git --scope user --accept-source-agreements --accept-package-agreements${tail}`;
    case 'python':
      // 사용자 범위 = 설치기가 사용자 PATH 앞에 붙인다(InstallAllUsers=0 PrependPath=1). py 런처는 기본이 '모든 사용자'(InstallLauncherAllUsers=1)라
      // 관리자 창이 뜬다 — 이 사용자에게만 깔게 한다. 끝나면 앱이 PATH 를 다시 읽는다
      return `winget install -e --id Python.Python.3.12 --scope user --custom "InstallLauncherAllUsers=0" --accept-source-agreements --accept-package-agreements${tail}`;
    case 'ghLogin':
      return `${dq(bins.gh || 'gh')} auth login${tail}`;
  }
}

/** 공식 설치 — 대상 exe 가 빠진 npm 판(10-31 사용자 PC)이 있으면 먼저 지운다. 안 지우면 PATH 앞쪽의 깨진 바로가기를
 *  참모(Git Bash 의 claude)·scripts 가 계속 잡았다(win-env H2). 멀쩡한 npm 판은 건드리지 않는다 */
const winInstall = () => [
  "$ProgressPreference = 'SilentlyContinue'",
  "$npm = Join-Path $env:APPDATA 'npm'",
  "$shim = Join-Path $npm 'claude.cmd'",
  "$pkg = Join-Path $npm 'node_modules\\@anthropic-ai\\claude-code'",
  "$exe = Join-Path $pkg 'bin\\claude.exe'",
  "$js = Join-Path $pkg 'cli.js'",
  'if ((Test-Path -LiteralPath $shim) -and -not (Test-Path -LiteralPath $exe) -and -not (Test-Path -LiteralPath $js)) {',
  `  Write-Output ${psq(tr('예전에 npm으로 설치한 Claude Code가 깨져 있어요(실행 파일이 없어요). 새로 설치하기 전에 먼저 지울게요.', 'The Claude Code you installed earlier with npm is broken (its executable is missing). Removing it before installing a fresh copy.'))}`,
  '  if (Get-Command npm -ErrorAction SilentlyContinue) { npm uninstall -g @anthropic-ai/claude-code }',
  "  'claude', 'claude.cmd', 'claude.ps1' | ForEach-Object { Remove-Item -LiteralPath (Join-Path $npm $_) -Force -ErrorAction SilentlyContinue }",
  '}',
  'irm https://claude.ai/install.ps1 | iex',
].join('\n');

/** npm 판 업데이트 — 도는 claude 가 node_modules 안 claude.exe 를 잡아 npm 이 EPERM·EBUSY 로 끝난다(winget 0x8a150003 과 같은 윈도우 잠금, win-env M7).
 *  먼저 도는 수를 알리고, 실패하면 왜일 수 있는지와 공식 설치로 바꾸는 길을 한 줄 */
const winNpmUpdate = (claude: string) => [
  "$ProgressPreference = 'SilentlyContinue'",
  '$busy = @(Get-Process -Name claude -ErrorAction SilentlyContinue).Count',
  `if ($busy -gt 0) { Write-Output (${psq(tr('npm으로 설치한 Claude Code가 {0}개 실행 중이에요. 실행 중에는 파일이 잠겨 업데이트가 실패할 수 있어요 — 돌고 있는 세션은 다시 켜기 전까지 옛 버전이에요.', '{0} Claude Code instance(s) installed with npm are running. Their files are locked while running, so the update may fail. Running sessions stay on the old version until you restart them.'))} -f $busy) }`,
  `& ${psq(claude)} update`,
  '$code = $LASTEXITCODE',
  `if ($code -ne 0) { Write-Output ${psq(tr("업데이트하지 못했어요. 돌고 있는 세션이 파일을 잡고 있었을 수 있어요 — 세션을 끄고 다시 해 보거나, 점검 화면에서 '설치하기'를 눌러 공식 설치판으로 바꿔 주세요.", 'The update failed. A running session may have been holding the files. Stop your sessions and try again, or press "Install" on the check screen to switch to the official version.'))} }`,
  'exit $code',
].join('\n');

/** 윈도우 git·파이썬 줄의 상태 — 설치를 돌렸는데 실패했으면 failed(터미널 종료 코드), winget 이 없으면 noWinget(받기 링크),
 *  성공했는데도 못 찾으면 notFound(껐다 켜기). 전엔 실패도 '깔렸는데 못 찾아요'라 껐다 켜도 그대로였다(win-env H3) */
export function installState(o: { win: boolean; tried: boolean; running: boolean; ok: boolean; failed: boolean; winget?: boolean }): 'ok' | 'need' | 'noWinget' | 'failed' | 'notFound' {
  if (o.ok) return 'ok';
  if (!o.win || o.running) return 'need';
  if (o.winget === false) return 'noWinget';
  if (!o.tried) return 'need';
  return o.failed ? 'failed' : 'notFound';
}

/** 폴더 믿음 — 프로젝트 폴더·HQ (Claude Code 가 새 폴더에선 믿기 전에 세션을 안 띄운다) */
export type Trust = { dev: boolean; hq: boolean };
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

/** 손쉬운 사용 줄 — 앱은 맥 권한 창을 스스로 띄우지 않는다(2026-10-19), 꺼져 있으면 설정 열기만 */
export function axRow(trusted: boolean): { state: 'ok' | 'opt'; action: 'settings' | null } {
  // 꺼져 있어도 선택(빈 동그라미) — '나중에 해도 돼요'인데 빨간 ✕ 라 오류처럼 보였다(2026-11-01 ux-start M3)
  return trusted ? { state: 'ok', action: null } : { state: 'opt', action: 'settings' };
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

/** 참모 브라우저 줄 — 필수(사용자 11-05, 첫 설치가 깔고, 안 깔린 옛 사용자는 여기서). 하나라도 없으면 '설치' 하나(Node·크롬 베타까지 앱이 받는다), 실패하면 '다시 시도' */
export function browserRow(s: BrowserStatus | null, run: BrowserSetupState | null): { state: 'ok' | 'need'; action: 'install' | 'retry' | null; busy: boolean } {
  if (run?.running) return { state: 'need', action: null, busy: true };
  if (!s) return { state: 'need', action: null, busy: false };
  if (s.ready) return { state: 'ok', action: null, busy: false };
  return { state: 'need', action: run?.error ? 'retry' : 'install', busy: false };
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

/** 열어도 되는 폴더(설정 › 참모)에 하나 더하기 — 공개 이슈 #19(윈도우 일 파일은 D:\Desktop). 앱 outside::open_roots 와 같은 규칙:
 *  홈을 품은 곳(/·C:\·C:\Users)은 디스크 통째라 안 받고, 홈 안은 이미 열려 있다. 다른 드라이브 맨 위(D:\)는 받는다. 경로는 고른 모양 그대로 */
export function addOpenFolder(list: string[], picked: string, home: string): { list: string[]; note?: 'dup' | 'inside' | 'holds-home' } {
  const raw = picked.trim();
  if (!raw) return { list };
  const k = pathKey(raw);
  const h = pathKey(home);
  const within = (a: string, b: string) => a === b || a.startsWith(`${b}/`);
  if (within(h, k)) return { list, note: 'holds-home' };
  if (within(k, h)) return { list, note: 'inside' };
  if (list.some((x) => pathKey(x) === k)) return { list, note: 'dup' };
  return { list: [...list, raw] };
}

/** 점검의 Claude 로그인 줄 */
export const claudeSignedInText = (): string => tr(
  'Claude Code 로그인이 확인됐어요. 세션들이 이 로그인을 그대로 써요.',
  'Claude Code sign-in confirmed. Your sessions use this sign-in as is.',
);

/** 첫 설정을 마칠 때 적을 참모 이름 — 영어 기본 이름이 앱 이름(Chammo)과 같아 "Create a new Chammo"가 됐다(2026-11-01 ux-start M2).
 *  새 영어 설치만 Assistant 를 적는다 — 이미 쓰는 사람의 빈 이름(기본 Chammo)은 그대로라 기존 세션 이름(Chammo·Chammo-2)을 안 건드린다 */
export const firstRunName = (typed: string, lang: string): string => typed.trim() || (lang === 'en' ? 'Assistant' : '');
