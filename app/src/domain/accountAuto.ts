// 계정 자동 전환 판단 — 순수 함수(시계·입력을 받아 다음 상태와 할 일을 돌려준다). 실행은 ui/useAccountAuto.
// 규칙(docs/plans/2026-10-02-account-pool.md 2~7, 참모 2026-10-02):
//  · 늘 '쓸 수 있는 것 중 순서가 가장 앞인 칸'. 5시간·주간 사용량 95% 이상이거나 한도 오류로 멈춘 세션이 있으면 소진
//  · 소진 칸엔 다시 열리는 시각(넘은 창의 resets_at, 둘 다면 늦은 쪽)을 적는다. 그 시각이 지나면 앞 순서로 돌아간다
//  · 상태줄 파일엔 어느 계정 값인지 안 적혀 있고, 키체인을 바꿔도 세션마다 쥔 토큰이 달라 한동안 두 계정 값이 번갈아 찍힌다(2026-10-02 실전).
//    그래서 주인은 '지금 계정'이 아니라 **주간 창 시각(지문)** 으로 가린다 — 계정마다 다르고 한 주 동안 그대로다.
//    지문을 모르는 값으로는 절대 막지 않는다. 지금 칸 지문이 없을 때(처음·새 주)만, 모르는 지문 하나가 LEARN_MS 넘게·LEARN_N 번 넘게
//    (파일이 새로 써질 때마다 한 번) 다른 모르는 지문 없이 보이면 그때 배운다 — 번갈아 찍히는 동안은 안 배운다
//  · 계정을 바꾸면 세션마다 첫 요청에 프롬프트 캐시가 깨진다 — 돌아가기는 바꾼 뒤 MIN_GAP_MS 이 지나야, 기록상 꽉 찬 칸으로는 안 넘긴다
//  · 손으로 고르면 고정(소진되면 풀린다). 한도로 멈춘 세션엔 넘긴 뒤 '계속해'를 세션마다 한 번만
import type { Activity } from './activity';
import type { Session } from './session';

export const THRESHOLD = 95;
export const MIN_GAP_MS = 3 * 60_000;
/** 한도 오류인데 다시 열리는 시각을 모를 때 다시 볼 때까지 */
export const UNKNOWN_RESET_MS = 60 * 60_000;
/** 지문 배우기 — 모르는 지문 하나가 이만큼 오래, 이만큼 여러 번 혼자 보여야 */
export const LEARN_MS = 2 * 60_000;
export const LEARN_N = 3;
/** 상태 모양 판 — 다르면 옛 기록(근거 없는 막힘)을 한 번 지운다 */
export const STATE_V = 2;
/** '계속해' 기록을 이만큼 지나면 잊는다 */
const NUDGE_KEEP_MS = 24 * 60 * 60_000;

export type Win = { used: number; resetsAt: number };
export type Why = 'five' | 'week' | 'limit';
/** fp = 이 계정의 주간 창 시각(지문). blockFp = 막을 때의 지문 — 지금 지문과 다르면 그 막힘은 무효.
 *  openedAt = 막힘이 풀린 시각 — 그 전에 난 한도 오류는 이 칸 소진 신호가 아니다 */
export type SlotAuto = { fp?: number; five?: Win; week?: Win; seenAt?: number; blockedUntil?: number; why?: Why; blockFp?: number; openedAt?: number };
/** 배우는 중인 지문 — for 칸 몫으로, first 부터 n 번(파일 고친 시각 lastAt 이 바뀔 때마다) */
export type Learn = { for: string; fp: number; first: number; n: number; lastAt: number };
export type AutoState = {
  v: number | null;
  on: boolean;
  /** 손으로 고른 칸 — 소진되기 전엔 앞 순서로 안 돌아간다 */
  pinned: string | null;
  switchedAt: number | null;
  slots: Record<string, SlotAuto>;
  /** 다 소진 알림을 보낸 '가장 먼저 풀리는 시각' — 같으면 다시 안 알린다 */
  allOutUntil: number | null;
  /** 세션 → '계속해'를 보낸 시각 */
  nudged: Record<string, number>;
  learn: Learn | null;
};
/** 한도 오류로 멈춘 세션(마지막 줄이 그 오류) */
export type Stuck = { session: string; ts: number; resetsAt?: number };
export type UsageAt = { json: string; at: number };
export type Input = { now: number; ids: string[]; active: string | null; usage: UsageAt | null; stuck: Stuck[] };
export type Plan = { state: AutoState; switchTo: string | null; why?: Why | 'back'; nudge: string[]; allOut: { until: number; notify: boolean } | null };

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const win = (v: unknown): Win | undefined => {
  const o = v as { used?: unknown; resetsAt?: unknown } | null;
  const used = num(o?.used);
  const resetsAt = num(o?.resetsAt);
  return used === undefined || resetsAt === undefined ? undefined : { used, resetsAt };
};

