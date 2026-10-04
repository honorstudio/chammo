// `claude agents --json` 결과를 앱이 쓰는 세션 모델로. 순수 TS — 프레임워크·Tauri import 없음.
import { assistant, tr } from '../i18n';
import { fwd } from './paths';
import { splitOrchName } from './orchLabel';

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
  /** dev 폴더 자체에서 연 세션 — 어느 프로젝트도 아님('프로젝트 밖') */
  loose?: true;
  startedAt: number;
  /** 대화 기록 id — `claude --bg --resume`에 쓴다. `/clear` 하면 바뀐다 */
  sessionId?: string;
  /** 터미널 대화형 세션의 프로세스 — 앱으로 옮길 때 이걸 끝낸다 */
  pid?: number;
  /** 세션 프로세스(백그라운드 포함) — 부하 모니터가 이 밑 프로세스 나무를 그 세션 몫으로 센다 */
  procPid?: number;
  /** 막힌 이유: 'permission prompt'(도구 권한 창) · 'startup prompt'(시작 때 새 MCP 서버 등) → 앱이 자동 허용 / 'input needed'(선택지 질문) → 사람 몫 */
  waitingFor?: string;
  /** Claude 판단: 턴을 끝내고 사람 답을 기다림(status idle + state blocked, 창 이유 없음). 일을 끝냈으면 state done — 2026-09-30 실측 */
  awaiting?: boolean;
  /** 맡은 일을 끝내고 쉬는 세션(state: done) — 붙여도 화면이 비어 대시보드는 요약으로 보인다 */
  finished?: boolean;
  /** 대화형만: 어디서 떴나(origin.rs). unattended = 예약 작업·붙은 사람 없는 tmux — 루틴 칸 "외부 예약"으로 따로 */
  origin?: { unattended: boolean; via: string };
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
export function classifyWorkspace(cwd: string, devRoot: string, extras: string[] = []): { project: string; workspace: string | null; loose?: true } {
  // 윈도우 경로는 / 로 맞추고 대소문자를 안 가린다(윈도우는 desktop·Desktop 이 같은 폴더 — 2026-10-01 윈도우 PC). 이름은 cwd 에 적힌 대로 쓴다
  const path = stripSlash(fwd(cwd));
  const win = /^[A-Za-z]:\//.test(path);
  const key = (p: string) => (win ? p.toLowerCase() : p);
  const within = (root: string) => key(path) === key(root) || key(path).startsWith(`${key(root)}/`);
  const worktreeOf = (rest: string[]) => (rest[0] === '.claude' && rest[1] === 'worktrees' ? rest[2] ?? null : null);
  for (const x of extras.map((e) => stripSlash(fwd(e))).filter(Boolean)) {
    if (within(x)) return { project: baseName(x), workspace: worktreeOf(path.slice(x.length + 1).split('/')) };
  }
  const root = stripSlash(fwd(devRoot));
  // dev 폴더 자체에서 연 세션은 어느 프로젝트도 아니다 — '프로젝트 밖'(2026-10-01 사용자: dev 가 통째로 프로젝트로 잡혔다)
  if (key(path) === key(root)) return { project: baseName(path), workspace: null, loose: true };
  if (!within(root)) return { project: baseName(path), workspace: null };
  const rel = path.slice(root.length + 1).split('/');
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
    const cwd = fwd(r.cwd ?? '');
    const kind: SessionKind = r.kind === 'interactive' ? 'interactive' : 'background';
    return {
      id: r.id ?? r.sessionId ?? String(r.pid ?? ''),
      name: r.name ?? '',
      cwd,
      kind,
      // status(busy/idle)가 있으면 그게 실제 상태다. 가져온(--resume) 세션은 대기 중에도 state가 blocked로 나온다(실측 2026-09-26).
      // 단 state: done 이면 답은 끝난 것 — 뒤에서 감시·에이전트가 돌면 status 가 busy 로 남는다(2026-09-28, 음성이 참모 답을 못 읽음)
      state: r.state === 'done' ? 'idle' : toState(r.status ?? r.state),
      ...(r.state === 'done' ? { finished: true } : {}),
      startedAt: r.startedAt ?? 0,
      sessionId: r.sessionId,
      pid: kind === 'interactive' ? r.pid : undefined,
      procPid: r.pid,
      // status 없이 state: blocked 만 = 세션이 시작도 전에 멈춘 창(새 MCP 서버 허용 등) — 실측 2026-09-27
      waitingFor: r.waitingFor ?? (r.status === undefined && r.state === 'blocked' ? 'startup prompt' : undefined),
      ...(r.status === 'idle' && r.state === 'blocked' && !r.waitingFor ? { awaiting: true } : {}),
      ...classifyWorkspace(cwd, devRoot, extras),
    };
  });
}

