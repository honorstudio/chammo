import { describe, expect, it } from 'vitest';
import { attribute, envCandidates, summarize, fmtDur, fmtMem, level, parseClaudePids, parseEtime, parsePs, parseSys, procLabel } from './load';

const PS = [
  '  100     1   0.5  80000        01:00:00 /Users/me/.local/bin/claude bg-spare',
  '  101   100  12.0 300000        10:00 node /x/node_modules/.bin/expo start --web --port 8083',
  '  102   101  40.0 200000        05:00 /x/chrome-headless-shell --headless',
  '  103   100   1.0  90000     2-03:04:05 npm exec @mobilenext/mobile-mcp@1.0.5',
  '  200     1   0.1  70000        30:00 /Users/me/.local/bin/claude bg-spare',
  '  300     1  55.0 500000        02:00 /r/rustc --crate-name tauri',
  '  400     1   0.0 250000     1-00:00:00 node /old/node_modules/.bin/next dev',
  '  401   400   0.0  50000     1-00:00:00 node /old/node_modules/next/dist/server/worker.js',
  '  500     1   3.0 120000        00:30 /Applications/Safari.app/Contents/MacOS/Safari',
  '  600   550   9.0  40000        00:10 claude',
].join('\n');

describe('parsePs — ps -axo pid,ppid,pcpu,rss,etime,args', () => {
  it('칸을 나누고 명령은 빈칸째로', () => {
    const p = parsePs(PS);
    expect(p).toHaveLength(10);
    expect(p[1]).toEqual({ pid: 101, ppid: 100, cpu: 12, rssKb: 300000, etime: '10:00', cmd: 'node /x/node_modules/.bin/expo start --web --port 8083' });
  });
  it('깨진 줄은 건너뛴다', () => {
    expect(parsePs('abc\n\n 1 0 x y z')).toEqual([]);
  });
});

