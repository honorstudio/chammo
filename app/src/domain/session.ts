// `claude agents --json` 결과를 앱이 쓰는 세션 모델로. 순수 TS — 프레임워크·Tauri import 없음.
import { assistant, tr } from '../i18n';

export type SessionState = 'working' | 'blocked' | 'idle';
export type SessionKind = 'background' | 'interactive';

export type Session = {
  /** background는 `claude attach <id>`에 쓰는 짧은 id, interactive는 sessionId */
  id: string;
  name: string;
  cwd: string;
  kind: SessionKind;
  state: SessionState;
  project: string;
  /** `.claude/worktrees/<이름>`이면 그 이름, 프로젝트 본체면 null */
  workspace: string | null;
  startedAt: number;
  /** 대화 기록 id — `claude --bg --resume`에 쓴다. `/clear` 하면 바뀐다 */
  sessionId?: string;
  /** 터미널 대화형 세션의 프로세스 — 앱으로 옮길 때 이걸 끝낸다 */
  pid?: number;
  /** 세션 프로세스(백그라운드 포함) — 부하 모니터가 이 밑 프로세스 나무를 그 세션 몫으로 센다 */
  procPid?: number;
  /** 막힌 이유: 'permission prompt'(도구 권한 창) · 'startup prompt'(시작 때 새 MCP 서버 등) → 앱이 자동 허용 / 'input needed'(선택지 질문) → 사람 몫 */
  waitingFor?: string;
};

type RawAgent = {
  id?: string;
  pid?: number;
  cwd?: string;
  kind?: string;
  startedAt?: number;
  sessionId?: string;
  name?: string;
  state?: string;
  status?: string;
  waitingFor?: string;
};

// background의 state(working/done/blocked…)와 interactive의 status(busy/idle…)를 한 축으로
function toState(raw: string | undefined): SessionState {
  switch (raw) {
    case 'working':
    case 'busy':
      return 'working';
    case 'blocked':
    case 'waiting': // 권한 창·선택지(waitingFor: permission prompt / input needed) — 2026-09-27 전엔 idle 로 잘못 읽었다
      return 'blocked';
    default:
      return 'idle';
  }
}

const stripSlash = (p: string) => p.replace(/\/+$/, '');

const baseName = (p: string) => p.split('/').filter(Boolean).pop() ?? p;

/**
 * cwd → 프로젝트 / 작업공간(worktree). 프로젝트 = devRoot 바로 아래 폴더, 또는 설정에서 따로 추가한 폴더(extras, 푼 경로)
 * — 아이맥 ~/automation/… 처럼 devRoot 로 못 옮기는 폴더(2026-09-28 사용자)
 */
export function classifyWorkspace(cwd: string, devRoot: string, extras: string[] = []): { project: string; workspace: string | null } {
  const path = stripSlash(cwd);
  const worktreeOf = (rest: string[]) => (rest[0] === '.claude' && rest[1] === 'worktrees' ? rest[2] ?? null : null);
  for (const x of extras.map(stripSlash).filter(Boolean)) {
    if (path === x || path.startsWith(`${x}/`)) return { project: baseName(x), workspace: worktreeOf(path.slice(x.length + 1).split('/')) };
  }
  const root = stripSlash(devRoot) + '/';
  if (!path.startsWith(root)) {
    return { project: baseName(path), workspace: null };
  }
  const rel = path.slice(root.length).split('/');
  return { project: rel[0] ?? path, workspace: worktreeOf(rel.slice(1)) };
}

/** 프로젝트 이름 → 폴더. 따로 추가한 폴더가 먼저(이름이 같으면 그쪽), 아니면 devRoot 아래 */
export const projectDir = (name: string, devRoot: string, extras: string[] = []): string =>
  extras.map(stripSlash).find((x) => baseName(x) === name) ?? `${stripSlash(devRoot)}/${name}`;

/** JSON이 아니면 던진다 — 조용히 빈 목록을 주면 옛 `claude`가 잡힌 것 같은 원인이 묻힌다 */
export function parseAgents(json: string, devRoot: string, extras: string[] = []): Session[] {
  const raw: unknown = JSON.parse(json);
  if (!Array.isArray(raw)) throw new Error(tr('claude agents --json: 배열이 아님', 'claude agents --json: not an array'));
  return (raw as RawAgent[]).map((r) => {
    const cwd = r.cwd ?? '';
    const kind: SessionKind = r.kind === 'interactive' ? 'interactive' : 'background';
    return {
      id: r.id ?? r.sessionId ?? String(r.pid ?? ''),
      name: r.name ?? '',
      cwd,
      kind,
      // status(busy/idle)가 있으면 그게 실제 상태다. 가져온(--resume) 세션은 대기 중에도 state가 blocked로 나온다(실측 2026-09-26)
      state: toState(r.status ?? r.state),
      startedAt: r.startedAt ?? 0,
      sessionId: r.sessionId,
      pid: kind === 'interactive' ? r.pid : undefined,
      procPid: r.pid,
      // status 없이 state: blocked 만 = 세션이 시작도 전에 멈춘 창(새 MCP 서버 허용 등) — 실측 2026-09-27
      waitingFor: r.waitingFor ?? (r.status === undefined && r.state === 'blocked' ? 'startup prompt' : undefined),
      ...classifyWorkspace(cwd, devRoot, extras),
    };
  });
}

