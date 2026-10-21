import { describe, expect, it } from 'vitest';
import { addExtraProject, parseClaudeVersion, setupCommand, setupReady, shq, versionFit, versionWarning, type EnvCheck, WIZARD, canNext, nextWhy, trustExitNote, tildify, notifyRow, browserRow, browserChecklist, ghRow, gitStillMissing } from './setup';

describe('Claude Code 버전', () => {
  it('버전 글자를 숫자로', () => {
    expect(parseClaudeVersion('2.1.283 (Claude Code)')).toEqual([2, 1, 283]);
    expect(parseClaudeVersion('')).toBeNull();
    expect(parseClaudeVersion('claude: command not found')).toBeNull();
  });

  it('2.1.280 이상의 2.1.x 만 확인된 범위', () => {
    expect(versionFit('2.1.280 (Claude Code)')).toBe('ok');
    expect(versionFit('2.1.299')).toBe('ok');
    expect(versionFit('2.1.279')).toBe('old');
    expect(versionFit('2.0.999')).toBe('old');
    expect(versionFit('1.9.300')).toBe('old');
    expect(versionFit('2.2.0')).toBe('new');
    expect(versionFit('3.0.1')).toBe('new');
    expect(versionFit('')).toBe('unknown');
  });

  it('경고는 범위 밖일 때만, 닫은 버전은 다시 안 띄운다', () => {
    expect(versionWarning('2.1.283 (Claude Code)', null)).toBeNull();
    expect(versionWarning('', null)).toBeNull();
    expect(versionWarning('2.1.100 (Claude Code)', null)).toBe('old');
    expect(versionWarning('2.1.100 (Claude Code)', '2.1.100 (Claude Code)')).toBeNull();
    expect(versionWarning('2.2.0 (Claude Code)', '2.1.100 (Claude Code)')).toBe('new');
  });
});

describe('setupReady — 설정을 끝낼 수 있나', () => {
  const ok: EnvCheck = { claudePath: '/h/.local/bin/claude', claudeVersion: '2.1.283', loggedIn: true, clt: true, ghPath: null, ghUser: null, ghStale: false };
  it('Claude Code 설치·로그인·명령줄 도구가 다 있어야 한다. gh 는 없어도 된다', () => {
    expect(setupReady(ok)).toBe(true);
    expect(setupReady(null)).toBe(false);
    expect(setupReady({ ...ok, claudePath: null })).toBe(false);
    expect(setupReady({ ...ok, loggedIn: false })).toBe(false);
    expect(setupReady({ ...ok, clt: false })).toBe(false);
  });
  it('윈도우에 파이썬 3 이 없으면(python: false) 못 끝낸다 — scripts/*·참모 앱·예약이 파이썬이다. 옛 점검 답(칸 없음)은 막지 않는다', () => {
    expect(setupReady({ ...ok, python: false })).toBe(false);
    expect(setupReady({ ...ok, python: true })).toBe(true);
    expect(setupReady(ok)).toBe(true);
    expect(canNext('check', { ...ok, python: false })).toBe(false);
  });
});

describe('setupCommand — 설정 화면 터미널에서 돌릴 명령', () => {
  it('작은따옴표 감싸기', () => {
    expect(shq("it's")).toBe(`'it'\\''s'`);
    expect(shq('/My Apps/claude')).toBe("'/My Apps/claude'");
  });

  it('설치·로그인·명령줄 도구·gh, 끝나면 안내 한 줄', () => {
    expect(setupCommand('install', {}, '끝')).toBe("curl -fsSL https://claude.ai/install.sh | bash; echo; echo '끝'");
    expect(setupCommand('login', { claude: '/h/.local/bin/claude' }, 'done')).toBe("'/h/.local/bin/claude' auth login; echo; echo 'done'");
    expect(setupCommand('login', {}, 'd')).toBe("'claude' auth login; echo; echo 'd'");
    expect(setupCommand('clt', {}, 'd')).toBe("xcode-select --install; echo; echo 'd'");
    expect(setupCommand('ghLogin', { gh: '/opt/homebrew/bin/gh' }, 'd')).toBe("'/opt/homebrew/bin/gh' auth login; echo; echo 'd'");
  });
});

