// 로그인 풀림 판단 — 순수 함수(시계·입력을 받아 다음 기억과 할 일을 돌려준다). 실행은 ui/useLogin. 규칙: docs/plans/2026-10-06-login-expired.md
//  · '로그인 필요' 하나로 묶는다 — 로그인 오류로 멈춘 세션들(activity.auth) + 맥 전체(auth status false · 지금 로그인으로 물은 사용량 401)
//  · 멈춘 뒤 로그인이 새로 됐으면(loginAt — 키체인 칸을 고친 시각·앱이 본 로그인 끝) 고쳐졌을 수 있다 → 백그라운드 세션마다 한 번 '이어서'.
//    떠 있는 세션은 같은 맥의 새 로그인을 다음 요청부터 쓴다(실측 2026-09-26 — /login 뒤 SendMessage 한 통으로 hello-docs·oms 재개)
//  · 이어서 뒤 또 같은 오류: 다른 세션이 그 로그인 뒤 정상 답을 냈으면(자격은 멀쩡) 그 세션만 한 번 다시 띄우고, 아니면 다시 로그인 필요
//  · 고쳐지기 전엔 '이어서'를 보내지 않는다 — 아이맥 2026-10-06 00:30:31, 보낸 즉시 또 'Login expired'
import { tr } from '../i18n';
import type { Activity } from './activity';
import type { Session } from './session';

/** 로그인 직후 이만큼은 기다린다 — `claude auth login` 이 키체인과 oauthAccount 를 다 쓸 때까지 */
export const SETTLE_MS = 3_000;
/** 키체인이 자주 다시 써져도(세션들이 토큰 갱신) 한 세션에 이보다 자주 '이어서'를 안 보낸다 */
export const NUDGE_GAP_MS = 2 * 60_000;
/** 이보다 오래 묵은 멈춤엔 자동으로 이어서를 안 보낸다 — 며칠 전 멈춘 일이 앱을 새로 깔자마자 다시 돌지 않게 */
export const STALE_MS = 6 * 3600_000;
/** 멈춤이 풀린 세션 기억을 이만큼 지나면 잊는다 */
const KEEP_MS = 60 * 60_000;

/** retry = 갱신 겹침(로그인 멀쩡) — 카드 없이 RETRY_MS 뒤 이어서 한 번 */
export type Stalled = { session: string; name: string; ts: number; kind: 'background' | 'interactive'; retry?: true };
/** 갱신 겹침은 "Try again in a minute" — 그만큼 기다렸다 이어서 */
export const RETRY_MS = 60_000;
/** 갱신 겹침 이어서는 멈춤 한 번(풀릴 때까지)에 세 번까지 — 넘으면 락이 안 풀린 것, 카드로 사람에게 */
export const RETRY_MAX = 3;
/** cred = 그때 쓴 로그인 시각(loginAt), at = 보낸 시각 */
type Mark = { cred: number; at: number };
export type LoginMem = { nudged: Record<string, Mark>; respawned: Record<string, Mark>; /** 갱신 겹침 이어서를 보낸 횟수 — 멈춤 목록에서 빠지면 잊는다 */ retries?: Record<string, number>; /** 맥 전체 로그아웃을 처음 본 시각 */ machineSince: number | null };
export type LoginInput = {
  now: number;
  stalled: Stalled[];
  /** 마지막으로 로그인이 새로 된 시각 — 키체인 칸 고친 시각(로그인·토큰 갱신·계정 바꾸기)과 앱이 본 로그인 끝 중 늦은 것. 모르면 null */
  loginAt: number | null;
  /** 앱 문맥(GUI)의 `claude auth status` — 모르면 null. SSH 문맥 값은 키체인을 못 읽어 늘 false 라 쓰지 않는다 */
  loggedIn: boolean | null;
  /** 계정 풀이 지금 로그인 토큰으로 사용량을 물었더니 401·403 이던 시각 — 그 뒤 ok 면 null */
  liveAuthAt: number | null;
  /** 어느 세션이든 로그인 오류 아닌 정상 답을 낸 가장 늦은 시각 — 자격이 멀쩡하다는 증거 */
  okAt: number | null;
};
export type LoginNeed = { since: number; sessions: string[]; machine: boolean };
/** nudge = 로그인 뒤 이어서, retry = 갱신 겹침 뒤 이어서(말이 다르다), respawn = 다시 띄우기 */
export type LoginPlan = { mem: LoginMem; need: LoginNeed | null; nudge: string[]; retry: string[]; respawn: string[] };

export const emptyLogin = (): LoginMem => ({ nudged: {}, respawned: {}, retries: {}, machineSince: null });

