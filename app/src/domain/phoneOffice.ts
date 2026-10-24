// 폰 사무실(시안 docs/design-drafts/office-phone v1 A) — 방은 데스크톱 domain/office·ui/office/draw 그대로, 여기선 폰이 가진 재료를 그 입력으로 바꾼다.
// 사무실 모양(자리표·반장·스킨·가구·장식)은 맥 앱이 office.json 으로 쓰고 폰 서버 /api/office 가 읽어 준다. 세션 상태는 폰이 이미 받는 목록·꼬리로
import { workAct, type Activity } from './activity';
import { liveOf, type Live } from './agentBrowser';
import { ownedOf, type GachaFile } from './gacha';
import { placedCells, planRoom, withLounge, type Desk, type Placed, type Room, type Seat } from './office';
import { groupByProject, type Session } from './session';
import { sessionStatus, type ActivityStatus } from './status';

/** 장식 — 데스크톱 OfficeView deco 와 같은 이름. 커피 걷기(배달처럼 반장이 걷는 연출)는 폰 첫 판에서 뺐다 */
export type OfficeDeco = { hat?: string; window?: string; fx?: string; desk?: string; light?: string; title?: string; action?: string; dance?: boolean; hasCat?: boolean; palIds?: string[] };
export type OfficeShape = { slots?: (string | null)[]; boss: string; skin: string; furn: string[]; placed: Record<string, [number, number] | null>; deco: OfficeDeco };

const DECO_STR = ['hat', 'window', 'fx', 'desk', 'light', 'title', 'action'] as const;
const DECO_BOOL = ['dance', 'hasCat'] as const;
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const cell = (v: unknown): [number, number] | null | undefined =>
  v === null ? null : Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [v[0], v[1]] : undefined;

function pickDeco(d: Record<string, unknown>): OfficeDeco {
  const out: OfficeDeco = {};
  for (const k of DECO_STR) if (typeof d[k] === 'string') out[k] = d[k] as string;
  for (const k of DECO_BOOL) if (typeof d[k] === 'boolean') out[k] = d[k] as boolean;
  if (Array.isArray(d.palIds)) out.palIds = strs(d.palIds);
  return out;
}

/** 맥이 쓸 모양 — 아는 칸만(뽑기 기록·코인은 안 싣는다) */
export function officeShape(x: { slots: (string | null)[]; boss: string; skin: string; furn: string[]; placed: Record<string, [number, number] | null>; deco: Record<string, unknown> }): OfficeShape {
  return { slots: x.slots, boss: x.boss, skin: x.skin, furn: x.furn, placed: x.placed, deco: pickDeco(x.deco) };
}

/** /api/office 글 → 모양. 비었거나 깨졌으면 기본 방(나무·곰 반장) — 그래도 세션은 앉는다 */
export function parseOffice(raw: string): OfficeShape {
  let o: Record<string, unknown> = {};
  try { const v: unknown = JSON.parse(raw); if (v && typeof v === 'object' && !Array.isArray(v)) o = v as Record<string, unknown>; } catch { /* 기본 방 */ }
  const placed: Record<string, [number, number] | null> = {};
  if (o.placed && typeof o.placed === 'object') for (const [k, v] of Object.entries(o.placed)) { const c = cell(v); if (c !== undefined) placed[k] = c; }
  return {
    slots: Array.isArray(o.slots) ? o.slots.filter((x): x is string | null => x === null || typeof x === 'string') : undefined,
    boss: typeof o.boss === 'string' && o.boss ? o.boss : 'bear',
    skin: typeof o.skin === 'string' && o.skin ? o.skin : 'wood',
    furn: strs(o.furn),
    placed,
    deco: o.deco && typeof o.deco === 'object' ? pickDeco(o.deco as Record<string, unknown>) : {},
  };
}

// 키·토큰처럼 생긴 것 — 폰 서버 secret_in·메신저 looks_secret 과 같은 축(접두사·낱말·긴 섞인 덩어리)
const SECRET_WORD = /password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|비밀번호|비번|암호|토큰|시크릿/i;
const SECRET_PREFIX = /(?:^|[^A-Za-z0-9])(?:sk-|sk_live_|sk_test_|rk_live_|ghp_|gho_|ghs_|github_pat_|glpat-|xox[abps]-|xapp-|AKIA|AIza|npm_|sb_secret_|eyJ)[A-Za-z0-9_\-.]{10,}/;
const LONG_MIX = /[A-Za-z0-9_\-+/=]{32,}/g;
const looksSecret = (t: string) => SECRET_WORD.test(t) || SECRET_PREFIX.test(t) || (t.match(LONG_MIX) ?? []).some((w) => /\d/.test(w) && /[a-z]/.test(w) && /[A-Z]/.test(w));

/** 머리 위 하는 일 한 줄 — 도구 이름(mcp 앞머리 뗌) + 대상. 대상이 키·토큰처럼 보이면 도구 이름만(폰 화면으로 나가니까) */
export function safeDoing(name: string, target: string): string {
  const n = name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '');
  return target && !looksSecret(target) ? `${n} ${target}`.trim() : n;
}

