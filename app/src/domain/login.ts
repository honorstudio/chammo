// 로그인 풀림 판단 — 순수 함수(시계·입력을 받아 다음 기억과 할 일을 돌려준다). 실행은 ui/useLogin. 규칙: docs/plans/2026-10-06-login-expired.md
//  · '로그인 필요' 하나로 묶는다 — 로그인 오류로 멈춘 세션들(activity.auth) + 맥 전체(auth status false · 지금 로그인으로 물은 사용량 401)
//  · 멈춘 뒤 로그인이 새로 됐으면(loginAt — 계정 로그인 claudeAiOauth 가 바뀐 시각, 같은 칸의 MCP 로그인만 바뀐 건 Rust login_at 이 거른다) 고쳐졌을 수 있다 → 백그라운드 세션마다 한 번 '이어서'.
//    떠 있는 세션은 같은 맥의 새 로그인을 다음 요청부터 쓴다(실측 2026-09-26 — /login 뒤 SendMessage 한 통으로 세션 둘 재개)
//  · 이어서 뒤 또 같은 오류: 다른 세션이 그 로그인 뒤 정상 답을 냈으면(자격은 멀쩡) 그 세션만 한 번 다시 띄우고, 아니면 다시 로그인 필요
//  · 고쳐지기 전엔 '이어서'를 보내지 않는다 — 아이맥 2026-10-06 00:30:31, 보낸 즉시 또 'Login expired'
//  · 지금 로그인 미리 갱신(Rust login_keep, ADR 0008)이 만료 15분 전까지 못 받았거나(late) 갱신 토큰이 죽었으면(dead) 세션이 멈추기 전에 같은 카드
//  · 약관 동의 필요(400, 2026-10-28): 로그인은 멀쩡해 로그인 카드에 안 섞는다(terms). 사람이 claude.ai 에서 동의하고 [다시 시도](termsRetryAt)하거나
//    계정 풀이 다른 계정으로 돌리면(loginAt) 그때 이어서 한 번. 다시 띄우기는 안 한다 — 자격 탓이 아니라 그 계정 동의 탓.
//    바꾼 직후(TERMS_GRACE_MS 안) 멈춘 건 돌던 세션의 옛 토큰 탓(2026-10-28 15:47:32) — 카드 없이 RETRY_MS 뒤 이어서 한 번
import { machine, tr } from '../i18n';
import { AUTH_BLOCK_MS, readAuto, TERMS_GRACE_MS } from './accountAuto';
import type { AccountsView } from './accounts';
import type { Activity } from './activity';
import { fwd } from './paths';
import { withinRoots, type Session } from './session';

/** 로그인 직후 이만큼은 기다린다 — `claude auth login` 이 키체인과 oauthAccount 를 다 쓸 때까지 */
export const SETTLE_MS = 3_000;
/** 키체인이 자주 다시 써져도(세션들이 토큰 갱신) 한 세션에 이보다 자주 '이어서'를 안 보낸다 */
export const NUDGE_GAP_MS = 2 * 60_000;
/** 이보다 오래 묵은 멈춤엔 자동으로 이어서를 안 보낸다 — 며칠 전 멈춘 일이 앱을 새로 깔자마자 다시 돌지 않게 */
export const STALE_MS = 6 * 3600_000;
/** 멈춤이 풀린 세션 기억을 이만큼 지나면 잊는다 */
const KEEP_MS = 60 * 60_000;