/** 저장된 상태(accounts.json auto) — 화면이 쓴 값이지만 깨졌을 수 있다. 칸마다 따로 거른다 */
export function readAuto(v: unknown): AutoState {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const slots: Record<string, SlotAuto> = {};
  for (const [id, raw] of Object.entries((o.slots && typeof o.slots === 'object' ? o.slots : {}) as Record<string, unknown>)) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const s: SlotAuto = {};
    for (const k of ['fp', 'seenAt', 'blockedUntil', 'blockFp', 'openedAt'] as const) {
      const n = num(r[k]);
      if (n !== undefined) s[k] = n;
    }
    const five = win(r.five), week = win(r.week);
    if (five) s.five = five;
    if (week) s.week = week;
    if (r.why === 'five' || r.why === 'week' || r.why === 'limit') s.why = r.why;
    slots[id] = s;
  }
  const nudged: Record<string, number> = {};
  for (const [k, t] of Object.entries((o.nudged && typeof o.nudged === 'object' ? o.nudged : {}) as Record<string, unknown>)) {
    const n = num(t);
    if (n !== undefined) nudged[k] = n;
  }
  const l = (o.learn ?? {}) as Record<string, unknown>;
  const learn = typeof l.for === 'string' && [l.fp, l.first, l.n, l.lastAt].every((x) => num(x) !== undefined)
    ? { for: l.for, fp: l.fp as number, first: l.first as number, n: l.n as number, lastAt: l.lastAt as number }
    : null;
  return {
    v: num(o.v) ?? null,
    on: o.on !== false,
    pinned: typeof o.pinned === 'string' ? o.pinned : null,
    switchedAt: num(o.switchedAt) ?? null,
    slots,
    allOutUntil: num(o.allOutUntil) ?? null,
    nudged,
    learn,
  };
}

/** 상태줄 파일 → 5시간·주간 창. 이미 지난 창은 버린다(옛 창의 퍼센트라서) */
export function readWins(json: string, now: number): { five?: Win; week?: Win } {
  type Raw = { used_percentage?: unknown; resets_at?: unknown };
  let d: { rate_limits?: { five_hour?: Raw; seven_day?: Raw } };
  try {
    d = JSON.parse(json);
  } catch {
    return {};
  }
  const one = (r: Raw | undefined): Win | undefined => {
    const used = num(r?.used_percentage), reset = num(r?.resets_at);
    if (used === undefined || reset === undefined || reset * 1000 <= now) return undefined;
    return { used, resetsAt: reset * 1000 };
  };
  const out: { five?: Win; week?: Win } = {};
  const five = one(d.rate_limits?.five_hour), week = one(d.rate_limits?.seven_day);
  if (five) out.five = five;
  if (week) out.week = week;
  return out;
}

