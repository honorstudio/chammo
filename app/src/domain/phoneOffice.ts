// 폰 사무실(시안 docs/design-drafts/office-phone v1 A) — 방은 데스크톱 domain/office·ui/office/draw 그대로, 여기선 폰이 가진 재료를 그 입력으로 바꾼다.
// 사무실 모양(자리표·반장·스킨·가구·장식)은 맥 앱이 office.json 으로 쓰고 폰 서버 /api/office 가 읽어 준다. 세션 상태는 폰이 이미 받는 목록·꼬리로
import { workAct, type Activity } from './activity';
import { liveOf, type Live } from './agentBrowser';
import { officeOfProject, ownedOf, type GachaFile, type OrchSeat } from './gacha';
import { planOffice, type Desk, type OrchIn, type Placed, type Room, type Seat } from './office';
import { newRoom, parseRoom, type OfficeRoom } from './officeRoom';
import { splitOrchName } from './orchLabel';
import { groupByProject, type Session } from './session';
import { sessionStatus, type ActivityStatus } from './status';

/** 장식 — 데스크톱 OfficeView deco 와 같은 이름. 커피 걷기(배달처럼 반장이 걷는 연출)는 폰 첫 판에서 뺐다 */
export type OfficeDeco = { hat?: string; window?: string; fx?: string; desk?: string; light?: string; title?: string; action?: string; dance?: boolean; hasCat?: boolean; palIds?: string[] };
/** offices = 사무실 칸들, slots·skins 는 사무실마다, sprs = 참모 이름 → 고른 캐릭터 도트, off = 꺼졌지만 자리가 남은 참모 */
export type OfficeShape = { offices: OfficeRoom[]; slots: (string | null)[][]; skins: string[]; seats: Record<string, OrchSeat>; assign: Record<string, number>; sprs: Record<string, string>; off: { id: string; name: string; label: string }[]; deco: OfficeDeco };

const DECO_STR = ['hat', 'window', 'fx', 'desk', 'light', 'title', 'action'] as const;
const DECO_BOOL = ['dance', 'hasCat'] as const;
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function pickDeco(d: Record<string, unknown>): OfficeDeco {
  const out: OfficeDeco = {};
  for (const k of DECO_STR) if (typeof d[k] === 'string') out[k] = d[k] as string;
  for (const k of DECO_BOOL) if (typeof d[k] === 'boolean') out[k] = d[k] as boolean;
  if (Array.isArray(d.palIds)) out.palIds = strs(d.palIds);
  return out;
}

/** 맥이 쓸 모양 — 아는 칸만(뽑기 기록·코인은 안 싣는다) */
export function officeShape(x: Omit<OfficeShape, 'deco'> & { deco: Record<string, unknown> }): OfficeShape {
  return { ...x, deco: pickDeco(x.deco) };
}

/** /api/office 글 → 모양. 비었거나 깨졌으면 기본 방 — 그래도 세션은 앉는다 */
export function parseOffice(raw: string): OfficeShape {
  let o: Record<string, unknown> = {};
  try { const v: unknown = JSON.parse(raw); if (isObj(v)) o = v; } catch { /* 기본 방 */ }
  const offices = Array.isArray(o.offices) && o.offices.length ? o.offices.map(parseRoom) : [newRoom()];
  const seats: Record<string, OrchSeat> = {};
  if (isObj(o.seats)) for (const [k, v] of Object.entries(o.seats)) if (isObj(v) && [v.office, v.x, v.y].every((n) => typeof n === 'number')) seats[k] = { office: v.office as number, x: v.x as number, y: v.y as number, ...(typeof v.w === 'number' ? { w: v.w } : {}) };
  const assign: Record<string, number> = {};
  if (isObj(o.assign)) for (const [k, v] of Object.entries(o.assign)) if (typeof v === 'number') assign[k] = v;
  const sprs: Record<string, string> = {};
  if (isObj(o.sprs)) for (const [k, v] of Object.entries(o.sprs)) if (typeof v === 'string') sprs[k] = v;
  return {
    offices,
    slots: Array.isArray(o.slots) ? o.slots.map((t) => (Array.isArray(t) ? t.filter((x): x is string | null => x === null || typeof x === 'string') : [])) : [],
    skins: offices.map((_, i) => { const n = Array.isArray(o.skins) ? o.skins[i] : undefined; return typeof n === 'string' && n ? n : 'wood'; }),
    seats, assign, sprs,
    off: Array.isArray(o.off) ? o.off.filter((x): x is OfficeShape['off'][number] => isObj(x) && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.label === 'string') : [],
    deco: isObj(o.deco) ? pickDeco(o.deco) : {},
  };
}