/** retry = 갱신 겹침(로그인 멀쩡) — 카드 없이 RETRY_MS 뒤 이어서 한 번 */
/** terms = 약관 동의 필요로 멈춤(activity.auth.terms) */
export type Stalled = { session: string; name: string; ts: number; kind: 'background' | 'interactive'; retry?: true; terms?: true };
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
  /** 마지막으로 계정 로그인이 바뀐 시각(로그인·토큰 갱신·계정 바꾸기) — MCP 로그인만 바뀐 건 안 친다(Rust login::login_at). 모르면 null */
  loginAt: number | null;
  /** 앱 문맥(GUI)의 `claude auth status` — 모르면 null. SSH 문맥 값은 키체인을 못 읽어 늘 false 라 쓰지 않는다 */
  loggedIn: boolean | null;
  /** 계정 풀이 지금 로그인 토큰으로 사용량을 물었더니 401·403 이던 시각 — 그 뒤 ok 면 null */
  liveAuthAt: number | null;
  /** 어느 세션이든 로그인 오류 아닌 정상 답을 낸 가장 늦은 시각 — 자격이 멀쩡하다는 증거 */
  okAt: number | null;
  /** 지금 로그인 미리 갱신(Rust login_keep_state) — late = 만료 15분 안인데 못 받음, dead = 갱신 토큰이 죽음. 없으면 잘 되는 중 */
  keep?: Keep | null;
  /** 사람이 약관 카드의 [다시 시도]를 누른 가장 늦은 시각 — 그 전에 멈춘 약관 세션에 이어서 한 번. 없으면 null */
  termsRetryAt?: number | null;
};
export type Keep = 'dead' | 'late';
export type LoginNeed = { since: number; sessions: string[]; machine: boolean; keep?: Keep };
/** 약관 동의를 기다리는 멈춤 — sessions = 이름, ids = 세션 id(채팅 카드를 그 세션을 맡긴 참모에게만), last = 가장 늦은 멈춤 */
export type TermsStall = { since: number; last?: number; sessions: string[]; ids?: string[] };
/** nudge = 로그인 뒤 이어서, retry = 갱신 겹침 뒤 이어서(말이 다르다), respawn = 다시 띄우기, termsNudge = 약관 다시 시도·계정 바뀜 뒤 이어서 */
export type LoginPlan = { mem: LoginMem; need: LoginNeed | null; nudge: string[]; retry: string[]; respawn: string[]; terms: TermsStall | null; termsNudge: string[] };

export const emptyLogin = (): LoginMem => ({ nudged: {}, respawned: {}, retries: {}, machineSince: null });

