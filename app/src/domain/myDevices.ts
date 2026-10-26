// 설정 > 기기 관리 — Chammo 계정에 묶인 내 기기 한 목록(시안 device-manage A, ADR 0014). 화면 판단만
import { tr } from '../i18n';
import type { DirectCard } from './directAsk';

export type MyDevice = {
  id: string; name: string; current: boolean;
  /** mac | win | phone | '' */
  kind: string;
  /** approved | pending */
  status: string;
  lastSeen: number | null; reqCity: string; reqCountry: string; pendingSince: number | null;
  /** human | auto(24시간 지나 서버가 허용) | '' */
  approvedBy?: string;
};
export type DeviceRowView = { id: string; name: string; me: boolean; pending: boolean; online: boolean; meta: string };

/** 이만큼 안에 서버에 닿았으면 '붙음' */
const ONLINE_MS = 3 * 60_000;
const kindWord = (k: string) => (k === 'phone' ? tr('폰', 'Phone') : k === 'mac' ? tr('맥', 'Mac') : k === 'win' ? tr('윈도우', 'Windows') : '');
const day = (ms: number) => { const t = new Date(ms); return `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; };

/** 이 기기 맨 위, 허용 대기 다음, 나머지는 최근에 닿은 순 */
export function deviceRows(list: MyDevice[], now: number): DeviceRowView[] {
  const rank = (x: MyDevice) => (x.current ? 0 : x.status === 'pending' ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0)).map((x) => {
    const pending = x.status === 'pending';
    const online = x.current || (!pending && x.lastSeen != null && now - x.lastSeen < ONLINE_MS);
    const place = [x.reqCity, x.reqCountry].filter(Boolean).join(', ');
    const meta = pending
      ? [tr('허용 대기', 'Waiting for approval'), kindWord(x.kind), place].filter(Boolean).join(' · ')
      : [online ? tr('붙음', 'Online') : tr('꺼짐', 'Offline'), kindWord(x.kind), !online && x.lastSeen ? tr(`마지막 ${day(x.lastSeen)}`, `Last ${day(x.lastSeen)}`) : '', x.approvedBy === 'auto' ? tr('자동 허용', 'Auto-allowed') : ''].filter(Boolean).join(' · ');
    return { id: x.id, name: x.name, me: x.current, pending, online, meta };
  });
}

/** 허용된 기기 수(머리 줄) */
export function deviceCounts(list: MyDevice[]): { phones: number; computers: number } {
  const ok = list.filter((x) => x.status !== 'pending');
  return { phones: ok.filter((x) => x.kind === 'phone').length, computers: ok.filter((x) => x.kind !== 'phone').length };
}

/** 그 기기의 기다리는 허용 카드 — 설정의 허용·거절 단추도 이 카드로 답한다(답 길은 카드 하나, Rust direct_answer) */
export function pendingCardFor(cards: DirectCard[], dev: string): string | undefined {
  return cards.find((c) => c.kind === 'link' && c.sub === 'device' && c.dev === dev && c.state === 'wait')?.id;
}