export type ProjectGroup = { name: string; sessions: Session[] };

/** 예전부터 쓰던 비서 이름 — 설정 이름이 달라도 이 이름의 세션(참모·참모-2)은 계속 비서로 친다 */
const LEGACY_ASSISTANT = '참모';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 두 언어의 기본 비서 이름 — 설정 이름이 비어 있으면 언어를 바꿀 때 기본 이름이 참모↔Chammo 로 바뀐다. 이미 있는 참모가
 *  도우미 칸으로 밀리고 참모 0명으로 보이지 않게 둘 다 비서로 친다(2026-10-03 QA 18번) */
const DEFAULT_ASSISTANTS = ['참모', 'Chammo'];
/** 비서로 치는 기본 이름들 — 설정 이름이 먼저 */
const assistantBases = () => [...new Set([assistant(), LEGACY_ASSISTANT, ...DEFAULT_ASSISTANTS])];

/** 대표 비서 이름인가 — 설정 이름(assistant())·옛 이름·두 언어 기본 이름 */
export const isOrchestratorName = (name: string) => assistantBases().includes(splitOrchName(name).base);
/** 비서 이름 꼴 — 참모·참모-2(⌘T), 옛 이름 참모·참모-2 */
export const orchestratorLike = (name: string) => { const n = splitOrchName(name).base; return assistantBases().some((b) => n === b || new RegExp(`^${escapeRe(b)}-\\d+$`).test(n)); };

/** 사이드바용: 이 앱 폴더의 세션(비서)은 따로, 나머지는 프로젝트별로. 순서는 들어온 대로 */
export function groupByProject(
  sessions: Session[],
  orchestratorCwd: string,
): { orchestrator: Session | undefined; orchestrators: Session[]; helpers: Session[]; projects: ProjectGroup[]; external: Session[]; loose: Session[] } {
  const orch = stripSlash(orchestratorCwd);
  // 이 폴더의 비서 이름 세션(⌘T로 여럿 띄운다: 참모·참모-2…, 옛 이름 참모·참모-2)과 터미널에서 연 대화형은 비서 — 이름이 설정 이름인 것이 대표(맨 앞).
  // 그 밖의 이름으로 띄운 백그라운드 세션은 비서가 부린 도우미(예: SNS 올리기) — 비서 화면에 끼면 칸을 차지해서 따로 뺀다(2026-09-28 사용자)
  const inHq = sessions.filter((s) => stripSlash(s.cwd) === orch);
  const helpers = inHq.filter((s) => s.kind === 'background' && s.name !== '' && !orchestratorLike(s.name));
  const here = inHq.filter((s) => !helpers.includes(s));
  const orchestrator = here.find((s) => s.name === assistant()) ?? here.find((s) => isOrchestratorName(s.name)) ?? here[0];
  const orchestrators = orchestrator ? [orchestrator, ...here.filter((s) => s !== orchestrator)] : [];
  // 예약 작업이 아무도 안 보는 곳에서 띄운 대화형 — 프로젝트 세션이 아니라 루틴 칸 "외부 예약"(2026-09-28 아이맥 project-x)
  const external = sessions.filter((s) => s.kind === 'interactive' && s.origin?.unattended && !inHq.includes(s));
  // dev 폴더 자체에서 연 세션 — 프로젝트가 아니라 따로('프로젝트 밖')
  const loose = sessions.filter((s) => s.loose && !inHq.includes(s) && !external.includes(s));
  const byName = new Map<string, Session[]>();
  for (const s of sessions) {
    if (inHq.includes(s) || external.includes(s) || loose.includes(s)) continue;
    const list = byName.get(s.project) ?? [];
    list.push(s);
    byName.set(s.project, list);
  }
  return { orchestrator, orchestrators, helpers, projects: [...byName].map(([name, list]) => ({ name, sessions: list })), external, loose };
}

/** ⌘W 로 끌 수 있나 — 비서 화면의 세션(참모·참모-2…·터미널에서 연 것)은 안 된다. 창 버튼의 끄기만 */
export const closableByShortcut = (s: Session, orchestrators: Session[]): boolean => !orchestrators.some((o) => o.id === s.id) && !isOrchestratorName(s.name);

/** ⌘T로 비서를 하나 더 띄울 때 이름: 참모 → 참모-2 → 참모-3 (지금 있는 가장 큰 번호 다음). 이름은 assistant() */
export function nextOrchestratorName(names: string[]): string {
  const base = assistant();
  const re = new RegExp(`^${escapeRe(base)}-(\\d+)$`);
  const nums = names.map((x) => splitOrchName(x).base).map((n) => (n === base ? 1 : Number(re.exec(n)?.[1] ?? 0))).filter((n) => n > 0);
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