/** 폰 세션 → 자리 — 데스크톱 App seat 와 같은 판단(일하는 중이면 지시 뒤에 부른 도구로만 행동·한 줄) */
export function phoneSeat(s: Session, status: ActivityStatus, a: Activity | undefined, o: { human?: string; label?: string } = {}): Seat {
  const tool = status === 'working' && a?.tool && (!a.prompt || a.tool.ts >= a.prompt.ts) ? a.tool : undefined;
  return {
    ...(o.human !== undefined ? { human: o.human } : {}),
    id: s.id, label: o.label ?? s.project, project: s.project, status, startedAt: s.startedAt,
    ...(status === 'working' ? { act: workAct(tool), ...(tool ? { doing: safeDoing(tool.name, tool.target) } : {}) } : {}),
  };
}

const rank = (d: Desk) => (d.human !== undefined ? 0 : d.st === 'asks' ? 1 : d.st === 'working' ? 2 : 3);

/** 방 아래 줄 — 사람 필요 → 물어봄 → 일하는 중은 줄로, 나머지(끝남·쉼)는 한 줄로 접는다. 반장·빈 책상은 빼고 */
export function officeList(desks: Desk[], skip?: Set<string>): { rows: Desk[]; rest: Desk[] } {
  const ds = desks.filter((d) => !d.boss && !d.empty && !skip?.has(d.id)).map((d, i) => [d, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([d]) => d);
  return { rows: ds.filter((d) => rank(d) < 3), rest: ds.filter((d) => rank(d) === 3) };
}

// ───────── 사무실에서 참모 바꿔 말하기(10-23 사용자 "바로바로 참모 바꿔가면서 채팅") ─────────
/** 말 걸 수 있는 참모 자리 — 반장 포함, 참모 목록 순서(폰 참모 고르기와 같은 순서) */
export const talkTargets = (desks: Desk[], orchIds: string[]) =>
  orchIds.map((id) => desks.find((d) => d.id === id && !d.empty)).filter((d): d is Desk => !!d);
/** 방·줄에서 누른 것 — 참모면 말 상대 바꾸기, 아니면 그 세션 대화 엿보기 */
export const tapKind = (id: string, orchIds: string[]): 'orch' | 'session' => (orchIds.includes(id) ? 'orch' : 'session');
/** 방 고리 — 고른 프로젝트 세션이 있으면 그것, 없으면 지금 말하는 참모 */
export const ringOf = (picked: string | null, current: string, orchIds: string[]) => (picked && !orchIds.includes(picked) ? picked : current);

/** 홈 머리 사무실 아이콘의 점 — 사람 필요·물어봄이 있을 때 */
export const officeAlert = (desks: Desk[]) => desks.some((d) => !d.empty && (d.human !== undefined || d.st === 'asks'));

/** 장착한 것 → 방 장식 — 데스크톱 사무실 칸과 맥이 쓰는 폰 모양이 같이 쓴다 */
export const gachaDeco = (g: GachaFile) => ({
  hat: g.equip.hat, window: g.equip.window, fx: g.equip.fx, desk: g.equip.desk, light: g.equip.light, title: g.equip.title,
  dance: g.equip.action === 'action.dance', coffee: g.equip.action === 'action.coffee', action: g.equip.action,
  hasCat: (g.owned['friend.cat'] ?? 0) > 0, palIds: ownedOf(g, 'friend').filter((id) => id !== 'friend.cat'),
});

/** 폰 방 — 참모(HQ 세션)는 뒷줄(첫째가 반장), 프로젝트 세션은 앞줄. 데스크톱 App 사무실 칸과 같은 planRoom·withLounge */
export function phoneRoom(x: { sessions: Session[]; hqDir: string; shape: OfficeShape; statusOf: (s: Session) => ActivityStatus; actOf: (s: Session) => Activity | undefined; humanOf: (s: Session) => string | undefined; labelOf: (s: Session) => string }): Room & { furniture: Placed[] } {
  const g = groupByProject(x.sessions, x.hqDir);
  const seat = (s: Session, label?: string) => { const h = x.humanOf(s); return phoneSeat(s, x.statusOf(s), x.actOf(s), { ...(h !== undefined ? { human: h } : {}), ...(label ? { label } : {}) }); };
  const { shape } = x;
  return withLounge(planRoom(
    g.orchestrators.map((s) => seat(s, x.labelOf(s))),
    g.projects.flatMap((p) => p.sessions).map((s) => seat(s)),
    shape.boss, shape.slots, placedCells(shape.furn, shape.placed),
  ), shape.furn, shape.placed);
}

/** 홈 머리 사무실 아이콘 점 — 꼬리 없이 목록만으로(홈은 꼬리를 안 받는다): 확인창·로그인에 멈춤, 세션 브라우저가 사람을 부름. 물어봄(답 끝 질문)은 꼬리가 있어야 보여서 사무실 안에서 */
export function officeDot(sessions: Session[], hqDir: string, lives: Live[]): boolean {
  const g = groupByProject(sessions, hqDir);
  return [...g.orchestrators, ...g.projects.flatMap((p) => p.sessions)].some((s) => ['asks', 'blocked', 'login'].includes(sessionStatus(s)) || !!liveOf(s, lives)?.ask);
}
