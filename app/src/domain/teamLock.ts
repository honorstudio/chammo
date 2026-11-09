// 팀 권한(chammo-relay ADR 0015 — 권한 = 결제 경계) 화면 고르기. 판단은 늘 서버가 다시 한다:
// 여기선 서버가 /v0/me 로 준 plan 과 Rust 가 402 에 붙인 [plan:까닭] 꼬리표로 문의 창·소개 판·'읽기만' 줄을 고를 뿐.
// 옛 중계(plan 없음)면 예전 화면 그대로

/** Rust team_relay::TeamPlan — /v0/me plan 을 그대로 */
export type TeamPlan = { lock: boolean; canCreate: boolean; reason: string; max: number; used: number; contact: string };
export type CreateLock = { kind: 'create' } | { kind: 'expired' } | { kind: 'max'; max: number };

/** 서버가 문의 주소를 안 줬을 때(옛 중계·이상한 값) — 약관에 공개된 연락처 */
export const DEFAULT_CONTACT = `mailto:support@honorstudio.co.kr?subject=${encodeURIComponent('Chammo 팀 권한 문의')}`;

const lockOf = (reason: string, max = 0): CreateLock => (reason === 'team_expired' ? { kind: 'expired' } : reason === 'team_max' ? { kind: 'max', max } : { kind: 'create' });

/** 새 팀 만들기 대신 문의 창을 띄울까 — 서버가 '만들 수 없음'이라 했을 때만 */
export function createLock(plan: TeamPlan | null | undefined): CreateLock | null {
  if (!plan || plan.canCreate) return null;
  return lockOf(plan.reason, plan.max);
}

/** Rust why_register 가 팀 만들기 402 에 붙인 꼬리표 — 맨 앞만 본다(남이 보낸 글이 흉내 내지 못하게) */
export function planErr(raw: string): CreateLock | null {
  const m = /^\[plan:(team_create|team_expired|team_max)\]\s*/.exec(raw);
  if (!m) return null;
  return lockOf(m[1]!, Number(/(\d+)개까지/.exec(raw)?.[1] ?? 0));
}

type IntroView = { joined: boolean; account: unknown; plan?: TeamPlan | null; teams?: { id: string }[] } | null;

/** 레일 + 자리에 '팀' 칸(소개 판, 시안 team-lock v1 C) — 로그인했고 팀이 하나도 없는데 서버가 만들 수 없다고 할 때.
 *  로그인 전은 아니다 — 레일 + 는 로그인 칸(TeamStart)을 연다(11-05 로그인은 메신저를 처음 쓸 때, ADR 0027) */
export function showIntro(v: IntroView): boolean {
  if (!v || v.joined || (v.teams?.length ?? 0) > 0 || !v.account) return false;
  return createLock(v.plan) !== null;
}

type ClosedView = { teamId: string; role: string; teams?: { id: string; closed?: boolean }[] } | null;

/** 지금 팀이 읽기만(권한 끝남)이면 위 한 줄 — 팀장은 문의하기 단추가 붙는다 */
export function closedLine(v: ClosedView): { owner: boolean } | null {
  if (!v || !v.teams?.some((t) => t.id === v.teamId && t.closed)) return null;
  return { owner: v.role === 'owner' };
}

/** 문의 주소 — 서버가 준 https·mailto 만(앱 '바깥 열기'로 가서 좁힌다, Rust contact_ok 와 같은 모양) */
export function contactOf(plan: TeamPlan | null | undefined): string {
  const c = plan?.contact ?? '';
  const ok = (c.startsWith('https://') || c.startsWith('mailto:')) && c.length <= 300 && !/[\s\u0000-\u001f\u007f]/.test(c);
  return ok ? c : DEFAULT_CONTACT;
}