describe('wizard — 첫 실행 마법사 단계(환영·점검·기본·기능·시작)', () => {
  const ok = { claudePath: '/c', loggedIn: true, clt: true } as unknown as EnvCheck;
  const noLogin = { claudePath: '/c', loggedIn: false, clt: true } as unknown as EnvCheck;
  it('다섯 단계, 점검 단계는 필수가 다 돼야 다음', () => {
    expect(WIZARD).toEqual(['welcome', 'check', 'basics', 'features', 'ready']);
    expect(canNext('welcome', null)).toBe(true);
    expect(canNext('check', null)).toBe(false);
    expect(canNext('check', noLogin)).toBe(false);
    expect(canNext('check', ok)).toBe(true);
    expect(canNext('basics', ok, { dev: true, hq: true })).toBe(true);
    expect(canNext('ready', ok)).toBe(false); // 마지막은 '시작하기'
  });
});

describe('폴더 믿기 — 새 폴더에서 claude --bg 가 "Workspace not trusted" 로 멈추던 것(2026-09-28 실측)', () => {
  const ok = { claudePath: '/c', loggedIn: true, clt: true } as unknown as EnvCheck;
  it('믿기 명령 = 그 폴더에서 claude 를 대화형으로(믿음이 기록되면 앱이 창을 닫는다)', () => {
    expect(setupCommand('trust', { claude: '/bin/claude' }, '끝', "/u/my dev")).toBe("cd '/u/my dev' && exec '/bin/claude'");
  });
  it('기본 설정 단계는 프로젝트 폴더·HQ 둘 다 믿어야 다음', () => {
    expect(canNext('basics', ok, { dev: true, hq: false })).toBe(false);
    expect(canNext('basics', ok, { dev: true, hq: true })).toBe(true);
    expect(canNext('basics', ok)).toBe(false);
  });
});

describe('nextWhy — 다음이 꺼진 까닭을 단추 옆에(2026-10-22 첫 사용자 QA 17: 믿기 줄이 창 아래라 왜 꺼졌는지 몰랐다)', () => {
  const ok = { claudePath: '/c', loggedIn: true, clt: true, python: true } as unknown as EnvCheck;
  it('재현: 기본 설정 단계에서 믿기가 남았으면 그 말', () => {
    expect(nextWhy('basics', ok, { dev: true, hq: false }, null, false)).toMatch(/믿기/);
    expect(nextWhy('basics', ok, undefined, null, false)).toMatch(/믿기/);
    // 까닭 줄은 단추 위 — 믿기 두 줄은 그보다 위에 있다(QA 2차 '아래 두 폴더')
    expect(nextWhy('basics', ok, undefined, null, false)).toMatch(/^위 /);
  });
  it('폴더가 막혀 있으면 그것부터', () => {
    expect(nextWhy('basics', ok, { dev: true, hq: true }, { state: 'denied' } as never, false)).toMatch(/프로젝트 폴더/);
  });
  it('다 됐으면 없음, 점검 단계는 맥·윈도우 따로', () => {
    expect(nextWhy('basics', ok, { dev: true, hq: true }, null, false)).toBeNull();
    expect(nextWhy('check', null, undefined, null, true)).toMatch(/파이썬/);
    expect(nextWhy('check', null, undefined, null, false)).toMatch(/명령줄 도구/);
    expect(nextWhy('welcome', null, undefined, null, false)).toBeNull();
  });
});

describe('trustExitNote — 믿기 터미널이 믿지 않고 끝났을 때 한 줄(2026-10-22 첫 사용자 QA 7)', () => {
  const asked = 'Accessing workspace:\n\n/u/dev\n\nQuick safety check: Is this a project you created or one you trust?\n❯ 1. Yes, I trust this folder\n  2. No, exit';
  it('질문을 보고 No 로 끝났으면 Yes 를 고르라고', () => expect(trustExitNote(asked)).toMatch(/Yes, I trust this folder/));
  it('재현: 질문 전에 끝났는데(실행 실패) Yes 를 고르라고 했다 — 마지막 줄을 보여 준다', () => {
    const n = trustExitNote('zsh: command not found: claude\n');
    expect(n).not.toMatch(/Yes, I trust/);
    expect(n).toContain('zsh: command not found: claude');
  });
  it('로그인이 안 됐으면 로그인부터', () => expect(trustExitNote('Invalid API key · Please run /login\n')).toMatch(/로그인/));
});

