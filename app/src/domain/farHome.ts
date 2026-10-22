// 다른 기기 보기(peer-panel) — 그 기기 폰 서버에서 읽은 글(세션 목록·작업 기록·대화 꼬리·보관함)을 화면 모양으로.
// 데스크톱(remote_call)과 폰(이 맥을 거친 /api/peer-get)이 같이 쓴다. 원격이 준 글은 남의 글 — 여기선 읽어서 고르기만 한다
import type { MobileEnv } from '../data/peerApi';
import { summarizeTranscript } from './activity';
import { subStatus } from './mobile';
import { splitOrchName } from './orchLabel';
import { pathKey } from './paths';
import { appRoots, orchestratorLike, parseAgents, withinRoots, type Session } from './session';
import { holderMap } from './spaceNav';
import { parseTaskLog } from './tasks';

export type FarDot = 'run' | 'ask' | 'rest';
export type FarSession = { id: string; name: string; project: string; sessionId?: string; dot: FarDot; doing: string };
/** owner = 맡긴 참모 id(null = 맡긴 참모 없음, 마지막 묶음) */
export type FarGroup = { owner: string | null; sessions: FarSession[] };
export type FarHomeView = { assistants: FarSession[]; groups: FarGroup[] };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 그 기기의 참모 이름 꼴 — 이 기기 기본 이름들(orchestratorLike) + 그 기기 설정 이름(참모-2 · 별명 포함) */
function farAssistant(name: string, base: string): boolean {
  const b = splitOrchName(name).base;
  return orchestratorLike(name) || (!!base && new RegExp(`^${escapeRe(base)}(-\\d+)?$`).test(b));
}

/** 하는 일 한 줄 — 마지막 답 첫 줄(없으면 도구 이름·대상) */
function doingOf(tail: string | undefined): string {
  if (!tail) return '';
  const a = summarizeTranscript(tail);
  const line = (a.reply?.text ?? '').split('\n').map((x) => x.trim()).find(Boolean);
  if (line) return line.slice(0, 120);
  return a.tool ? `${a.tool.name} ${a.tool.target}`.trim().slice(0, 120) : '';
}

function dotOf(s: Session, tails: Readonly<Record<string, string>>, now: number): FarDot {
  const st = subStatus(s, tails, now);
  return st === 'working' ? 'run' : st === 'asks' || st === 'blocked' || st === 'login' ? 'ask' : 'rest';
}

const ORDER: Record<FarDot, number> = { ask: 0, run: 1, rest: 2 };

export function farHome(o: { env: MobileEnv; sessionsRaw: string; tasksText: string; tails: Readonly<Record<string, string>>; now: number }): FarHomeView {
  let all: Session[];
  try {
    all = parseAgents(o.sessionsRaw, o.env.devRoot, o.env.extraProjects ?? []);
  } catch {
    return { assistants: [], groups: [] };
  }
  // Chammo 가 다루는 폴더 안만 — 그 기기에서 사람이 따로 연 터미널·자동화 세션은 안 보인다
  const mine = withinRoots(all, appRoots(o.env.devRoot, o.env.hqDir, o.env.extraProjects ?? []));
  const hq = pathKey(o.env.hqDir);
  const inHq = mine.filter((s) => pathKey(s.cwd) === hq);
  const orchs = inHq.filter((s) => farAssistant(s.name, o.env.assistantName));
  const work = mine.filter((s) => pathKey(s.cwd) !== hq);
  const view = (s: Session): FarSession => ({ id: s.id, name: s.name || s.project, project: s.project, sessionId: s.sessionId, dot: dotOf(s, o.tails, o.now), doing: doingOf(s.sessionId ? o.tails[s.sessionId] : undefined) });
  const ids = orchs.map((s) => s.id);
  const resolve = (t: string) => work.find((s) => s.id === t || s.name === t || s.project === t)?.id;
  const held = holderMap(parseTaskLog(o.tasksText), ids, resolve, o.now);
  const sorted = (xs: Session[]) => xs.map(view).sort((a, b) => ORDER[a.dot] - ORDER[b.dot]);
  const groups: FarGroup[] = ids.map((id) => ({ owner: id, sessions: sorted(work.filter((s) => held.get(s.id)?.includes(id))) })).filter((g) => g.sessions.length > 0);
  const loose = sorted(work.filter((s) => !held.has(s.id)));
  if (loose.length) groups.push({ owner: null, sessions: loose });
  return { assistants: orchs.map(view), groups };
}

export type FarFile = { name: string; rel: string; folder: string | null; size: number; mtime: number };
export type FarOwner = { owner: string; folders: string[]; files: FarFile[] };

/** 그 기기 /api/peer-locker — 참모별(그 기기가 준 순서), 파일은 최근 순. 모양이 틀리면 빈 목록 */
export function farLocker(v: unknown): FarOwner[] {
  const o = (v ?? {}) as { items?: unknown; folders?: unknown; owners?: unknown };
  if (!Array.isArray(o.items)) return [];
  const items = o.items as { owner?: string; rel?: string; folder?: string | null; size?: number; mtime?: number; gone?: boolean }[];
  const folders = (Array.isArray(o.folders) ? o.folders : []) as { owner?: string; name?: string }[];
  const names = [...new Set([...(Array.isArray(o.owners) ? (o.owners as string[]) : []), ...items.map((i) => i.owner ?? '')].filter(Boolean))];
  return names.map((owner) => ({
    owner,
    folders: folders.filter((f) => f.owner === owner && f.name).map((f) => f.name!),
    files: items
      .filter((i) => i.owner === owner && i.rel && !i.gone)
      .map((i) => ({ name: i.rel!.split('/').pop()!, rel: i.rel!, folder: i.folder ?? null, size: i.size ?? 0, mtime: i.mtime ?? 0 }))
      .sort((a, b) => b.mtime - a.mtime),
  }));
}

/** 띠의 기기 단추·폰 기기 줄 — 짝지은 기기가 하나라도 있을 때만(끊긴 기기도 짝은 지은 것). 기기 하나만 쓰는 사람에겐 안 보인다 */
export const showFarButton = (saved: readonly { id: string; name: string }[]): boolean => saved.length > 0;
