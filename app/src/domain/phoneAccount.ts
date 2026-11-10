// 폰 — 이 폰 줄이 결제·운영·발송·삭제 카드를 못 받는 까닭(맥 /api/phone-account, 11-09). 직통 줄(테일넷·같은 와이파이 QR,
// 컴퓨터 브라우저로 연 줄 포함)은 계정을 확인할 길이 없어 맥이 그 카드를 숨긴다 — 숨긴 카드가 있을 때만 한 줄과 다시 연결 단추
import { tr } from '../i18n';

export type PhoneAccount = { state: string; hidden: number; entry: string | null };

/** 보일 한 줄(없으면 null) — 입구는 https 만(맥이 준 값이어도 다른 곳으로 안 보낸다) */
export function phoneAccountNote(a: PhoneAccount | null): { text: string; entry: string | null } | null {
  if (!a || a.state === 'same' || !(a.hidden > 0)) return null;
  const text = a.state === 'nologin'
    ? tr('컴퓨터가 Chammo 에 로그아웃해서 결제·운영 카드는 컴퓨터에서 답해 주세요', 'The computer is signed out of Chammo — answer payment and ops cards on the computer')
    : tr('계정 확인 안 됨 — 중계로 다시 연결', 'Account not verified — reconnect through the relay');
  const entry = typeof a.entry === 'string' && /^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(a.entry) ? a.entry : null;
  return { text, entry: a.state === 'nologin' ? null : entry };
}

/** '결제 확인 — … 보내도 돼?'(scripts/task send 종료 코드 3) — 맥 task_is_payment 와 같은 머리 */
export const isPayGate = (q: string) => q.startsWith('결제 확인 — ') || q.startsWith('Payment check — ');

/** 계정 확인이 안 된 폰 줄은 결제 관문 물음도 숨긴다 — 맥이 그 답을 403 으로 막으니 보여 봤자 안 된다(QA 0.4.11 문제 2-1).
 *  맥이 상태를 안 주면(옛 맥·못 읽음) 그대로 둔다 */
export function hidePayGates<T extends { kind: string; q: string }>(list: T[], a: PhoneAccount | null): T[] {
  if (!a || a.state === 'same') return list;
  return list.filter((w) => !(w.kind === 'decide' && isPayGate(w.q)));
}

/** 답이 계정 때문에 막혔을 때(맥 403 "account:<상태>") 한 줄 이유 — 계정 거절이 아니면 null */
export function accountRefusal(message: string): string | null {
  const m = message.trim();
  if (!m.startsWith('account:')) return null;
  return m === 'account:nologin'
    ? tr('컴퓨터가 Chammo 에 로그아웃해서 결제 확인은 컴퓨터에서 답해 주세요', 'The computer is signed out of Chammo — answer payment checks on the computer')
    : tr('이 폰 연결은 계정 확인이 안 돼 결제 확인에 답할 수 없어요 — 중계로 다시 연결하거나 컴퓨터에서 답해 주세요', "This phone connection isn't account-verified, so it can't answer payment checks — reconnect through the relay or answer on the computer");
}
