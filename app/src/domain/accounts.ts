import { tr } from '../i18n';
import { fmtUntil, readAuto, slotStatus, type SlotAuto } from './accountAuto';
import type { Usage } from './usage';

/** 계정 칸 — 토큰은 화면에 안 온다(키체인에만). Rust accounts_cmd::View */
export type AccountRow = { id: string; name: string; email: string; plan: string };
export type AccountsView = {
  accounts: AccountRow[];
  /** 지금 로그인과 같은 계정 칸 */
  active: string | null;
  liveEmail: string | null;
  livePlan: string | null;
  /** 자동 전환 상태 원본 — domain/accountAuto readAuto 로 읽는다 */
  auto?: unknown;
};

/** 설정에서 계정을 바꾸면 위쪽 막대가 바로 다시 읽게 */
export const ACCOUNTS_CHANGED = 'chammo-accounts-changed';

/** i 번째를 한 칸 위(-1)·아래(1)로 — 끝이면 그대로 */
export function moved(ids: string[], i: number, d: -1 | 1): string[] {
  const j = i + d;
  if (i < 0 || i >= ids.length || j < 0 || j >= ids.length) return ids;
  const out = [...ids];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/** 계정 추가 중 — 앱 안 터미널에서 claude auth login 이 끝나 새 로그인이 들어왔나(시작할 때 이메일과 비교) */
export function addState(v: AccountsView, startEmail: string | null): 'waiting' | 'newLogin' | 'known' {
  if (!v.liveEmail || v.liveEmail === startEmail) return 'waiting';
  return v.active ? 'known' : 'newLogin';
}

/** 위쪽 막대에 보일 지금 계정 — 칸을 하나도 안 만들었으면 안 보인다 */
export function topLabel(v: AccountsView | null): { name: string; title: string; known: boolean } | null {
  if (!v || v.accounts.length === 0) return null;
  const a = v.accounts.find((x) => x.id === v.active);
  if (a) return { name: a.name || a.email, title: tr(`지금 계정: ${[a.name, a.email, a.plan].filter(Boolean).join(' · ')}`, `Current account: ${[a.name, a.email, a.plan].filter(Boolean).join(' · ')}`), known: true };
  if (!v.liveEmail) return { name: tr('로그인 없음', 'Signed out'), title: tr('Claude 에 로그인돼 있지 않아요', 'Not signed in to Claude'), known: false };
  return {
    name: v.liveEmail.split('@')[0] || v.liveEmail,
    title: tr(`칸에 없는 로그인: ${v.liveEmail} — 설정 > 계정에서 보관할 수 있어요`, `Sign-in not in your list: ${v.liveEmail} — keep it in Settings > Accounts`),
    known: false,
  };
}

/** 자동 전환이 다 소진을 알았으면 풀리는 때 — 칩엔 '다 소진'만, 이 글은 마우스 올림·팝오버 */
export function allOut(v: AccountsView | null, now: number): string | null {
  if (!v || !v.accounts.length) return null;
  const a = readAuto(v.auto);
  return a.on && a.allOutUntil && a.allOutUntil > now ? tr(`다 소진 · ${fmtUntil(a.allOutUntil, now)} 풀림`, `All used up · reopens ${fmtUntil(a.allOutUntil, now)}`) : null;
}

/** 설정 칸 상태 글 — 쓸 수 있음 / 5시간 소진 ~22:20 / 주간 소진 ~10/08 16:00 / 한도 걸림 ~19:00 */
export function slotText(st: ReturnType<typeof slotStatus>, now: number): string {
  if (st.kind === 'ok') return tr('쓸 수 있음', 'Available');
  const when = fmtUntil(st.until, now);
  if (st.kind === 'week') return tr(`주간 소진 ~${when}`, `Weekly limit ~${when}`);
  if (st.kind === 'limit') return tr(`한도 걸림 ~${when}`, `Hit the limit ~${when}`);
  return tr(`5시간 소진 ~${when}`, `5-hour limit ~${when}`);
}

/** 위 막대 사용량 — 지금 칸 기록(계정 토큰으로 물은 값·지문이 맞는 상태줄 값)과 몇 ms 전 값인지. 없으면 null(상태줄 값을 쓴다).
 *  계정을 바꾸면 세션 대화가 오가기 전에도 바로 새 계정 값이 보인다 */
export function usageOf(v: AccountsView | null, now: number): { usage: Usage; age: number } | null {
  if (!v?.active) return null;
  const sl = readAuto(v.auto).slots[v.active];
  if (!sl?.seenAt) return null;
  const lim = (w: { used: number; resetsAt: number }) => ({ left: 100 - Math.round(w.used), resetIn: Math.round((w.resetsAt - now) / 1000) });
  const usage: Usage = {};
  if (sl.five && sl.five.resetsAt > now) usage.five = lim(sl.five);
  if (sl.week && sl.week.resetsAt > now) usage.week = lim(sl.week);
  return usage.five || usage.week ? { usage, age: now - sl.seenAt } : null;
}

/** 몇 분 전 값인지 — 방금 / N분 전 / N시간 전 */
export function ageText(ms: number): string {
  if (ms < 60_000) return tr('방금', 'just now');
  if (ms < 3_600_000) return tr(`${Math.floor(ms / 60_000)}분 전`, `${Math.floor(ms / 60_000)}m ago`);
  return tr(`${Math.floor(ms / 3_600_000)}시간 전`, `${Math.floor(ms / 3_600_000)}h ago`);
}

/** 설정 칸 사용량 글 — "5시간 46% · 주간 6% 씀 (3분 전)" */
export function slotUsageText(sl: SlotAuto | undefined, now: number): string | null {
  const parts = [
    sl?.five && sl.five.resetsAt > now ? tr(`5시간 ${Math.round(sl.five.used)}%`, `5h ${Math.round(sl.five.used)}%`) : null,
    sl?.week && sl.week.resetsAt > now ? tr(`주간 ${Math.round(sl.week.used)}%`, `week ${Math.round(sl.week.used)}%`) : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  const age = sl?.seenAt ? ` (${ageText(now - sl.seenAt)})` : '';
  return tr(`${parts.join(' · ')} 씀${age}`, `${parts.join(' · ')} used${age}`);
}

const p2 = (n: number) => String(n).padStart(2, '0');
/** 주간 리셋 시각 — "목 16:00" */
export function weekText(t: number): string {
  const d = new Date(t);
  const day = tr('일월화수목금토'[d.getDay()]!, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]!);
  return `${day} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** 계정 칩 팝오버 한 줄 — 이름·5시간·주간 '남은 %'(위 막대와 같은 기준, 값 없으면 null)·작은 한 줄(리셋 시각·몇 분 전, 막혔으면 그 상태)·마우스 올림(이메일·요금제) */
export type PopRow = { id: string; name: string; on: boolean; pinned: boolean; five: number | null; week: number | null; note: string; title: string };
export function popRows(v: AccountsView | null, now: number): PopRow[] {
  if (!v) return [];
  const auto = readAuto(v.auto);
  return v.accounts.map((a) => {
    const sl = auto.slots[a.id];
    const five = sl?.five && sl.five.resetsAt > now ? sl.five : null;
    const week = sl?.week && sl.week.resetsAt > now ? sl.week : null;
    const st = slotStatus(sl, now);
    const resets = [five && tr(`5시간 ${fmtUntil(five.resetsAt, now)}`, `5h ${fmtUntil(five.resetsAt, now)}`), week && tr(`주간 ${weekText(week.resetsAt)}`, `week ${weekText(week.resetsAt)}`)].filter(Boolean).join(' · ');
    const note = st.kind !== 'ok'
      ? slotText(st, now)
      : [resets && tr(`${resets} 초기화`, `resets ${resets}`), sl?.seenAt && (five || week) ? ageText(now - sl.seenAt) : ''].filter(Boolean).join(' · ');
    return {
      id: a.id,
      name: a.name || a.email,
      on: a.id === v.active,
      pinned: auto.pinned === a.id,
      five: five ? 100 - Math.round(five.used) : null,
      week: week ? 100 - Math.round(week.used) : null,
      note,
      title: [a.email, a.plan].filter(Boolean).join(' · '),
    };
  });
}

/** Rust 오류 이름 → 사람 글 */
export function accountError(code: string): string {
  const [k, ...rest] = code.split(':');
  const detail = rest.join(':');
  switch (k) {
    case 'notLoggedIn': return tr('지금 Claude 에 로그인돼 있지 않아요. 로그인한 뒤 다시 해 주세요.', 'You are not signed in to Claude. Sign in and try again.');
    case 'noOauth': return tr('로그인 정보에 계정 표시(이메일)가 없어요. API 키로 쓰는 중이면 계정 칸을 쓸 수 없어요.', 'The sign-in has no account details (email). Accounts do not work with an API key.');
    case 'unknown': return tr('그 계정 칸이 없어요. 창을 닫았다 다시 열어 주세요.', 'That account is gone. Close and reopen this window.');
    case 'noSlot': return tr('이 계정의 보관된 로그인이 키체인에 없어요. 빼고 다시 추가해 주세요.', 'The kept sign-in for this account is missing from the keychain. Remove it and add it again.');
    case 'mismatch': return tr('로그인이 바뀌는 중인 것 같아요. 터미널 로그인이 끝난 뒤 다시 눌러 주세요.', 'The sign-in seems to be changing. Wait for the terminal sign-in to finish, then try again.');
    case 'denied': return tr('맥이 키체인 사용 허용을 물었는데 거절됐거나 창이 닫혔어요. 다시 누르고, 뜨는 창에 맥 로그인 암호를 넣은 뒤 "항상 허용"을 눌러 주세요.', 'macOS asked to allow keychain access and it was denied or closed. Try again, enter your Mac login password in the window, and choose "Always Allow".');
    case 'locked': return tr('키체인이 잠겼거나 허용을 거절했어요. 맥 잠금을 풀고 다시 해 주세요.', 'The keychain is locked or access was denied. Unlock your Mac and try again.');
    case 'configDir': return tr('CLAUDE_CONFIG_DIR 를 쓰는 중이라 계정 칸을 아직 쓸 수 없어요.', 'Accounts are not supported while CLAUDE_CONFIG_DIR is set.');
    case 'macOnly': return tr('계정 칸은 지금은 맥에서만 돼요.', 'Accounts are Mac-only for now.');
    default: return tr(`계정 일을 못 끝냈어요: ${detail || code}`, `Could not finish: ${detail || code}`);
  }
}