/** 한도 문구의 "resets 11am" · "resets 3:45pm" → 그 뒤 가장 가까운 그 시각(로컬). 없으면 undefined */
export function parseResets(text: string, after: number): number | undefined {
  const m = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(text);
  if (!m) return undefined;
  let h = Number(m[1]) % 12;
  if (m[3]!.toLowerCase() === 'pm') h += 12;
  const d = new Date(after);
  d.setHours(h, Number(m[2] ?? 0), 0, 0);
  if (d.getTime() <= after) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** 기록상 지금 꽉 찬 창 — 늦게 열리는 쪽 시각과 이유. 없으면 null */
function exhausted(s: SlotAuto | undefined, now: number): { until: number; why: Why } | null {
  const weekOut = !!s?.week && s.week.used >= THRESHOLD && s.week.resetsAt > now;
  const fiveOut = !!s?.five && s.five.used >= THRESHOLD && s.five.resetsAt > now;
  if (!weekOut && !fiveOut) return null;
  return { until: Math.max(weekOut ? s!.week!.resetsAt : 0, fiveOut ? s!.five!.resetsAt : 0), why: weekOut ? 'week' : 'five' };
}

/** 설정 칸에 보일 상태 */
export function slotStatus(s: SlotAuto | undefined, now: number): { kind: 'ok' } | { kind: Why; until: number } {
  if (s?.blockedUntil && s.blockedUntil > now) return { kind: s.why ?? 'five', until: s.blockedUntil };
  const ex = exhausted(s, now);
  return ex ? { kind: ex.why, until: ex.until } : { kind: 'ok' };
}

/** 바꿔 끼운 뒤 — 바꾼 시각(돌아오기 간격·한도 오류가 어느 계정 때 났는지 가르는 데) */
export function afterSwitch(s: AutoState, now: number): AutoState {
  return { ...s, switchedAt: now };
}

export function markNudged(s: AutoState, sessions: string[], now: number): AutoState {
  const nudged = { ...s.nudged };
  for (const id of sessions) nudged[id] = now;
  return { ...s, nudged };
}

/** 지문 맞추기 — 상태줄 시각은 초, 사용량 주소 시각은 소수 초(13:19:59.636)라 분으로 맞춘다. 계정마다 주간 창 시각은 시간 단위로 다르다 */
export function fpOf(ms: number): number {
  return Math.round(ms / 60_000) * 60_000;
}

/** 계정 토큰으로 바로 물은 값(Rust accounts_usage) — who = 칸 id. 지금 로그인 값도 Rust 가 키체인과 로그인 표시를
 *  같은 잠금 안에서 읽어 그 칸 id 로 준다(바꿔 끼우는 도중이면 엇갈린다). 칸에 없는 로그인이면 'live' — 버린다 */
export type ApiGot = { who: string; status: string; five?: Win | null; week?: Win | null };

/** 물은 값을 칸 기록에 — 주인이 확실하니 지문도 이걸로 안다. 실패·만료(status != ok)는 손대지 않는다(마지막 값 그대로) */
export function applyApi(prev: AutoState, res: ApiGot[], ids: string[], now: number): AutoState {
  const s: AutoState = { ...prev, slots: { ...prev.slots } };
  for (const r of res) {
    if (r.status !== 'ok' || !ids.includes(r.who)) continue;
    const five = r.five && r.five.resetsAt > now ? r.five : undefined;
    const week = r.week && r.week.resetsAt > now ? r.week : undefined;
    // 지문이 다른 칸 것이면 그 칸 몫 — 돌던 세션이 키체인을 옛 계정 토큰으로 되쓰면 '지금 로그인' 값이 남의 계정 것이다
    const other = week ? ids.find((x) => x !== r.who && s.slots[x]?.fp === fpOf(week.resetsAt)) : undefined;
    const id = other ?? r.who;
    const { five: _f, week: _w, ...rest } = s.slots[id] ?? {};
    s.slots[id] = { ...rest, ...(week ? { fp: fpOf(week.resetsAt), week } : {}), ...(five ? { five } : {}), seenAt: now };
  }
  return s;
}

/** 상태줄 값의 주인을 지문으로 가려 그 칸 기록에 적는다. 모르면 버린다(지금 칸 지문이 없을 때만 배우기) */
function attribute(s: AutoState, ids: string[], active: string, u: UsageAt, now: number) {
  const w = readWins(u.json, now);
  if (!w.week) return; // 지문 없는 값은 누구 것인지 모른다
  const fp = fpOf(w.week.resetsAt);
  let owners = ids.filter((id) => s.slots[id]?.fp === fp);
  // 드물게 두 칸 지문이 같으면 5시간 창 시각으로
  if (owners.length > 1) owners = owners.filter((id) => !!w.five && s.slots[id]?.five?.resetsAt === w.five.resetsAt);
  const write = (id: string) => {
    const { five: _f, week: _w, ...rest } = s.slots[id] ?? {};
    s.slots[id] = { ...rest, ...(w.five ? { five: w.five } : {}), week: w.week!, seenAt: u.at };
  };
  if (owners.length === 1) {
    write(owners[0]!);
    return;
  }
  if (owners.length > 1 || ids.some((id) => s.slots[id]?.fp === fp)) return; // 같은 지문 둘인데 못 가림
  // 어느 칸 지문도 아니다 — 지금 칸 지문이 없거나 지난 주 것일 때만 배운다
  const curFp = s.slots[active]?.fp;
  if (curFp !== undefined && curFp > now) return;
  const l = s.learn;
  if (!l || l.for !== active || l.fp !== fp) s.learn = { for: active, fp, first: now, n: 1, lastAt: u.at };
  else if (u.at !== l.lastAt) s.learn = { ...l, n: l.n + 1, lastAt: u.at };
  const m = s.learn!;
  if (m.n >= LEARN_N && now - m.first >= LEARN_MS) {
    s.slots[active] = { ...s.slots[active], fp };
    write(active);
    s.learn = null;
  }
}

/** 옛 판 기록은 막힘의 근거(지문)가 없다 — 한 번 지운다(2026-10-02 실전: 남의 주간 97% 로 막힌 칸). 묻기(applyApi)보다 먼저 */
export function migrate(prev: AutoState): AutoState {
  return prev.v === STATE_V ? prev : { ...prev, v: STATE_V, slots: {}, allOutUntil: null, learn: null };
}

export function step(prev0: AutoState, inp: Input): Plan {
  const { now, ids, active } = inp;
  const prev = migrate(prev0);
  const s: AutoState = { ...prev, slots: {}, nudged: {} };
  for (const id of ids) if (prev.slots[id]) s.slots[id] = { ...prev.slots[id] };
  for (const [k, t] of Object.entries(prev.nudged)) if (now - t < NUDGE_KEEP_MS) s.nudged[k] = t;
  const none: Plan = { state: s, switchTo: null, nudge: [], allOut: null };
  if (!active || !ids.includes(active)) return none;
  if (s.pinned && s.pinned !== active) s.pinned = null; // 밖에서 바꿨다
  if (s.learn && s.learn.for !== active) s.learn = null;

  // 1. 상태줄 값 → 지문이 맞는 칸 기록
  if (inp.usage) attribute(s, ids, active, inp.usage, now);

  // 2. 지난 창·풀린 막힘·근거가 바뀐 막힘 지우기
  for (const id of Object.keys(s.slots)) {
    const x = s.slots[id]!;
    if (x.five && x.five.resetsAt <= now) delete x.five;
    if (x.week && x.week.resetsAt <= now) delete x.week;
    if (x.blockedUntil !== undefined && x.blockFp !== undefined && x.fp !== undefined && x.blockFp !== x.fp) {
      delete x.blockedUntil; delete x.why; delete x.blockFp;
    }
    if (x.blockedUntil !== undefined && x.blockedUntil <= now) {
      // 막힘 시각이 지나도 기록상 아직 찬 창이 있으면 그 창이 끝날 때까지 — 돌아갔다 바로 또 넘기면 캐시만 두 번 깨진다
      const ex = exhausted(x, now);
      if (ex) {
        x.blockedUntil = ex.until;
        x.why = ex.why;
      } else {
        delete x.blockedUntil; delete x.why; delete x.blockFp;
        x.openedAt = now;
      }
    }
  }
  if (!s.on) return none;

  // 3. 지금 칸이 소진됐나 — 지문이 맞는 기록, 또는 바꾼 뒤·다시 열린 뒤에 난 한도 오류
  const cur = (s.slots[active] ??= {});
  const hits = inp.stuck.filter((x) => x.ts > Math.max(s.switchedAt ?? 0, cur.openedAt ?? 0));
  if (cur.blockedUntil === undefined) {
    const ex = exhausted(cur, now);
    if (ex || hits.length) {
      const fallback = cur.five && cur.five.resetsAt > now ? cur.five.resetsAt : now + UNKNOWN_RESET_MS;
      const textAt = hits.length ? Math.max(...hits.map((h) => (h.resetsAt && h.resetsAt > now ? h.resetsAt : fallback))) : 0;
      cur.blockedUntil = Math.max(ex?.until ?? 0, textAt);
      cur.why = ex?.why ?? 'limit';
      if (cur.fp !== undefined) cur.blockFp = cur.fp;
      if (s.pinned === active) s.pinned = null;
    }
  }

  // 4. 고르기 — 막혔거나 기록상 꽉 찬 칸은 못 쓴다
  const usable = (id: string) => s.slots[id]?.blockedUntil === undefined && !exhausted(s.slots[id], now);
  const avail = ids.filter(usable);
  // 멈춘 세션 중 깨울 것: 아직 안 깨웠거나, 깨운 뒤 또 멈췄는데 그 뒤 쓸 칸이 다시 열린 것(다 소진 → 풀림).
  // 깨운 뒤 그냥 또 멈춘 건 다시 안 보낸다(세션마다 한 번 — 계정이 찬 걸 모르고 계속 깨우지 않게)
  const nudgeFor = (to: string) => inp.stuck
    .filter((x) => s.nudged[x.session] === undefined || (x.ts > s.nudged[x.session]! && x.ts < (s.slots[to]?.openedAt ?? 0)))
    .map((x) => x.session);
  if (!usable(active)) {
    if (!avail.length) {
      const until = Math.min(...ids.map((id) => s.slots[id]?.blockedUntil ?? exhausted(s.slots[id], now)?.until ?? Infinity));
      const notify = s.allOutUntil !== until;
      s.allOutUntil = until;
      return { ...none, allOut: { until, notify } };
    }
    s.allOutUntil = null;
    return { state: s, switchTo: avail[0]!, why: cur.why ?? exhausted(cur, now)?.why ?? 'limit', nudge: nudgeFor(avail[0]!), allOut: null };
  }
  s.allOutUntil = null;
  const front = avail[0];
  if (!s.pinned && front && front !== active && now - (s.switchedAt ?? 0) >= MIN_GAP_MS) {
    return { state: s, switchTo: front, why: 'back', nudge: nudgeFor(front), allOut: null };
  }
  // 지금 칸은 괜찮다 — 바꾸기 전 옛 계정에서 멈춘 세션만 깨운다
  return { ...none, nudge: nudgeFor(active) };
}

const p2 = (n: number) => String(n).padStart(2, '0');
/** 다시 열리는 시각 — 오늘이면 "22:20", 아니면 "10/08 16:00" */
export function fmtUntil(t: number, now: number): string {
  const d = new Date(t), n = new Date(now);
  const hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  return d.toDateString() === n.toDateString() ? hm : `${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${hm}`;
}

/** 손으로 바꾸거나 새 계정을 보관했을 때 자동 상태에 합칠 것 — 그 칸 고정 + 바꾼 시각 */
export function pinPatch(id: string, now: number): Pick<AutoState, 'pinned' | 'switchedAt'> {
  return { pinned: id, switchedAt: now };
}

/** 저장할 것만 — 바뀐 윗단 키(null 이면 지우기). 통째로 쓰면 그새 설정에서 바꾼 키(자동 켜기 등)를 옛 값으로 덮는다 */
export function changedKeys(before: AutoState, after: AutoState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(after) as (keyof AutoState)[]) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[k] = after[k] ?? null;
  }
  return out;
}

/** 한도 오류로 멈춘 백그라운드 세션 — 일하는 중이면 아니다('계속해'를 일하는 세션에 보내지 않게). 대화형(터미널)은 사람 몫 */
export function stuckOf(acts: { session: Pick<Session, 'id' | 'kind' | 'state'>; activity: Pick<Activity, 'limit'> }[]): Stuck[] {
  return acts.flatMap((a) => {
    const l = a.activity.limit;
    const ts = l ? Date.parse(l.ts) : NaN;
    if (!l || Number.isNaN(ts) || a.session.kind !== 'background' || a.session.state === 'working') return [];
    const resetsAt = parseResets(l.text, ts);
    return [{ session: a.session.id, ts, ...(resetsAt ? { resetsAt } : {}) }];
  });
}
