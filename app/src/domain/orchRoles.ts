// 참모 맡은 일 — 이름(사람이 부르는 말)과 따로 적는 한 줄(2026-10-04 사용자 "업무 담당으로 할 수도, 그냥 이름 짓는 사람도").
// 저장은 맥 <데이터>/orch-roles.json — 열쇠 = 참모 기본 이름(참모-3). 대화 id 는 /clear 때, 짧은 id 는 되살리기 복사본에서 바뀌어서.
// 사람이 적은 게 없으면 최근 7일 작업 기록으로 "주로 a·b". 이름표 훅(scripts/orch-roster)도 같은 규칙. 화면·통신 없음
import { tr } from '../i18n';
import { findTarget } from './inbox';
import { splitOrchName } from './orchLabel';
import { pathKey } from './paths';
import type { Session } from './session';
import type { TaskEvent } from './tasks';

export const ROLE_MAX = 80;
const WINDOW = 7 * 24 * 3600_000;
const TOP = 3;

/** born = 이 이름으로 새 참모를 띄운 때 — 번호가 다시 쓰이면 그 전 기록(옛 참모 것)은 안 센다 */
export type RoleEntry = { role: string; at: number; born?: number };
/** 기본 이름(참모-3) → 사람이 적은 맡은 일 */
export type RoleMap = Record<string, RoleEntry>;

/** 맡은 일 다듬기 — 한 줄·80자. 비면 '' (= 지움) */
export function cleanRole(raw: string): string {
  return [...raw.replace(/\s+/g, ' ').trim()].slice(0, ROLE_MAX).join('').trim();
}

/** 예시 칩 — 눌러서 칸을 채운다(비워도 된다) */
export const roleChips = (): string[] => [tr('개발', 'Dev'), tr('예약·반복 일', 'Schedules'), tr('디자인·시안', 'Design'), tr('문서·조사', 'Docs & research'), tr('앱 업데이트', 'App updates')];

/** /api/roles·read_orch_roles 글 → 글이 있는 칸만 */
export function parseRoles(text: string): RoleMap {
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: RoleMap = {};
    for (const [k, e] of Object.entries(v as Record<string, unknown>)) {
      const r = e && typeof e === 'object' ? (e as { role?: unknown; at?: unknown; born?: unknown }) : null;
      if (!r) continue;
      const role = typeof r.role === 'string' ? r.role : '';
      const born = typeof r.born === 'number' ? r.born : undefined;
      if (role.trim() || born !== undefined) out[k] = { role, at: typeof r.at === 'number' ? r.at : 0, ...(born !== undefined ? { born } : {}) };
    }
    return out;
  } catch {
    return {};
  }
}

const baseOf = (name: string) => splitOrchName(name).base;
const norm = (r: string | undefined) => cleanRole(r ?? '').toLowerCase();

/** 일마다 주인 — handoff(own)가 있으면 그것. 기본 이름(fromName)이 있으면 같이 */
function ownersOf(events: TaskEvent[]): Map<string, { id: string; name?: string }> {
  const m = new Map<string, { id: string; name?: string }>();
  for (const e of events) if ((e.type === 'send' || e.type === 'own') && e.from) m.set(e.task, { id: e.from, ...(e.fromName ? { name: e.fromName } : {}) });
  return m;
}

/** 주인 → 기본 이름. 기록에 적힌 이름이 먼저(id 는 되살리면 바뀐다), 없으면 아는 참모(켜진·꺼진) id 로 */
const ownerBase = (o: { id: string; name?: string } | undefined, known: { id: string; name: string }[]) =>
  o ? (o.name ? baseOf(o.name) : (() => { const k = known.find((x) => x.id === o.id); return k ? baseOf(k.name) : undefined; })()) : undefined;

/**
 * 최근 7일 기록 → 참모(기본 이름)마다 주로 맡긴 프로젝트(많은 순 → 최근 순, 3개).
 * known = 켜진·꺼진 참모(id·이름). 대상이 참모 세션이면(참모끼리 넘김) 빼고, 프로젝트를 모르면 버린다(지어내지 않음)
 */
