import { describe, expect, it } from 'vitest';
import { addExtraProject, parseClaudeVersion, setupCommand, setupReady, shq, versionFit, versionWarning, type EnvCheck, WIZARD, canNext, tildify, notifyRow, browserRow } from './setup';

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
  const ok: EnvCheck = { claudePath: '/h/.local/bin/claude', claudeVersion: '2.1.283', loggedIn: true, clt: true, ghPath: null, ghUser: null };
  it('Claude Code 설치·로그인·명령줄 도구가 다 있어야 한다. gh 는 없어도 된다', () => {
    expect(setupReady(ok)).toBe(true);
    expect(setupReady(null)).toBe(false);
    expect(setupReady({ ...ok, claudePath: null })).toBe(false);
    expect(setupReady({ ...ok, loggedIn: false })).toBe(false);
    expect(setupReady({ ...ok, clt: false })).toBe(false);
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

describe('폴더 고르기 결과를 입력칸 모양으로', () => {
  it('홈 안이면 ~ 로 줄인다', () => expect(tildify('/Users/me/dev/', '/Users/me')).toBe('~/dev'));
  it('홈 자체면 ~', () => expect(tildify('/Users/me', '/Users/me')).toBe('~'));
  it('홈과 이름만 비슷한 폴더는 안 줄인다', () => expect(tildify('/Users/meow/dev', '/Users/me')).toBe('/Users/meow/dev'));
  it('홈 밖은 그대로(끝 / 만 뗀다)', () => expect(tildify('/Volumes/Work/', '/Users/me')).toBe('/Volumes/Work'));
  it('홈을 모르면 그대로', () => expect(tildify('/Users/me/dev', '')).toBe('/Users/me/dev'));
});

describe('Claude Code 옛 버전 — 올려야 다음으로 (아이맥 2.1.267 실측)', () => {
  const ok: EnvCheck = { claudePath: '/h/.local/bin/claude', claudeVersion: '2.1.283', loggedIn: true, clt: true, ghPath: null, ghUser: null };
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

describe('브라우저 자동화 줄 — 선택 기능. Node 20+ 가 있어야 깔 수 있다', () => {
  const base = { node: '/opt/homebrew/bin/node', nodeVersion: 'v22.3.0', nodeOk: true, installed: false, chrome: true };
  it('깔려 있으면 됨', () => expect(browserRow({ ...base, installed: true })).toEqual({ state: 'ok', action: null }));
  it('Node 가 있으면 설치 버튼', () => expect(browserRow(base)).toEqual({ state: 'opt', action: 'install' }));
  it('Node 가 없거나 옛 버전이면 Node 받기 안내', () => {
    expect(browserRow({ ...base, node: null, nodeVersion: '', nodeOk: false })).toEqual({ state: 'opt', action: 'getNode' });
    expect(browserRow({ ...base, nodeVersion: 'v18.1.0', nodeOk: false })).toEqual({ state: 'opt', action: 'getNode' });
  });
  it('모르면(읽기 실패) 아무 버튼도 없이 선택', () => expect(browserRow(null)).toEqual({ state: 'opt', action: null }));
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
  it('설치: PowerShell 설치 스크립트', () => {
    expect(setupCommand('install', {}, '끝', undefined, true)).toBe('powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex" & echo. & echo 끝');
  });
  it('맥은 그대로', () => {
    expect(setupCommand('trust', { claude: '/h/claude' }, '', '/h/dev', false)).toBe("cd '/h/dev' && exec '/h/claude'");
  });
});
