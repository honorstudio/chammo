// 폰 계정 시트 — 맥 /api/accounts(Rust accounts_cmd::PhoneView: 이름·요금제·사용량·쉬는 때, 이메일·토큰 없음)를 읽어 줄로.
// 막대·쉬는 판단은 데스크톱 계정 팝오버(domain/accounts popRows)와 같은 것을 쓴다
import { machine } from '../i18n';
import { accountError, allOut, popRows, usageOf, type AccountsView } from './accounts';
import { usageText } from './mobile';
import { fmtUntil, readAuto, slotStatus } from './accountAuto';

export type PhoneAccounts = {
  accounts: { id: string; name: string; plan: string }[];
  active: string | null;
  livePlan: string | null;
  /** 칸에 없는 로그인일 때 — 이메일 앞부분 */
  liveName: string | null;
  switching: boolean;
  auto: unknown;
};

const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** 응답 원문 → 모양을 거른 값. 깨졌으면 null */
export function readPhoneAccounts(text: string): PhoneAccounts | null {
  let o: Record<string, unknown>;
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object') return null;
    o = v as Record<string, unknown>;
  } catch {
    return null;
  }
  const accounts = (Array.isArray(o.accounts) ? o.accounts : []).flatMap((a) => {
    const r = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
    const id = str(r.id);
    return id ? [{ id, name: str(r.name) ?? '', plan: str(r.plan) ?? '' }] : [];
  });
  return { accounts, active: str(o.active), livePlan: str(o.livePlan), liveName: str(o.liveName), switching: o.switching === true, auto: o.auto && typeof o.auto === 'object' ? o.auto : {} };
}

export type PhoneAccountRow = { id: string; name: string; plan: string; on: boolean; pinned: boolean; pinHint: boolean; five: number | null; week: number | null; note: string; rest: string | null };

/** 데스크톱 계정 보기 모양으로 — 이메일은 폰에 안 오니 빈 글 */
const asView = (v: PhoneAccounts): AccountsView => ({ accounts: v.accounts.map((a) => ({ ...a, email: '' })), active: v.active, liveEmail: null, livePlan: v.livePlan, auto: v.auto });

/** 자동 전환이 다 소진을 알았으면 풀리는 때(데스크톱 칩과 같은 글) */
export const phoneAllOut = (v: PhoneAccounts, now: number) => allOut(asView(v), now);

/** 시트 줄 — 이름·5시간·주 남은 %·지금·고정·쉬는 중(자동 전환이 막았거나 95% 넘음) */
export function phoneAccountRows(v: PhoneAccounts, now: number): PhoneAccountRow[] {
  const slots = readAuto(v.auto).slots;
  return popRows(asView(v), now).map((r, i) => {
    const st = slotStatus(slots[r.id], now, r.pinned);
    return { ...r, plan: v.accounts[i]!.plan, rest: st.kind === 'ok' ? null : st.kind === 'auth' ? '로그인 필요' : `${fmtUntil(st.until, now)}까지 쉬는 중` };
  });
}

/** 바꾸기 확인 — 데스크톱 설정 '계정' 칸 안내와 같은 말 */
export function confirmText(r: PhoneAccountRow, autoOn: boolean): { title: string; lines: string[] } {
  const lines = ['돌고 있는 세션도 다음 요청부터 이 계정을 써요. 하던 일은 안 끊겨요.', 'MCP 로그인은 그대로예요.'];
  if (autoOn) lines.push('이 계정에 고정돼요 — 다 쓰면(99%·한도 걸림) 그때 자동 전환이 넘겨요.');
  if (r.rest) lines.push(`이 계정은 ${r.rest}이라 바로 다시 넘어갈 수 있어요.`);
  return { title: `${r.name || '이름 없는'} 계정으로 바꿀까요?`, lines };
}

/** 머리줄에 붙는 지금 계정 이름 — 칸이 하나도 없으면 null(계정 기능을 안 쓰는 맥) */
export function accountHead(v: PhoneAccounts | null): string | null {
  if (!v || !v.accounts.length) return null;
  const a = v.accounts.find((x) => x.id === v.active);
  if (a) return a.name || a.plan || '이름 없음';
  return v.liveName ?? '로그인 없음';
}

/** 서버 오류 글 → 폰 글. 폰은 맥 키체인 창을 안 띄우니(허용 필요 = locked) 맥 앞에서 한 번 하라고 */
export function phoneAccountError(msg: string): string {
  const m = msg.trim();
  if (m === 'too soon') return '방금 바꾸는 중이었어요 — 잠깐 뒤에 다시 눌러 주세요';
  if (m === 'locked' || m === 'denied') return machine() === 'PC' ? '자격 증명을 못 읽었어요 — PC 앞에서 한 번 바꿔 주세요' : `${machine()} 키체인이 잠겼거나 허용이 필요해요 — ${machine()} 앞에서 한 번 바꿔 주세요`;
  if (m === 'unsupported') return `이 ${machine()} 앱은 폰 계정 바꾸기를 아직 몰라요 — ${machine()} 앱을 새로 깔아 주세요`;
  return accountError(m);
}

/** 머리줄 사용량(남은 %) — 지금 칸을 그 계정 토큰으로 물은 값이 있으면 그것(데스크톱 위 막대 usageOf 와 같이), 없으면 상태줄 값.
 *  상태줄은 세션 대화가 오가야 새 계정 값으로 바뀌어서 바꾼 직후엔 옛 계정 숫자다 */
export function headUsage(v: PhoneAccounts | null, statusJson: string, now: number): string {
  const u = v ? usageOf(asView(v), now)?.usage : undefined;
  if (!u) return usageText(statusJson, now);
  return [u.five ? `5시간 ${u.five.left}%` : '', u.week ? `주 ${u.week.left}%` : ''].filter(Boolean).join(' · ');
}