export function inferRoles(events: TaskEvent[], known: { id: string; name: string }[], sessions: Session[], now: number, opt: { roles?: RoleMap; hq?: string } = {}): Record<string, string[]> {
  const hq = opt.hq ? pathKey(opt.hq) : undefined;
  const own = ownersOf(events);
  const orchIds = new Set(known.map((k) => k.id));
  const orchBases = new Set(known.map((k) => baseOf(k.name)));
  const tally = new Map<string, Map<string, { n: number; at: number }>>();
  for (const e of events) {
    if (e.type !== 'send' || !e.target) continue;
    const at = Date.parse(e.ts);
    if (!(now - at <= WINDOW)) continue;
    const who = ownerBase(own.get(e.task), known);
    if (!who) continue;
    const born = opt.roles?.[who]?.born;
    if (born !== undefined && at < born) continue; // 이 번호를 쓰던 옛 참모의 일
    const t = findTarget(sessions, e.target);
    if ((t && orchIds.has(t.id)) || orchBases.has(baseOf(e.target))) continue;
    if (hq && t && pathKey(t.cwd) === hq) continue; // HQ 도우미에게 보낸 일 — 프로젝트 일이 아니다
    const project = e.project || (t && !t.loose ? t.project : undefined);
    if (!project) continue;
    const per = tally.get(who) ?? new Map<string, { n: number; at: number }>();
    const cur = per.get(project) ?? { n: 0, at: 0 };
    per.set(project, { n: cur.n + 1, at: Math.max(cur.at, at) });
    tally.set(who, per);
  }
  const out: Record<string, string[]> = {};
  for (const [who, per] of tally) out[who] = [...per].sort((a, b) => b[1].n - a[1].n || b[1].at - a[1].at).slice(0, TOP).map(([p]) => p);
  return out;
}

/** 이름 밑 회색 한 줄 — 사람이 적은 맡은 일, 없으면 "주로 a·b", 둘 다 없으면 null */
export function roleLine(name: string, roles: RoleMap, inferred: Record<string, string[]>): { text: string; auto: boolean } | null {
  const b = baseOf(name);
  const set = cleanRole(roles[b]?.role ?? '');
  if (set) return { text: set, auto: false };
  const ps = inferred[b];
  return ps?.length ? { text: tr(`주로 ${ps.join('·')}`, `Mostly ${ps.join(', ')}`), auto: true } : null;
}

/**
 * 멈춘 하위 세션 물음을 받을 참모 — forwardTo 의 앞 단계(마지막에 시킨 참모·같은 프로젝트 참모)로 못 정했을 때만 보조로.
 * ① 그 일을 맡던 참모(꺼짐)와 사람이 적은 맡은 일이 같은 참모(대신 맡으라고 새로 만든 경우) ② 맡은 일 글에 그 프로젝트 이름이 든 참모.
 * 자동 추론은 안 쓴다 — 앞 단계와 같은 기록에서 나와 겹친다. 둘이 맞으면 live 순서(맨 앞 참모 쪽)
 */
export function roleHeir(sub: Session, events: TaskEvent[], live: Session[], known: { id: string; name: string }[], sessions: Session[], roles: RoleMap): Session | undefined {
  const own = ownersOf(events);
  const last = events.filter((e) => e.type === 'send' && e.target).reverse().find((e) => findTarget(sessions, e.target)?.id === sub.id);
  const was = last ? ownerBase(own.get(last.task), known) : undefined;
  const wasRole = was ? norm(roles[was]?.role) : '';
  if (wasRole) {
    const heir = live.find((o) => baseOf(o.name) !== was && norm(roles[baseOf(o.name)]?.role) === wasRole);
    if (heir) return heir;
  }
  const p = sub.project?.toLowerCase();
  if (!p || p.length < 2) return undefined;
  // 단어로만 — 'ui' 가 'build' 안에 걸리지 않게(영문·숫자·_·- 가 붙어 있으면 다른 단어). 한글 조사는 붙어도 된다(gamma-app이랑)
  const word = new RegExp(`(^|[^a-z0-9_-])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9_-])`);
  return live.find((o) => word.test(norm(roles[baseOf(o.name)]?.role)));
}