describe('폴더 고르기 결과를 입력칸 모양으로', () => {
  it('홈 안이면 ~ 로 줄인다', () => expect(tildify('/Users/me/dev/', '/Users/me')).toBe('~/dev'));
  it('홈 자체면 ~', () => expect(tildify('/Users/me', '/Users/me')).toBe('~'));
  it('홈과 이름만 비슷한 폴더는 안 줄인다', () => expect(tildify('/Users/meow/dev', '/Users/me')).toBe('/Users/meow/dev'));
  it('홈 밖은 그대로(끝 / 만 뗀다)', () => expect(tildify('/Volumes/Work/', '/Users/me')).toBe('/Volumes/Work'));
  it('홈을 모르면 그대로', () => expect(tildify('/Users/me/dev', '')).toBe('/Users/me/dev'));
});

describe('Claude Code 옛 버전 — 올려야 다음으로 (아이맥 2.1.267 실측)', () => {
  const ok: EnvCheck = { claudePath: '/h/.local/bin/claude', claudeVersion: '2.1.283', loggedIn: true, clt: true, ghPath: null, ghUser: null, ghStale: false };
  it('옛 버전이면 설정을 못 끝낸다', () => expect(setupReady({ ...ok, claudeVersion: '2.1.267 (Claude Code)' })).toBe(false));
  it('버전을 못 읽었거나 더 새것이면 막지 않는다', () => {
    expect(setupReady({ ...ok, claudeVersion: '' })).toBe(true);
    expect(setupReady({ ...ok, claudeVersion: '2.2.0' })).toBe(true);
  });
  it('앱이 쓰는 그 claude 가 brew(Caskroom) 것이면 brew upgrade, 아니면 그 claude 로 update — brew 에도 하나 있다고 brew 를 올리면 엉뚱한 걸 올린다(아이맥: 공식 2.1.263 + brew 2.1.267)', () => {
    const cmd = setupCommand('update', { claude: '/Users/me/.local/bin/claude' }, 'done');
    expect(cmd).toContain("readlink -f '/Users/me/.local/bin/claude'");
    expect(cmd).toContain('*/Caskroom/*');
    expect(cmd).toContain('upgrade --cask claude-code');
    expect(cmd).toContain("'/Users/me/.local/bin/claude' update");
    expect(cmd).not.toContain('list --cask');
  });
});

describe('알림 권한 줄 — 놓치면 결정 대기·답 필요 알림이 안 온다(아이맥: 첫 실행에 거부로 기록됨)', () => {
  it('허용이면 됨', () => expect(notifyRow('granted')).toEqual({ state: 'ok', action: null }));
  it('아직 안 물었으면 허용 요청 버튼', () => expect(notifyRow('notDetermined')).toEqual({ state: 'need', action: 'request' }));
  it('거부면 시스템 설정 열기 버튼 — 앱이 다시 물을 수 없다', () => expect(notifyRow('denied')).toEqual({ state: 'need', action: 'settings' }));
  it('못 읽으면(개발 빌드 등) 선택으로 두고 막지 않는다', () => expect(notifyRow('unavailable')).toEqual({ state: 'opt', action: null }));
});