describe('parseEtime·fmtDur — 돈 시간', () => {
  it('[[일-]시:]분:초', () => {
    expect(parseEtime('00:30')).toBe(30);
    expect(parseEtime('10:00')).toBe(600);
    expect(parseEtime('01:00:00')).toBe(3600);
    expect(parseEtime('2-03:04:05')).toBe(2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  });
  it('사람이 읽는 길이', () => {
    expect(fmtDur(30)).toBe('30초');
    expect(fmtDur(600)).toBe('10분');
    expect(fmtDur(3 * 3600 + 60)).toBe('3시간');
    expect(fmtDur(2 * 86400 + 3600)).toBe('2일');
  });
});

describe('fmtMem — KB → 읽는 크기', () => {
  it('MB·GB', () => {
    expect(fmtMem(80000)).toBe('78MB');
    expect(fmtMem(3 * 1024 * 1024)).toBe('3.0GB');
  });
});

describe('procLabel — 무엇이 먹나', () => {
  it('자주 보는 것에 이름을 붙인다', () => {
    expect(procLabel('node /x/node_modules/.bin/expo start --web')).toBe('expo');
    expect(procLabel('/x/chrome-headless-shell --headless')).toBe('headless Chrome');
    expect(procLabel('npm exec @mobilenext/mobile-mcp@1.0.5')).toBe('mobile MCP');
    expect(procLabel('npm exec @playwright/mcp@latest --extension')).toBe('Playwright MCP');
    expect(procLabel('/r/rustc --crate-name tauri')).toBe('Rust build');
    expect(procLabel('node /old/node_modules/.bin/next dev')).toBe('next dev');
    expect(procLabel('/Users/me/.local/bin/claude bg-spare')).toBe('Claude Code');
    expect(procLabel('/Users/me/.local/share/claude/versions/2.1.283 --bg-spare /tmp/x.sock')).toBe('Claude Code');
    expect(procLabel('/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild -scheme X')).toBe('Xcode build');
  });
  it('모르는 건 실행 파일 이름', () => {
    expect(procLabel('/usr/local/bin/ffmpeg -i a.mov')).toBe('ffmpeg');
  });
  it('맥 앱은 번들 이름 — 경로에 빈칸이 있어도', () => {
    // Chammo 와 Chammo Dev 가 둘 다 'Chammo' 로 보였다(빈칸에서 잘림)
    expect(procLabel('/Applications/Chammo Dev.app/Contents/MacOS/honor-orchestrator')).toBe('Chammo Dev');
    expect(procLabel('/Applications/Chammo.app/Contents/MacOS/Chammo --routine-tick')).toBe('Chammo');
    expect(procLabel('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --type=x')).toBe('Google Chrome');
  });
  it('node·python 은 돌리는 스크립트 이름', () => {
    expect(procLabel('node /u/app/node_modules/.bin/tsc --noEmit -p .')).toBe('tsc');
    expect(procLabel('/usr/bin/python3 -u /u/.chammo/tools/routine run blog')).toBe('routine');
    expect(procLabel('node --max-old-space-size=4096 /u/x/server.js')).toBe('server');
  });
});

describe('parseSys — sysctl 네 줄', () => {
  it('코어·부하·스왑·메모리', () => {
    const s = parseSys('10\n{ 2.87 12.70 36.59 }\ntotal = 5120.00M  used = 3739.56M  free = 1380.44M  (encrypted)\n25769803776');
    expect(s).toEqual({ cores: 10, load1: 2.87, load5: 12.7, load15: 36.59, swapUsedMb: 3739.56, swapTotalMb: 5120, memTotalMb: 24576 });
  });
  it('못 읽으면 null', () => {
    expect(parseSys('')).toBeNull();
  });
});

describe('parseClaudePids — ps -E 의 CLAUDE_PID', () => {
  it('프로세스 → 띄운 Claude 세션 pid', () => {
    const m = parseClaudePids('  400 node next dev HOME=/u CLAUDE_PID=999 PATH=/bin\n  300 rustc CLAUDE_PID=200 X=1\n  500 Safari HOME=/u');
    expect([...m.entries()]).toEqual([[400, 999], [300, 200]]);
  });
});

describe('attribute — 부하를 세션별로 가른다', () => {
  const procs = parsePs(PS);
  const sessions = [{ id: 's1', name: 'shop', project: 'shop', pid: 100 }, { id: 's2', name: 'blog', project: 'blog', pid: 200 }];
  // 300(rustc)은 blog 세션이 띄웠는데 부모가 끊겼다 · 400(next dev)은 이미 끝난 세션 999 가 띄웠다 · 600 은 Chammo 밖 claude(550)
  const env = new Map([[300, 200], [400, 999], [401, 999], [600, 550]]);
  const r = attribute(procs, sessions, env, [550]);

  it('세션 pid 밑 나무 전부가 그 세션 몫', () => {
    const shop = r.sessions.find((s) => s.id === 's1')!;
    expect(shop.cpu).toBeCloseTo(0.5 + 12 + 40 + 1);
    expect(shop.rssKb).toBe(80000 + 300000 + 200000 + 90000);
    expect(shop.top.map((p) => p.pid)).toEqual([102, 101, 103, 100]); // CPU 큰 순
  });
  it('부모가 끊겨도 CLAUDE_PID 로 주인을 찾는다', () => {
    const blog = r.sessions.find((s) => s.id === 's2')!;
    expect(blog.top.map((p) => p.pid)).toContain(300);
    expect(blog.cpu).toBeCloseTo(0.1 + 55);
  });
  it('세션은 끝났는데 남은 것 = 주인 없는 프로세스(뿌리만, 밑 나무 합계)', () => {
    expect(r.orphans.map((o) => o.pid)).toEqual([400]);
    expect(r.orphans[0]!.rssKb).toBe(250000 + 50000);
    expect(r.orphans[0]!.count).toBe(2);
  });
  it('Chammo 밖 Claude 가 띄운 것은 따로', () => {
    expect(r.outside.cpu).toBe(9);
  });
  it('나머지는 합계만', () => {
    expect(r.rest.cpu).toBeCloseTo(3);
  });
  it('세션은 CPU 큰 순', () => {
    expect(r.sessions.map((s) => s.id)).toEqual(['s2', 's1']);
  });
});

describe('attribute — 살아 있는 Claude 는 주인 없는 프로세스가 아니다(2026-09-28 실측: 밖 세션·daemon 이 끄기 목록에 떴다)', () => {
  const ps = parsePs([
    '  700     1   0.2 900000     16:00:00 /Users/me/.local/bin/claude daemon run',
    '  710   700   0.1  90000        05:00 /Users/me/.local/bin/claude bg-pty-host --bg-pty-host x',
    '  711   710  30.0 400000        05:00 /Users/me/.local/bin/claude bg-spare',
    '  712   711  20.0 300000        04:00 node /x/node_modules/.bin/vite',
    '  720   700   0.1  90000        05:00 /Users/me/.local/bin/claude bg-spare',
  ].join('\n'));
  // 세 claude 는 죽은 셸(111)이 띄운 걸 물려받아 CLAUDE_PID=111 — 711 은 Chammo 밖 세션, 720 은 목록에 없는 claude
  const env = new Map([[700, 111], [710, 111], [711, 111], [720, 111]]);
  const r = attribute(ps, [], env, [711]);
  it('밖 세션 나무는 밖 몫', () => {
    expect(r.orphans).toEqual([]);
    expect(r.outside.cpu).toBeCloseTo(0.2 + 0.1 + 30 + 20 + 0.1);
  });
});

describe('envCandidates — 환경변수를 볼 프로세스(세션 나무 밖이고 무겁거나 떨어져 나온 것만)', () => {
  it('세션 나무 안은 안 본다', () => {
    const c = envCandidates(parsePs(PS), [100, 200]);
    expect(c).not.toContain(101);
    expect(c).toEqual(expect.arrayContaining([300, 400, 500, 600]));
  });
});

describe('level — 상단 바 색', () => {
  it('부하는 코어 수 대비, 스왑은 GB', () => {
    const base = { cores: 10, load1: 5, load5: 5, load15: 5, swapUsedMb: 500, swapTotalMb: 2048, memTotalMb: 24576 };
    expect(level(base)).toBe('ok');
    expect(level({ ...base, load1: 12 })).toBe('warn');
    expect(level({ ...base, load1: 25 })).toBe('high');
    expect(level({ ...base, swapUsedMb: 4500 })).toBe('warn');
    expect(level({ ...base, swapUsedMb: 8500 })).toBe('high');
  });
});

describe('summarize — 참모가 읽을 요약', () => {
  it('세션별 CPU·메모리·무엇이 먹나 + 주인 없는 프로세스', () => {
    const sys = parseSys('10\n{ 12.0 8.0 5.0 }\ntotal = 5120.00M  used = 4608.00M  free = 512.00M\n25769803776')!;
    const r = attribute(parsePs(PS), [{ id: 's1', name: 'shop', project: 'shop', pid: 100 }], new Map([[400, 999]]));
    const s = summarize(sys, r, new Date('2026-09-28T08:00:00Z'));
    expect(s.level).toBe('warn');
    expect(s.swapUsedGb).toBe(4.5);
    expect(s.sessions[0]).toMatchObject({ name: 'shop', cpu: 54, top: ['headless Chrome 40% 195MB', 'expo 12% 293MB', 'mobile MCP 1% 88MB'] });
    expect(s.orphans[0]).toMatchObject({ pid: 400, what: 'next dev', age: '1일' });
  });
});

describe('윈도우 — load.rs 가 sysinfo 값을 맥 모양 글로 만든다(ps_line·sys_lines 와 같은 글)', () => {
  it('프로세스·부하를 그대로 읽는다', () => {
    const [p] = parsePs('42 7 12.3 2048 01:05 C:\\x\\claude.exe attach a');
    expect(p).toEqual({ pid: 42, ppid: 7, cpu: 12.3, rssKb: 2048, etime: '01:05', cmd: 'C:\\x\\claude.exe attach a' });
    const s = parseSys('8\n{ 4.00 4.00 4.00 }\ntotal = 4096.00M  used = 1024.00M  free = 3072.00M\n17179869184');
    expect(s).toEqual({ cores: 8, load1: 4, load5: 4, load15: 4, swapUsedMb: 1024, swapTotalMb: 4096, memTotalMb: 16384 });
  });
});

describe('참모 모드 호스트 — 모드 하나당 claude 프로세스 하나(≈240MB), 부하 화면에 따로 센다', () => {
  it('켜진 모드 호스트는 "다른 앱·시스템"이 아니라 모드 칸으로', () => {
    const ps = [PS, '  700     1   0.3 246000        05:00 /Users/me/.local/bin/claude -p --input-format stream-json --plugin-dir /d/modes/counter'].join('\n');
    const r = attribute(parsePs(ps), [], new Map(), [], [{ name: 'counter', pid: 700 }, { name: 'gone', pid: 999 }]);
    expect(r.modes).toEqual([{ name: 'counter', cpu: 0.3, rssKb: 246000 }]);
    expect(r.rest.top.some((p) => p.pid === 700)).toBe(false);
    const sys = parseSys('10\n{ 1.0 1.0 1.0 }\ntotal = 0.00M  used = 0.00M  free = 0.00M\n25769803776')!;
    expect(summarize(sys, r, new Date(0)).modes).toEqual({ count: 1, mem: fmtMem(246000) });
  });
});