// 키·토큰처럼 생긴 것 — 폰 서버 secret_in·메신저 looks_secret 과 같은 축(접두사·낱말·긴 섞인 덩어리)
export const SECRET_WORD = /password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|비밀번호|비번|암호|토큰|시크릿/i;
export const SECRET_PREFIX = /(?:^|[^A-Za-z0-9])(?:sk-|sk_live_|sk_test_|rk_live_|ghp_|gho_|ghs_|github_pat_|glpat-|xox[abps]-|xapp-|AKIA|AIza|npm_|sb_secret_|eyJ)[A-Za-z0-9_\-.]{10,}/;
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
/** 방에서 누른 것 — 참모면 그 참모 캐릭터 고르기(말 상대는 아래 참모 줄), 아니면 그 세션 줄 */
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

/** 폰 방들 — 데스크톱 App 사무실 칸과 같은 planOffice. offices = 방금 고친 사무실(뽑기 답이 office.json 보다 빠르다) */
export function phoneRooms(x: { sessions: Session[]; hqDir: string; shape: OfficeShape; offices?: OfficeRoom[]; seats?: Record<string, OrchSeat>; assign?: Record<string, number>; statusOf: (s: Session) => ActivityStatus; actOf: (s: Session) => Activity | undefined; humanOf: (s: Session) => string | undefined; labelOf: (s: Session) => string }): (Room & { furniture: Placed[] })[] {
  const g = groupByProject(x.sessions, x.hqDir);
  const seat = (s: Session, label?: string) => { const h = x.humanOf(s); return phoneSeat(s, x.statusOf(s), x.actOf(s), { ...(h !== undefined ? { human: h } : {}), ...(label ? { label } : {}) }); };
  const { shape } = x, rooms = x.offices ?? shape.offices, seats = x.seats ?? shape.seats, assign = x.assign ?? shape.assign;
  const live: OrchIn[] = g.orchestrators.map((s) => { const name = splitOrchName(s.name).base; return { ...seat(s, x.labelOf(s)), name, ...(shape.sprs[name] ? { spr: shape.sprs[name] } : {}) }; });
  const off: OrchIn[] = shape.off.filter((o) => !live.some((q) => q.name === o.name)).map((o) => ({ id: o.id, name: o.name, label: o.label, project: o.name, status: 'idle', startedAt: 0, off: true, ...(shape.sprs[o.name] ? { spr: shape.sprs[o.name] } : {}) }));
  const workers = g.projects.flatMap((p) => p.sessions);
  const inOffice = (s: Session, i: number) => officeOfProject({ assign, offices: rooms } as GachaFile, s.project) === i;
  return rooms.map((room, i) => planOffice({ room, index: i, orchs: [...live, ...off], workers: workers.filter((s) => inOffice(s, i)).map((s) => seat(s)), slots: shape.slots[i], seats }));
}

/** 홈 머리 사무실 아이콘 점 — 꼬리 없이 목록만으로(홈은 꼬리를 안 받는다): 확인창·로그인에 멈춤, 세션 브라우저가 사람을 부름. 물어봄(답 끝 질문)은 꼬리가 있어야 보여서 사무실 안에서 */
export function officeDot(sessions: Session[], hqDir: string, lives: Live[]): boolean {
  const g = groupByProject(sessions, hqDir);
  return [...g.orchestrators, ...g.projects.flatMap((p) => p.sessions)].some((s) => ['asks', 'blocked', 'login'].includes(sessionStatus(s)) || !!liveOf(s, lives)?.ask);
}
