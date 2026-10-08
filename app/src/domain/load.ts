// 부하 모니터 — 이 맥의 CPU·메모리를 누가 먹는지 세션별로 가른다(사용자 2026-09-28: "어디서 어떻게 부하가 생기는지 참모 기준으로").
// 재료는 Rust(load.rs)가 주는 ps·sysctl 원문. 세션 몫 = `claude agents --json` 의 세션 pid 밑 프로세스 나무 전부 +
// 부모가 끊겨 떨어져 나온 것(환경변수 CLAUDE_PID 가 그 세션 pid). CLAUDE_PID 의 세션이 이미 없으면 "주인 없는 프로세스"
import { tr } from '../i18n';

export type Proc = { pid: number; ppid: number; cpu: number; rssKb: number; etime: string; cmd: string };
export type SysLoad = { cores: number; load1: number; load5: number; load15: number; swapUsedMb: number; swapTotalMb: number; memTotalMb: number };
export type SessionLoad = { id: string; name: string; project: string; cpu: number; rssKb: number; top: Proc[] };
export type Orphan = Proc & { count: number; claudePid: number };
export type Bucket = { cpu: number; rssKb: number; top: Proc[] };
export type LoadReport = { sessions: SessionLoad[]; orphans: Orphan[]; outside: Bucket; rest: Bucket };

/** `ps -axo pid=,ppid=,pcpu=,rss=,etime=,args=` → 프로세스들. 명령은 빈칸째로 */
export function parsePs(text: string): Proc[] {
  const out: Proc[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    out.push({ pid: Number(m[1]), ppid: Number(m[2]), cpu: Number(m[3]), rssKb: Number(m[4]), etime: m[5]!, cmd: m[6]!.trim() });
  }
  return out;
}

/** ps etime `[[일-]시:]분:초` → 초 */
export function parseEtime(e: string): number {
  const [d, rest] = e.includes('-') ? [Number(e.split('-')[0]), e.split('-')[1]!] : [0, e];
  const parts = rest.split(':').map(Number).reverse();
  return d * 86400 + (parts[0] ?? 0) + (parts[1] ?? 0) * 60 + (parts[2] ?? 0) * 3600;
}

export function fmtDur(sec: number): string {
  if (sec < 60) return tr(`${sec}초`, `${sec}s`);
  if (sec < 3600) return tr(`${Math.floor(sec / 60)}분`, `${Math.floor(sec / 60)}m`);
  if (sec < 86400) return tr(`${Math.floor(sec / 3600)}시간`, `${Math.floor(sec / 3600)}h`);
  return tr(`${Math.floor(sec / 86400)}일`, `${Math.floor(sec / 86400)}d`);
}

