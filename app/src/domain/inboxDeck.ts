// 결정 대기함을 한 장씩 — 급한 차례·닫힘 규칙·카드 바뀐 직후 누름 막기(시안 docs/design-drafts/inbox-today v2, 2026-11-05 사용자 'C 한 장씩')
import { tr } from '../i18n';
import type { DirectKind } from './directAsk';
import type { InboxItem } from './inbox';

/** 0 = 결제·삭제, 1 = 운영·발송·결정(참모가 정식으로 올린 것·보내기 관문·사람 승인 카드), 2 = 그냥 물음 */
export type Rank = 0 | 1 | 2;
export type DeckPage = { key: string; rank: Rank };

/** 기록된 종류로만 — 참모가 답 끝에 그냥 물은 건 글에 '운영'이 있어도 그냥 물음(낱말로 찾지 않는다, 11-05 사용자) */
export const kindRank = (kind: InboxItem['kind'], gate?: boolean): Rank => (gate || kind === 'decide' ? 1 : 2);
export const itemRank = (i: InboxItem): Rank => kindRank(i.kind, i.gate);
export const directRank = (k: DirectKind): Rank => (k === 'pay' || k === 'delete' ? 0 : 1);

/** 급한 것부터 — 같은 줄 안에선 들어온 차례(안정 정렬) */
export const orderPages = <T extends DeckPage>(pages: T[]): T[] => [...pages].sort((a, b) => a.rank - b.rank);

/** 그냥 물음만 있을 때만 바깥 클릭·Esc 로 닫는다 — 결제·운영 카드가 있으면 종으로만(터미널을 누르거나 Claude 를 Esc 로 멈추다 놓치면 안 돼서) */
export const closesOnOutside = (pages: DeckPage[]): boolean => pages.every((p) => p.rank === 2);

/** 목록이 바뀐 뒤 볼 자리 — 보던 카드가 남아 있으면 그 카드, 빠졌으면(답함) 같은 자리의 다음 카드 */
export function keepIndex(prevKeys: string[], prevIdx: number, keys: string[]): number {
  const cur = prevKeys[prevIdx];
  const at = cur === undefined ? -1 : keys.indexOf(cur);
  if (at >= 0) return at;
  return Math.max(0, Math.min(prevIdx, keys.length - 1));
}

/** 카드가 바뀐 직후엔 누름을 안 받는다 — 넘기기·답한 뒤 다음 카드가 그 자리에 오는데, 따닥 누름이 다음 결제 카드 승인에 떨어지지 않게 */
export const ARM_MS = 450;
export const armed = (changedAt: number, now: number) => now - changedAt >= ARM_MS;

const DAY_START_HOUR = 5;
const dayOf = (t: number) => {
  const d = new Date(t);
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** 카드 시각 — 오늘(새벽 5시부터)이면 시각, 어제면 '어제', 더 전이면 월/일. 날짜 없는 '오후 06:03'이 어제 것인지 몰랐다 */
export function whenText(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const days = Math.round((dayOf(now) - dayOf(t)) / 86_400_000);
  if (days <= 0) return new Date(t).toLocaleTimeString(tr('ko-KR', 'en-US'), { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return tr('어제', 'Yesterday');
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