describe('브라우저 자동화 줄 — 설치 버튼 하나, 없는 것만 받는다(2026-10-05 딸깍)', () => {
  const ready = { node: '/opt/homebrew/bin/node', nodeVersion: 'v22.3.0', nodeOk: true, nodeSource: 'system' as const, installed: true, chrome: true, chromeBeta: true, checked: true, ready: true };
  const fresh = { node: null, nodeVersion: '', nodeOk: false, nodeSource: '' as const, installed: false, chrome: false, chromeBeta: false, checked: false, ready: false };
  const idle = { running: false, step: null, pct: null, text: '', error: null, done: false };
  it('다 됐으면 됨', () => expect(browserRow(ready, idle)).toEqual({ state: 'ok', action: null, busy: false }));
  it('하나라도 없으면 설치 — Node 가 없어도(앱이 받는다)', () => {
    expect(browserRow(fresh, idle)).toEqual({ state: 'opt', action: 'install', busy: false });
    expect(browserRow({ ...ready, chromeBeta: false, ready: false }, idle).action).toBe('install');
  });
  it('도는 중이면 버튼 없이 진행, 실패하면 다시 시도', () => {
    expect(browserRow(fresh, { ...idle, running: true, step: 'chrome', pct: 40 })).toEqual({ state: 'opt', action: null, busy: true });
    expect(browserRow(fresh, { ...idle, step: 'chrome', error: '인터넷에 연결할 수 없어요' }).action).toBe('retry');
  });
  it('모르면(읽기 실패) 버튼 없이 선택', () => expect(browserRow(null, null)).toEqual({ state: 'opt', action: null, busy: false }));
  it('확인 목록 네 칸 — 있는 것·지금 하는 것·실패한 것', () => {
    expect(browserChecklist(ready, idle).map((c) => c.state)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(browserChecklist({ ...fresh, nodeOk: true }, { ...idle, running: true, step: 'chrome' }).map((c) => [c.key, c.state])).toEqual([
      ['node', 'ok'], ['chrome', 'now'], ['parts', 'todo'], ['check', 'todo'],
    ]);
    expect(browserChecklist(fresh, { ...idle, step: 'node', error: 'x' })[0]?.state).toBe('fail');
  });
});

describe('addExtraProject — 프로젝트 폴더 밖 폴더를 하나씩 추가(사용자 2026-09-28: 아이맥 ~/automation/…)', () => {
  it('~ 모양으로 줄여 끝에 붙인다', () => {
    expect(addExtraProject([], '/Users/me/automation/blog-bot/', '~/Desktop/dev', '/Users/me')).toEqual({ list: ['~/automation/blog-bot'] });
  });
  it('이미 있으면 그대로', () => {
    expect(addExtraProject(['~/automation/blog-bot'], '/Users/me/automation/blog-bot', '~/Desktop/dev', '/Users/me')).toEqual({ list: ['~/automation/blog-bot'], note: 'dup' });
  });
  it('프로젝트 폴더 안이면 이미 보이니까 안 넣는다', () => {
    expect(addExtraProject([], '/Users/me/Desktop/dev/shop', '~/Desktop/dev', '/Users/me')).toEqual({ list: [], note: 'inside' });
  });
  it('프로젝트 폴더 자체·홈 전체는 안 된다', () => {
    expect(addExtraProject([], '/Users/me/Desktop/dev', '~/Desktop/dev', '/Users/me').note).toBe('root');
    expect(addExtraProject([], '/Users/me', '~/Desktop/dev', '/Users/me').note).toBe('root');
  });
});

describe('setupCommand — 윈도우(cmd /C 가 읽는 모양, 윈도우판)', () => {
  const c = 'C:\\Users\\a\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe';
  it('폴더 믿기: cd /d "폴더" && "claude"', () => {
    expect(setupCommand('trust', { claude: c }, '', 'C:\\Users\\a\\dev', true)).toBe(`cd /d "C:\\Users\\a\\dev" && "${c}"`);
    // 홈(C:\Users\a) + ~/.chammo/hq 가 합쳐져 \ 와 / 가 섞여 온다 — 윈도우 모양으로 맞춘다
    expect(setupCommand('trust', { claude: c }, '', 'C:\\Users\\a/.chammo/hq', true)).toBe(`cd /d "C:\\Users\\a\\.chammo\\hq" && "${c}"`);
  });
  it('로그인: 큰따옴표 + 끝 안내는 & echo', () => {
    expect(setupCommand('login', { claude: c }, '끝났어요 & 닫으세요', undefined, true)).toBe(`"${c}" auth login & echo. & echo 끝났어요 ^& 닫으세요`);
  });
  it('파이썬 3: winget 공식 패키지를 사용자 범위로 — py 런처도 이 사용자에게만(기본은 모든 사용자라 관리자 창이 뜬다), 사용자 PATH 앞에 붙는다, 끝 안내는 git 과 같은 모양', () => {
    expect(setupCommand('python', {}, '끝', undefined, true)).toBe('winget install -e --id Python.Python.3.12 --scope user --custom "InstallLauncherAllUsers=0" --accept-source-agreements --accept-package-agreements & echo. & echo 끝');
    expect(setupCommand('clt', {}, '끝', undefined, true)).toBe('winget install -e --id Git.Git & echo. & echo 끝');
  });
  it('설치: PowerShell 설치 스크립트', () => {
    expect(setupCommand('install', {}, '끝', undefined, true)).toBe('powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex" & echo. & echo 끝');
  });
  // -EncodedCommand 는 UTF-16LE base64 — 풀어서 본다
  const decode = (cmd: string) => {
    const b64 = /-EncodedCommand (\S+)/.exec(cmd)?.[1] ?? '';
    const bin = atob(b64);
    let out = '';
    for (let i = 0; i < bin.length; i += 2) out += String.fromCharCode(bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8));
    return out;
  };
  it('업데이트: winget 으로 깐 claude 면 winget upgrade(claude update 는 winget 것을 못 올린다, 2026-10-01 윈도우 PC 2.1.283)', () => {
    const cmd = setupCommand('update', { claude: c }, '끝', undefined, true);
    expect(cmd.startsWith('powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ')).toBe(true);
    expect(cmd.endsWith(' & echo. & echo 끝')).toBe(true);
    expect(decode(cmd)).toContain('winget upgrade -e --id Anthropic.ClaudeCode --accept-source-agreements --accept-package-agreements');
    // 링크 말고 실제 패키지 폴더 경로로 와도
    const real = 'C:\\Users\\a\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe\\claude.exe';
    expect(decode(setupCommand('update', { claude: real }, '', undefined, true))).toContain('winget upgrade -e --id Anthropic.ClaudeCode');
  });
  it('업데이트(winget): 돌고 있는 claude 가 claude.exe 를 잠가도 — 먼저 이름을 비켜 두고 올리고, 실패하면 되돌린다(2026-10-01 0x8a150003 Access is denied)', () => {
    const s = decode(setupCommand('update', { claude: c }, '', undefined, true));
    const rename = s.indexOf("Rename-Item -LiteralPath $exe -NewName $old");
    const upgrade = s.indexOf('winget upgrade');
    const restore = s.indexOf("Copy-Item -LiteralPath $last.FullName -Destination $exe -Force", rename);
    expect(rename).toBeGreaterThan(-1);
    expect(upgrade).toBeGreaterThan(rename);
    expect(restore).toBeGreaterThan(upgrade);
    // 지난번에 비켜 둔 옛 파일은 지운다(잠겨 있으면 넘어간다)
    expect(s).toContain("'claude.exe.old-*'");
    expect(s).toContain('-ErrorAction SilentlyContinue');
    // winget 종료 코드를 돌려주되 '이미 최신'(0x8A15002B)은 성공으로 — 참모 PC 실측
    expect(s).toContain('-1978335189');
    expect(s.trim().endsWith('exit $code')).toBe(true);
    // 진행 표시가 #< CLIXML 덩어리로 터미널에 깨져 나왔다 — 끈다
    expect(s.startsWith("$ProgressPreference = 'SilentlyContinue'")).toBe(true);
  });
  const notes = { busy: "Claude {0}개 도는 중 — 세션은 옛 판 그대로", back: "업데이트 실패, 이전 판으로 되돌렸어요" };
  it('업데이트(winget): 지난번에 끊겨 .old 만 남았으면 지우기 전에 먼저 되살린다 — 그걸 지우면 claude 가 사라진다(2026-10-20 윈도우 시험 PC)', () => {
    const s = decode(setupCommand('update', { claude: c }, '', undefined, true, notes));
    const heal = s.indexOf("if (-not (Test-Path -LiteralPath $exe)) { $last = ");
    const drop = s.indexOf("'claude.exe.old-*' -ErrorAction SilentlyContinue | Remove-Item");
    expect(heal).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(heal);
    // 지우기는 claude.exe 가 있을 때만
    expect(s.slice(heal, drop)).toContain('if (Test-Path -LiteralPath $exe) { Get-ChildItem');
  });
  it('업데이트(winget): 돌고 있는 claude 가 있으면 올리기 전에 알린다', () => {
    const s = decode(setupCommand('update', { claude: c }, '', undefined, true, notes));
    const busy = s.indexOf('Get-Process -Name claude');
    expect(busy).toBeGreaterThan(-1);
    expect(busy).toBeLessThan(s.indexOf('winget upgrade'));
    expect(s).toContain("Write-Output ('Claude {0}개 도는 중 — 세션은 옛 판 그대로' -f $busy)");
  });
  it('업데이트(winget): 끝난 뒤 claude.exe 가 있고 --version 이 도는지 보고, 아니면 가장 새 .old 로 되돌리고 한 줄', () => {
    const s = decode(setupCommand('update', { claude: c }, '', undefined, true, notes));
    const up = s.indexOf('winget upgrade');
    const ver = s.indexOf('try { & $exe --version *> $null; $ok = $LASTEXITCODE -eq 0 } catch { $ok = $false }');
    const back = s.indexOf("Write-Output '업데이트 실패, 이전 판으로 되돌렸어요'");
    expect(ver).toBeGreaterThan(up);
    expect(back).toBeGreaterThan(ver);
    expect(s).toContain("Sort-Object Name -Descending | Select-Object -First 1");
    // '이미 최신'이라 안 받은 거면 조용히 되돌린다(실패 아님)
    expect(s).toContain('if (-not $latest) {');
  });
  it('안내 문구의 작은따옴표는 PowerShell 에서 두 번', () => {
    const s = decode(setupCommand('update', { claude: c }, '', undefined, true, { busy: "it's {0}", back: "can't" }));
    expect(s).toContain("'it''s {0}'");
    expect(s).toContain("'can''t'");
  });
  it('업데이트: 공식 설치(.local\\bin) 면 그 claude 로 update', () => {
    const own = 'C:\\Users\\a\\.local\\bin\\claude.exe';
    expect(setupCommand('update', { claude: own }, '', undefined, true)).toBe(`"${own}" update`);
  });
  it('맥은 그대로', () => {
    expect(setupCommand('trust', { claude: '/h/claude' }, '', '/h/dev', false)).toBe("cd '/h/dev' && exec '/h/claude'");
  });
});