export function loginStep(prev: LoginMem, inp: LoginInput): LoginPlan {
  const { now, loginAt } = inp;
  const live = new Set(inp.stalled.map((x) => x.session));
  const keep = (m: Record<string, Mark>) => Object.fromEntries(Object.entries(m).filter(([id, v]) => live.has(id) || now - v.at < KEEP_MS));
  const retries = Object.fromEntries(Object.entries(prev.retries ?? {}).filter(([id]) => live.has(id)));
  const mem: LoginMem = { nudged: keep(prev.nudged), respawned: keep(prev.respawned), retries, machineSince: prev.machineSince };
  const nudge: string[] = [], retry: string[] = [], respawn: string[] = [], waiting: Stalled[] = [];

  for (const s of inp.stalled) {
    if (s.retry) {
      const n = mem.nudged[s.session];
      if ((retries[s.session] ?? 0) >= RETRY_MAX) { // 세 번 이어서도 또 겹침 — 사람에게
        if (n?.cred !== s.ts || now - n.at >= RETRY_MS) waiting.push(s);
        continue;
      }
      if (s.kind === 'background' && now - s.ts >= RETRY_MS && now - s.ts <= STALE_MS && n?.cred !== s.ts && (!n || now - n.at >= NUDGE_GAP_MS)) {
        retry.push(s.session);
        mem.nudged[s.session] = { cred: s.ts, at: now };
        retries[s.session] = (retries[s.session] ?? 0) + 1;
      }
      continue;
    }
    const fixed = loginAt !== null && loginAt > s.ts; // 멈춘 뒤 로그인이 새로 됐다
    const bg = s.kind === 'background';
    if (fixed) {
      if (!bg) continue; // 터미널 세션은 사람이 '계속'을 친다 — 로그인은 고쳐졌으니 카드는 내린다
      if (now - s.ts > STALE_MS) continue; // 오래 묵은 멈춤 — 로그인은 멀쩡하니 카드도 이어서도 없이 그대로(세션 상태는 '로그인 필요')
      const n = mem.nudged[s.session];
      if (now - loginAt < SETTLE_MS) continue;
      if (n?.cred !== loginAt && (!n || now - n.at >= NUDGE_GAP_MS)) {
        nudge.push(s.session);
        mem.nudged[s.session] = { cred: loginAt, at: now };
      }
      continue; // 보냈거나 이 로그인으로 이미 보냄 — 답을 기다린다
    }
    // 멈춤이 마지막 로그인보다 뒤 — 이어서 뒤 또 막혔으면 자격이 멀쩡한지 보고 다시 띄우기 한 번
    const n = mem.nudged[s.session], r = mem.respawned[s.session];
    const healthy = loginAt !== null && inp.okAt !== null && inp.okAt > loginAt;
    if (bg && n && n.cred === loginAt && s.ts > n.at && healthy && r?.cred !== loginAt) {
      respawn.push(s.session);
      mem.respawned[s.session] = { cred: loginAt!, at: now };
      continue;
    }
    if (bg && r && r.cred === loginAt && s.ts <= r.at) continue; // 다시 띄우는 중 — 옛 오류 줄
    waiting.push(s);
  }

  const machine = inp.loggedIn === false || (inp.liveAuthAt !== null && (loginAt === null || inp.liveAuthAt > loginAt));
  mem.machineSince = machine ? (mem.machineSince ?? now) : null;
  const need = waiting.length || machine
    ? { since: Math.min(...waiting.map((x) => x.ts), mem.machineSince ?? Infinity), sessions: waiting.map((x) => x.name), machine }
    : null;
  return { mem, need, nudge, retry, respawn };
}

/** 로그인 오류로 멈춘 세션 — 일하는 중이면 아니다(이어서를 받아 도는 중). 시각을 못 읽으면 뺀다 */
export function stalledOf(acts: { session: Pick<Session, 'id' | 'name' | 'kind' | 'state'>; activity: Pick<Activity, 'auth'> }[]): Stalled[] {
  return acts.flatMap(({ session: x, activity: a }) => {
    const ts = a.auth ? Date.parse(a.auth.ts) : NaN;
    if (!a.auth || Number.isNaN(ts) || x.state === 'working') return [];
    return [{ session: x.id, name: x.name, ts, kind: x.kind === 'background' ? 'background' : 'interactive', ...(a.auth.retry ? { retry: true } : {}) } as Stalled];
  });
}

/** 정상 답을 낸 가장 늦은 시각 — 로그인 오류로 멈춘 세션의 답(그 오류 글)은 뺀다 */
export function okAtOf(acts: { activity: Pick<Activity, 'auth' | 'reply' | 'limit'> }[]): number | null {
  let best: number | null = null;
  for (const { activity: a } of acts) {
    if (a.auth || a.limit || !a.reply) continue;
    const t = Date.parse(a.reply.ts);
    if (!Number.isNaN(t) && (best === null || t > best)) best = t;
  }
  return best;
}

/** auth status false 는 두 번 연달아 봐야 로그아웃 — 키체인이 잠깐 잠긴 한 번으로 카드·알림·음성이 뜨지 않게. 한 번째는 모름(null) */
export function loggedOutSeen(falses: number, v: boolean | null): { falses: number; loggedIn: boolean | null } {
  if (v !== false) return { falses: 0, loggedIn: v };
  const n = falses + 1;
  return { falses: n, loggedIn: n >= 2 ? false : null };
}

/** Rust login_probe 답 — 모양이 깨졌으면 모름 */
export function readProbe(v: unknown): { loggedIn: boolean | null; credAt: number | null } {
  const o = (v && typeof v === 'object' ? v : {}) as { loggedIn?: unknown; credAt?: unknown };
  return {
    loggedIn: typeof o.loggedIn === 'boolean' ? o.loggedIn : null,
    credAt: typeof o.credAt === 'number' && Number.isFinite(o.credAt) ? o.credAt : null,
  };
}

/** 이어서 보낼 말 — 고쳐진 걸 본 뒤에만 보낸다(옛 RESUME_MSG 는 안 보고 "다시 로그인함"이라 했다) */
export const retryMsg = () => tr('로그인 갱신이 잠깐 겹쳐 멈췄었어 — 하던 거 이어서 해줘.', 'A sign-in refresh overlapped and stopped you — please continue.');
export const resumedMsg = () => tr('로그인 다시 됐어 — 로그인 오류로 멈췄던 일, 하던 데서 이어서 해줘.', 'Signed in again — please continue the work that stopped on the sign-in error.');