export function loginStep(prev: LoginMem, inp: LoginInput): LoginPlan {
  const { now, loginAt } = inp;
  const live = new Set(inp.stalled.map((x) => x.session));
  const keep = (m: Record<string, Mark>) => Object.fromEntries(Object.entries(m).filter(([id, v]) => live.has(id) || now - v.at < KEEP_MS));
  const retries = Object.fromEntries(Object.entries(prev.retries ?? {}).filter(([id]) => live.has(id)));
  const mem: LoginMem = { nudged: keep(prev.nudged), respawned: keep(prev.respawned), retries, machineSince: prev.machineSince };
  const nudge: string[] = [], retry: string[] = [], respawn: string[] = [], waiting: Stalled[] = [], termsNudge: string[] = [], termsWaiting: Stalled[] = [];

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
    if (s.terms) {
      const byRetry = (inp.termsRetryAt ?? -Infinity) > s.ts;
      const fix0 = Math.max(loginAt ?? -Infinity, inp.termsRetryAt ?? -Infinity);
      // 계정을 바꾼 직후 멈춤 = 옛 토큰 — 이 멈춤 하나에 이어서 한 번(cred = 멈춘 시각)
      const oldToken = fix0 <= s.ts && loginAt !== null && s.ts - loginAt < TERMS_GRACE_MS;
      const fixAt = oldToken ? s.ts : fix0;
      if (fix0 <= s.ts && !oldToken) { termsWaiting.push(s); continue; }
      if (s.kind !== 'background' || now - s.ts > STALE_MS || now - fixAt < (oldToken ? RETRY_MS : SETTLE_MS)) continue;
      const n = mem.nudged[s.session];
      // 사람이 누른 다시 시도는 간격 없이 — 키체인 갱신이 잦아서 두는 간격(NUDGE_GAP_MS)은 계정 바뀜에만
      // 옛 토큰 멈춤도 간격 없이 — 바꾼 직후 보낸 이어서가 옛 토큰으로 또 멈춘 것(멈춘 시각마다 한 번, 유예 안이라 몇 번 안 된다)
      if (n?.cred !== fixAt && (!n || byRetry || oldToken || now - n.at >= NUDGE_GAP_MS)) {
        termsNudge.push(s.session);
        mem.nudged[s.session] = { cred: fixAt, at: now };
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

  const ks = inp.keep ?? null;
  const machine = inp.loggedIn === false || (inp.liveAuthAt !== null && (loginAt === null || inp.liveAuthAt > loginAt)) || ks !== null;
  mem.machineSince = machine ? (mem.machineSince ?? now) : null;
  const need: LoginNeed | null = waiting.length || machine
    ? { since: Math.min(...waiting.map((x) => x.ts), mem.machineSince ?? Infinity), sessions: waiting.map((x) => x.name), machine, ...(ks ? { keep: ks } : {}) }
    : null;
  const terms = termsWaiting.length ? { since: Math.min(...termsWaiting.map((x) => x.ts)), last: Math.max(...termsWaiting.map((x) => x.ts)), sessions: termsWaiting.map((x) => x.name), ids: termsWaiting.map((x) => x.session) } : null;
  return { mem, need, nudge, retry, respawn, terms, termsNudge };
}

/** 약관 카드 — 계정마다 하나. 약관으로 막힌 칸(자동 전환이 건너뛰는 중이라 멈춘 세션이 없어도 남는다) + 멈춘 세션은 지금 계정 카드에.
 *  id = 계정 칸 id(칸이 없으면 'live'), email 을 모르면 null */
export type TermsCard = { id: string; email: string | null; sessions: string[]; /** 멈춘 세션 id — 채팅 카드는 이 세션을 맡긴 참모에게만 */ sids?: string[] };
export function termsCards(t: TermsStall | null, v: AccountsView | null): TermsCard[] {
  const auto = readAuto(v?.auto);
  const out: TermsCard[] = (v?.accounts ?? [])
    .filter((a) => auto.slots[a.id]?.why === 'terms' && auto.slots[a.id]?.blockedUntil !== undefined)
    .map((a) => ({ id: a.id, email: a.email || null, sessions: [] }));
  if (!t) return out;
  // 막힌 칸이 있으면 멈춤은 그 칸 탓 — 자동 전환이 막 다른 칸으로 넘겼어도(재기가 새 로그인을 보기 전 15초) 넘겨 간 칸 이름으로 카드를 안 띄운다.
  // 단 마지막 칸을 막은 지 유예가 지나 멈췄으면 지금 계정 탓(연쇄라 자동 전환이 넘기지 않고 멈춘 것)
  const at = (id: string) => (auto.slots[id]?.blockedUntil ?? 0) - AUTH_BLOCK_MS;
  const newest = out.reduce<TermsCard | undefined>((m, c) => (!m || at(c.id) > at(m.id) ? c : m), undefined);
  const after = t.last !== undefined && newest !== undefined && t.last > at(newest.id) + TERMS_GRACE_MS;
  const id = out.find((c) => c.id === v?.active)?.id ?? (after ? undefined : newest?.id) ?? v?.active ?? 'live';
  const sids = t.ids?.length ? { sids: t.ids } : {};
  const hit = out.find((c) => c.id === id);
  if (hit) Object.assign(hit, { sessions: t.sessions }, sids);
  else out.push({ id, email: v?.accounts.find((a) => a.id === id)?.email || v?.liveEmail || null, sessions: t.sessions, ...sids });
  return out;
}

/** 닫은 카드 기억 키 — 계정·멈춘 곳이 바뀌면 다른 카드라 다시 뜬다 */
export const termsKey = (c: TermsCard) => JSON.stringify([c.id, c.sessions]);

/** 약관 카드 글 — 동의는 사람이 claude.ai 에서 그 계정으로 */
export function termsText(c: TermsCard): { title: string; where: string } {
  return {
    title: c.email ? tr(`${c.email} 계정이 Claude 새 약관 동의가 필요해요`, `${c.email} needs to accept Claude's new terms`) : tr('지금 계정이 Claude 새 약관 동의가 필요해요', "Your current account needs to accept Claude's new terms"),
    where: c.sessions.length
      ? tr(`멈춘 곳: ${c.sessions.join(' · ')}. claude.ai에 이 계정으로 들어가 약관 창이 뜨면 동의하세요. 안 뜨면 이미 동의한 거예요. 그다음 다시 시도하세요`, `Stopped: ${c.sessions.join(' · ')}. Open claude.ai with this account and accept the terms if asked (no prompt means it's done), then retry`)
      : tr('동의할 때까지 이 계정은 건너뛰어요 — claude.ai 에 이 계정으로 들어가 약관 창이 뜨면 동의, 안 뜨면 이미 된 거예요 — 다시 시도', 'This account is skipped until then — open claude.ai with this account and accept the terms if asked (no prompt means it\'s done), then retry'),
  };
}

/** 약관 다시 시도·계정 바뀜 뒤 이어서 보낼 말 */
export const termsResumedMsg = () => tr('약관 동의로 멈췄던 일 — 동의했거나 다른 계정으로 돌렸어. 하던 데서 이어서 해줘.', 'The work that stopped on the terms notice — the terms were accepted or another account took over. Please continue where you left off.');

/** 로그인 오류로 멈춘 세션 — 일하는 중이면 아니다(이어서를 받아 도는 중). 시각을 못 읽으면 뺀다 */
export function stalledOf(acts: { session: Pick<Session, 'id' | 'name' | 'kind' | 'state'>; activity: Pick<Activity, 'auth'> }[]): Stalled[] {
  return acts.flatMap(({ session: x, activity: a }) => {
    const ts = a.auth ? Date.parse(a.auth.ts) : NaN;
    if (!a.auth || Number.isNaN(ts) || x.state === 'working') return [];
    return [{ session: x.id, name: x.name, ts, kind: x.kind === 'background' ? 'background' : 'interactive', ...(a.auth.retry ? { retry: true } : {}), ...(a.auth.terms ? { terms: true } : {}) } as Stalled];
  });
}

/** 예약 폴더(<데이터>/routines/<이름>)에서 뜬 세션 — 앱 세션 목록(withinRoots) 밖이라 따로 모은다 */
export function routineSessions<T extends { cwd: string }>(all: T[], dataDir: string): T[] {
  return dataDir ? withinRoots(all, [`${fwd(dataDir).replace(/\/+$/, '')}/routines`]) : [];
}

/** 예약 세션 중 진짜 로그인 풀림으로 멈춘 것만 로그인 판단(stalledOf)에 — 갱신 겹침은 예약 tick 이 같은 예약을 다시 돌리니 앱은 이어서를 안 보낸다 */
export function routineStalls<S extends { sessionId?: string }, A extends Pick<Activity, 'auth'>>(subs: S[], activity: Readonly<Record<string, A>>): { session: S; activity: A }[] {
  return subs.flatMap((x) => {
    const a = x.sessionId ? activity[x.sessionId] : undefined;
    return a?.auth && !a.auth.retry ? [{ session: x, activity: a }] : [];
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
export function readProbe(v: unknown): { loggedIn: boolean | null; credAt: number | null; termsRetryAt?: number } {
  const o = (v && typeof v === 'object' ? v : {}) as { loggedIn?: unknown; credAt?: unknown; termsRetryAt?: unknown };
  return {
    loggedIn: typeof o.loggedIn === 'boolean' ? o.loggedIn : null,
    credAt: typeof o.credAt === 'number' && Number.isFinite(o.credAt) ? o.credAt : null,
    ...(typeof o.termsRetryAt === 'number' && Number.isFinite(o.termsRetryAt) ? { termsRetryAt: o.termsRetryAt } : {}),
  };
}

/** 약관 카드 줄(login.json terms·폰) — 모양이 깨진 줄은 버린다 */
export function readTermsCards(v: unknown): TermsCard[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): TermsCard[] => {
    const o = (x ?? {}) as { id?: unknown; email?: unknown; sessions?: unknown; sids?: unknown };
    if (typeof o.id !== 'string' || !Array.isArray(o.sessions)) return [];
    const sids = Array.isArray(o.sids) ? { sids: o.sids.filter((s): s is string => typeof s === 'string') } : {};
    return [{ id: o.id, email: typeof o.email === 'string' ? o.email : null, sessions: o.sessions.filter((s): s is string => typeof s === 'string'), ...sids }];
  });
}

/** Rust login_keep_state 답 — dead·late 만 */
export const readKeep = (v: unknown): Keep | null => (v === 'dead' || v === 'late' ? v : null);

/** 카드 글 — 멈춘 세션이 있으면 그곳, 없으면 미리 갱신 상태, 그 밖엔 이 맥. 짧게 */
export function needText(n: LoginNeed): { title: string; where: string } {
  const late = n.keep === 'late' && !n.sessions.length;
  const title = late ? tr('Claude 로그인이 곧 끝나요', 'Claude sign-in ends soon') : tr('Claude 로그인이 풀렸어요', 'Claude sign-in expired');
  const where = n.sessions.length ? tr(`멈춘 곳: ${n.sessions.join(' · ')}`, `Stopped: ${n.sessions.join(' · ')}`)
    : n.keep === 'late' ? tr('자동 갱신이 막혔어요', 'Auto-renew is blocked')
    : n.keep === 'dead' ? tr('다시 로그인해야 해요', 'Sign in again')
    : tr(`멈춘 곳: 이 ${machine()}`, `Stopped: this ${machine()}`);
  return { title, where };
}

/** 이어서 보낼 말 — 고쳐진 걸 본 뒤에만 보낸다(옛 RESUME_MSG 는 안 보고 "다시 로그인함"이라 했다) */
export const retryMsg = () => tr('로그인 갱신이 잠깐 겹쳐 멈췄었어 — 하던 거 이어서 해줘.', 'A sign-in refresh overlapped and stopped you — please continue.');
export const resumedMsg = () => tr('로그인 다시 됐어 — 로그인 오류로 멈췄던 일, 하던 데서 이어서 해줘.', 'Signed in again — please continue the work that stopped on the sign-in error.');