export type ProjectGroup = { name: string; sessions: Session[] };

/** 예전부터 쓰던 비서 이름 — 설정 이름이 달라도 이 이름의 세션(참모·참모-2)은 계속 비서로 친다 */
const LEGACY_ASSISTANT = '참모';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 대표 비서 이름인가 — 설정 이름(assistant()) 또는 옛 이름 */
export const isOrchestratorName = (name: string) => name === assistant() || name === LEGACY_ASSISTANT;

/** 사이드바용: 이 앱 폴더의 세션(비서)은 따로, 나머지는 프로젝트별로. 순서는 들어온 대로 */
export function groupByProject(
  sessions: Session[],
  orchestratorCwd: string,
): { orchestrator: Session | undefined; orchestrators: Session[]; projects: ProjectGroup[] } {
  const orch = stripSlash(orchestratorCwd);
  // 이 폴더의 세션은 전부 비서다(⌘T로 여럿 띄운다) — 이름이 설정 이름인 것이 대표(맨 앞), 없으면 옛 이름 "참모"
  const here = sessions.filter((s) => stripSlash(s.cwd) === orch);
  const orchestrator = here.find((s) => s.name === assistant()) ?? here.find((s) => isOrchestratorName(s.name)) ?? here[0];
  const orchestrators = orchestrator ? [orchestrator, ...here.filter((s) => s !== orchestrator)] : [];
  const byName = new Map<string, Session[]>();
  for (const s of sessions) {
    if (here.includes(s)) continue;
    const list = byName.get(s.project) ?? [];
    list.push(s);
    byName.set(s.project, list);
  }
  return { orchestrator, orchestrators, projects: [...byName].map(([name, list]) => ({ name, sessions: list })) };
}

/** ⌘T로 비서를 하나 더 띄울 때 이름: 참모 → 참모-2 → 참모-3 (지금 있는 가장 큰 번호 다음). 이름은 assistant() */
export function nextOrchestratorName(names: string[]): string {
  const base = assistant();
  const re = new RegExp(`^${escapeRe(base)}-(\\d+)$`);
  const nums = names.map((n) => (n === base ? 1 : Number(re.exec(n)?.[1] ?? 0))).filter((n) => n > 0);
  return nums.length ? `${base}-${Math.max(...nums) + 1}` : base;
}

/**
 * 참모 화면을 무엇으로 그리나. 백그라운드면 하나여도 격자(SessionGrid) — 하나일 때 맨 터미널을 따로 그렸더니
 * 메모(머리줄·⌘M 포커스)가 안 붙어 "창이 두 개여야 메모가 된다"가 됐다(2026-09-27 사용자)
 */
export function orchView(orchestrators: Session[]): 'grid' | 'adopt' | 'empty' {
  if (!orchestrators.length) return 'empty';
  return orchestrators.length === 1 && orchestrators[0]!.kind !== 'background' ? 'adopt' : 'grid';
}

/**
 * 내 프로젝트 폴더(devRoot)·HQ 안에서 도는 세션만 — 이 맥의 다른 데서 띄운 Claude 세션까지 앱에 섞이지 않게
 * (공개판·데모에서 남의 세션이 뜨면 안 된다, 2026-09-28). 하위 폴더·worktree 는 포함, 이름만 비슷한 옆 폴더는 제외
 */
export function withinRoots<T extends { cwd: string }>(sessions: T[], roots: string[]): T[] {
  const rs = roots.filter(Boolean).map((r) => r.replace(/\/+$/, ''));
  if (!rs.length) return sessions;
  return sessions.filter((s) => rs.some((r) => s.cwd === r || s.cwd.startsWith(`${r}/`)));
}

/** 앱을 끄며 같이 끌 세션 — Chammo 가 다루는 폴더(프로젝트 폴더·HQ) 안만. 폴더를 모르면 빈 목록(withinRoots 와 달리 전부로 넘어가지 않는다) */
export function sessionsToStop<T extends { cwd: string }>(sessions: T[], roots: string[]): T[] {
  return roots.filter(Boolean).length ? withinRoots(sessions, roots) : [];
}