describe('ghRow — GitHub CLI 줄', () => {
  const base = { ghPath: 'C:\\gh.exe', ghUser: null, ghStale: false };
  it('멀쩡한 계정이면 됨', () => expect(ghRow({ ...base, ghUser: 'octo' })).toBe('ok'));
  it('토큰이 깨졌으면 로그인됨이 아니라 다시 로그인(윈도우 QA 2026-10-05)', () => {
    expect(ghRow({ ...base, ghStale: true })).toBe('relogin');
    // Rust 가 둘 다 주는 일은 없지만, 와도 깨짐이 이긴다
    expect(ghRow({ ...base, ghUser: 'octo', ghStale: true })).toBe('relogin');
  });
  it('깔렸는데 로그인 전 · 안 깔림', () => {
    expect(ghRow(base)).toBe('login');
    expect(ghRow({ ghPath: null, ghUser: null, ghStale: false })).toBe('install');
  });
});

describe('setupCommand — 맥 파이썬', () => {
  it('맥은 파이썬 줄이 없지만 부르면 명령줄 도구(python3 가 들어 있다)', () => {
    expect(setupCommand('python', {}, '끝', undefined, false)).toBe("xcode-select --install; echo; echo '끝'");
  });
});

describe('gitStillMissing — 윈도우에서 git 설치를 눌렀는데도 ✕ 면 껐다 켜기 안내(2026-10-21 새 윈도우 PC)', () => {
  it('윈도우·설치를 한 번 돌렸고·설치 창이 닫혔는데 아직 없으면', () => {
    expect(gitStillMissing({ win: true, tried: true, running: false, ok: false })).toBe(true);
  });
  it('설치 중·안 눌러 봄·맥·이미 있음이면 안내 없음', () => {
    expect(gitStillMissing({ win: true, tried: true, running: true, ok: false })).toBe(false);
    expect(gitStillMissing({ win: true, tried: false, running: false, ok: false })).toBe(false);
    expect(gitStillMissing({ win: false, tried: true, running: false, ok: false })).toBe(false);
    expect(gitStillMissing({ win: true, tried: true, running: false, ok: true })).toBe(false);
  });
  it('파이썬 줄도 같은 판단 — 설치 창을 닫았는데 아직 못 찾으면 껐다 켜기', () => {
    expect(gitStillMissing({ win: true, tried: true, running: false, ok: false })).toBe(true);
  });
});
