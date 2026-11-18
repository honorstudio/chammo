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
export type DeviceRowView = { id: string; name: string; me: boolean; pending: boolean; online: boolean; meta: string; /** 맥·윈도우 — 컴퓨터끼리 잇기(peerLink) 줄 */ computer: boolean };

/** 이만큼 안에 서버에 닿았으면 '붙음' — 중계는 마지막 시각을 한 시간에 한 번만 적는다(chammo-relay devices.ts LAST_SEEN_GAP_MS).
 *  3분으로 두면 켜진 기기도 거의 늘 '꺼짐'이었다(11-18 사용자). 컴퓨터는 허브가 아는 지금 값(online)이 먼저, 폰·못 받았을 때만 이 창 */
export const ONLINE_MS = 65 * 60_000;
/** 태블릿 — 중계는 폰·태블릿을 다 phone 으로 적어서 이름으로 가른다(폰 입구 phoneName: iPad·Android Tablet, 11-18 사용자 아이패드) */
export const isTablet = (name: string) => /\biPad\b|\bTablet\b|태블릿/i.test(name);
const kindWord = (k: string, name = '') => (k === 'phone' ? (isTablet(name) ? tr('태블릿', 'Tablet') : tr('폰', 'Phone')) : k === 'mac' ? tr('맥', 'Mac') : k === 'win' ? tr('윈도우', 'Windows') : '');
const day = (ms: number) => { const t = new Date(ms); return `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; };

/** 이 기기 맨 위, 허용 대기 다음, 나머지는 최근에 닿은 순 */
/** live = 지금 중계 허브에 붙은 컴퓨터 id(peer_account::devices_online) — null 이면 모름(로그인 전·못 물음) */
export function deviceRows(list: MyDevice[], now: number, live: string[] | null = null): DeviceRowView[] {
  const rank = (x: MyDevice) => (x.current ? 0 : x.status === 'pending' ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0)).map((x) => {
    const pending = x.status === 'pending';
    const computer = x.kind === 'mac' || x.kind === 'win';
    const online = x.current || (!pending && (computer && live ? live.includes(x.id) : x.lastSeen != null && now - x.lastSeen < ONLINE_MS));
    const place = [x.reqCity, x.reqCountry].filter(Boolean).join(', ');
    const meta = pending
      ? [tr('허용 대기', 'Waiting for approval'), kindWord(x.kind, x.name), place].filter(Boolean).join(' · ')
      : [online ? tr('붙음', 'Online') : tr('꺼짐', 'Offline'), kindWord(x.kind, x.name), !online && x.lastSeen ? tr(`마지막 ${day(x.lastSeen)}`, `Last ${day(x.lastSeen)}`) : '', x.approvedBy === 'auto' ? tr('자동 허용', 'Auto-allowed') : ''].filter(Boolean).join(' · ');
    return { id: x.id, name: x.name, me: x.current, pending, online, meta, computer };
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
