// 설정 > 기기 관리 '내 기기' 컴퓨터 줄의 잇기(테일스케일 없이 중계로 컴퓨터끼리 — 계획 2026-11-01-peer-relay C-4, 시안 안 A 사용자 11-01).
// Rust: 이어진 줄은 remote_saved 의 relay:<기기 id>, 연결 중·실패는 peer_relay_state
import { tr } from '../i18n';

export type PeerPending = { sas?: string | null; error?: string | null };
export type PeerLinkView = { mode: 'none' | 'linked' | 'pending' | 'connect' | 'off'; sas?: string; error?: string };

export function peerLink(row: { id: string; me: boolean; pending: boolean; online: boolean; computer: boolean }, linked: Set<string>, state: Record<string, PeerPending>): PeerLinkView {
  if (row.me || !row.computer || row.pending) return { mode: 'none' };
  const p = state[row.id];
  if (p?.error) return { mode: 'connect', error: p.error };
  if (p) return p.sas ? { mode: 'pending', sas: p.sas } : { mode: 'pending' };
  if (linked.has(`relay:${row.id}`)) return { mode: 'linked' };
  // '붙음'은 서버 last_seen(한 시간에 한 번)이라 허브에 붙은 컴퓨터도 '꺼짐'일 수 있다(C-5 실측 11-01) — 단추는 늘, 꺼져 있으면 누른 뒤 offline 한 줄
  return { mode: 'connect' };
}

/** Rust peer_pair 오류 갈래 → 사람이 읽는 한 줄(소넷 문구). 모르는 건 그대로 */
export function peerLinkError(code: string, name: string): string {
  switch (code) {
    case 'old': return tr(`${name} 의 Chammo 가 이전 버전이에요. 업데이트한 뒤 다시 시도해 주세요`, `Chammo on ${name} is out of date. Update it, then try again.`);
    case 'declined': return tr('연결이 거절됐어요', 'The connection was declined.');
    case 'offline': return tr(`${name} 의 Chammo 가 꺼져 있어요. 켠 뒤 다시 눌러 주세요`, `Chammo on ${name} is off. Turn it on, then try again.`);
    case 'timeout': return tr('10분 안에 허용되지 않아 연결을 멈췄어요', 'Not allowed within 10 minutes, so the connection was cancelled.');
    default: return code;
  }
}