export function fmtMem(kb: number): string {
  const mb = kb / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}GB` : `${Math.round(mb)}MB`;
}

// 명령줄 → 사람이 알아볼 이름. 앞에 있을수록 먼저 본다
const LABELS: [RegExp, string][] = [
  [/chrome-headless|Chrome Headless|--headless/, 'headless Chrome'],
  [/mobile-mcp/, 'mobile MCP'],
  [/@playwright\/mcp|playwright.*mcp|chammo-browser|local-browser/, 'Playwright MCP'],
  [/\bexpo\b.*start|expo start/, 'expo'],
  [/next dev|next\/dist\/server/, 'next dev'],
  [/\bvite\b/, 'vite'],
  [/jest-worker|\bjest\b|vitest/, 'test runner'],
  [/remotion/, 'Remotion'],
  [/\/(rustc|cargo)(\s|$)|^(rustc|cargo)\b/, 'Rust build'],
  [/xcodebuild|XCBBuildService|swift-frontend/, 'Xcode build'],
  [/Simulator\.app|CoreSimulator|launchd_sim/, 'iOS Simulator'],
  [/qemu-system|emulator64|\/emulator\b/, 'Android emulator'],
  [/GradleDaemon|gradle/i, 'Gradle'],
  [/\/claude(\s|$)|^claude(\s|$)|\/claude\/versions\//, 'Claude Code'],
];

export function procLabel(cmd: string): string {
  for (const [re, name] of LABELS) if (re.test(cmd)) return name;
  // 맥 앱은 번들 이름 — 빈칸에서 자르면 Chammo Dev·Google Chrome 이 'Chammo'·'Google' 이 된다
  const app = /\/([^/]+)\.app\/Contents\/MacOS\//.exec(cmd);
  if (app) return app[1]!;
  const words = cmd.split(/\s+/);
  const base = (w: string) => w.split('/').pop() || w;
  const bin = base(words[0] ?? cmd);
  // node·python 등은 무엇을 돌리나가 중요하다(tsc·서버 스크립트) — 첫 번째 옵션 아닌 인자
  if (/^(node|python\d*(\.\d+)?|bun|deno|ruby)$/.test(bin)) {
    const script = words.slice(1).find((w) => w && !w.startsWith('-'));
    if (script) return base(script).replace(/\.(m?js|cjs|ts|py|rb)$/, '');
  }
  return bin;
}

/** sysctl -n hw.ncpu vm.loadavg vm.swapusage hw.memsize 네 줄 */
export function parseSys(text: string): SysLoad | null {
  const [ncpu, avg, swap, mem] = text.split('\n');
  const cores = Number(ncpu);
  const la = /\{\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(avg ?? '');
  if (!cores || !la) return null;
  const sw = (k: string) => Number(new RegExp(`${k} = ([\\d.]+)M`).exec(swap ?? '')?.[1] ?? 0);
  return { cores, load1: Number(la[1]), load5: Number(la[2]), load15: Number(la[3]), swapUsedMb: sw('used'), swapTotalMb: sw('total'), memTotalMb: Math.round(Number(mem ?? 0) / 1024 / 1024) };
}

/** `ps -E -ww -o pid=,command= -p …` → pid → 그 프로세스를 띄운 Claude 세션 pid */
export function parseClaudePids(text: string): Map<number, number> {
  const m = new Map<number, number>();
  for (const line of text.split('\n')) {
    const pid = /^\s*(\d+)\s/.exec(line)?.[1];
    const owner = /(?:^|\s)CLAUDE_PID=(\d+)/.exec(line)?.[1];
    if (pid && owner) m.set(Number(pid), Number(owner));
  }
  return m;
}

function childrenOf(procs: Proc[]): Map<number, Proc[]> {
  const kids = new Map<number, Proc[]>();
  for (const p of procs) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p]);
  return kids;
}

/** pid 와 그 밑 전부 */
function subtree(pid: number, byPid: Map<number, Proc>, kids: Map<number, Proc[]>): Proc[] {
  const out: Proc[] = [];
  const seen = new Set<number>();
  const stack = [pid];
  while (stack.length) {
    const p = stack.pop()!;
    if (seen.has(p)) continue;
    seen.add(p);
    const me = byPid.get(p);
    if (me) out.push(me);
    for (const k of kids.get(p) ?? []) stack.push(k.pid);
  }
  return out;
}

/** 세션 나무 밖인데 환경변수를 봐야 할 것 — 부모가 launchd(떨어져 나옴)거나 무거운 것. 환경변수 읽기가 비싸서 추린다 */
export function envCandidates(procs: Proc[], sessionPids: number[], max = 80): number[] {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const kids = childrenOf(procs);
  const inside = new Set(sessionPids.flatMap((s) => subtree(s, byPid, kids).map((p) => p.pid)));
  return procs
    .filter((p) => !inside.has(p.pid) && (p.ppid === 1 || p.cpu >= 1 || p.rssKb >= 100 * 1024))
    .sort((a, b) => b.cpu - a.cpu || b.rssKb - a.rssKb)
    .slice(0, max)
    .map((p) => p.pid);
}

const sum = (ps: Proc[]) => ({ cpu: ps.reduce((n, p) => n + p.cpu, 0), rssKb: ps.reduce((n, p) => n + p.rssKb, 0) });
const topOf = (ps: Proc[], n = 6) => [...ps].sort((a, b) => b.cpu - a.cpu || b.rssKb - a.rssKb).slice(0, n);

/**
 * 세션별로 가른다. env = pid → CLAUDE_PID(envCandidates 로 추린 것만), otherClaude = Chammo 밖 Claude 세션 pid
 * (claude agents 에 있지만 내 프로젝트 폴더 밖). 떨어져 나온 프로세스의 나무도 같이 따라간다
 */
export function attribute(procs: Proc[], sessions: { id: string; name: string; project: string; pid: number }[], env: Map<number, number>, otherClaude: number[] = []): LoadReport {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const kids = childrenOf(procs);
  const taken = new Set<number>();
  const claim = (root: number) => subtree(root, byPid, kids).filter((p) => !taken.has(p.pid) && (taken.add(p.pid), true));

  const bySession = new Map(sessions.map((s) => [s.pid, [] as Proc[]]));
  for (const s of sessions) bySession.get(s.pid)!.push(...claim(s.pid));
  const outside: Proc[] = [];
  // Chammo 밖 Claude 세션 나무를 먼저 떼어 둔다 — 안 그러면 daemon 나무를 따라가다 주인 없는 것으로 샌다
  for (const pid of otherClaude) outside.push(...claim(pid));
  const orphans: Orphan[] = [];
  const alive = new Set(procs.map((p) => p.pid));
  // 떨어져 나온 것: 부모 쪽이 아직 안 잡힌 뿌리만 본다(나무째 가져가니까)
  const roots = [...env.keys()].filter((pid) => byPid.has(pid) && !taken.has(pid)).sort((a, b) => a - b);
  for (const pid of roots) {
    if (taken.has(pid)) continue;
    const owner = env.get(pid)!;
    const parentOwner = env.get(byPid.get(pid)!.ppid);
    if (parentOwner === owner && !taken.has(byPid.get(pid)!.ppid) && byPid.has(byPid.get(pid)!.ppid)) continue; // 부모가 같은 주인이면 부모 쪽에서 가져간다
    const tree = claim(pid);
    // Claude 자신(daemon·세션)은 띄운 셸의 CLAUDE_PID 를 물려받는다 — 그 셸이 죽었어도 살아 있는 Claude 라 주인 없는 게 아니다
    const isClaude = procLabel(byPid.get(pid)!.cmd) === 'Claude Code';
    if (bySession.has(owner)) bySession.get(owner)!.push(...tree);
    else if (isClaude || otherClaude.includes(owner) || alive.has(owner)) outside.push(...tree);
    else orphans.push({ ...byPid.get(pid)!, ...sum(tree), count: tree.length, claudePid: owner });
  }
  const rest = procs.filter((p) => !taken.has(p.pid));
  return {
    sessions: sessions
      .map((s) => { const ps = bySession.get(s.pid)!; return { id: s.id, name: s.name, project: s.project, ...sum(ps), top: topOf(ps) }; })
      .sort((a, b) => b.cpu - a.cpu || b.rssKb - a.rssKb),
    orphans: orphans.sort((a, b) => b.rssKb - a.rssKb),
    outside: { ...sum(outside), top: topOf(outside) },
    rest: { ...sum(rest), top: topOf(rest) },
  };
}

/** 상단 바 색 — 1분 부하가 코어 수를 넘으면 주의, 두 배면 높음. 스왑 4GB·8GB */
export function level(s: SysLoad): 'ok' | 'warn' | 'high' {
  const r = s.load1 / s.cores;
  if (r >= 2 || s.swapUsedMb >= 8 * 1024) return 'high';
  if (r >= 1 || s.swapUsedMb >= 4 * 1024) return 'warn';
  return 'ok';
}

export type LoadSummary = {
  at: string;
  cores: number;
  load1: number;
  load5: number;
  swapUsedGb: number;
  level: 'ok' | 'warn' | 'high';
  sessions: { name: string; project: string; cpu: number; mem: string; top: string[] }[];
  orphans: { pid: number; what: string; mem: string; cpu: number; age: string }[];
  outside: { cpu: number; mem: string };
  rest: { cpu: number; mem: string; top: string[] };
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const line = (p: Proc) => `${procLabel(p.cmd)} ${Math.round(p.cpu)}% ${fmtMem(p.rssKb)}`;

/** 참모가 읽을 요약(<데이터>/load.json → scripts/app load). CPU 는 % (100 = 코어 하나) */
export function summarize(sys: SysLoad, r: LoadReport, at: Date): LoadSummary {
  return {
    at: at.toISOString(),
    cores: sys.cores,
    load1: sys.load1,
    load5: sys.load5,
    swapUsedGb: r1(sys.swapUsedMb / 1024),
    level: level(sys),
    sessions: r.sessions.map((s) => ({ name: s.name, project: s.project, cpu: Math.round(s.cpu), mem: fmtMem(s.rssKb), top: s.top.slice(0, 3).map(line) })),
    orphans: r.orphans.map((o) => ({ pid: o.pid, what: procLabel(o.cmd), mem: fmtMem(o.rssKb), cpu: Math.round(o.cpu), age: fmtDur(parseEtime(o.etime)) })),
    outside: { cpu: Math.round(r.outside.cpu), mem: fmtMem(r.outside.rssKb) },
    rest: { cpu: Math.round(r.rest.cpu), mem: fmtMem(r.rest.rssKb), top: r.rest.top.slice(0, 3).map(line) },
  };
}
