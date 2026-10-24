// 설정 > 기기 관리 > 다른 기기 참모 — 같은 테일스케일 계정 기기 줄(Rust remote_devices)의 작은 글·할 일(ADR 0007).
// 0.3.2: 코드 없이 '연결' → 그 기기 사람이 카드에서 허용하면 양쪽이 이어진다. 코드는 대피로(옛 판·되묻기가 안 닿을 때)
import type { RemoteDevice } from '../data/remote';
import { tr } from '../i18n';

const stamp = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export type PeerView = {
  /** 연결됨 / 연결 안 됨 — 둘뿐 */
  word: string;
  /** 왜·판·마지막으로 닿은 때 */
  extra: string | null;
  /** '연결'(그 기기에 허용 카드) */
  connect: boolean;
  /** 끊기(이 기기 열쇠 + 그 기기가 쓰던 줄) */
  unlink: boolean;
  /** 코드로 잇기(대피로) */
  code: boolean;
};

/** waiting = 이 기기가 그 기기에 연결을 요청하고 허용을 기다리는 중 */
export function peerView(d: RemoteDevice, waiting: boolean): PeerView {
  const on = d.status === 'connected';
  // 0.3.7 까지 윈도우는 연결을 못 받았다(열쇠 저장소 없음) — 0.3.8 부터 hello 에 link. 맥은 0.3.2 부터 늘 받는다
  const oldWin = d.os.toLowerCase() === 'windows' && !d.link;
  const extra = on ? d.version
    : waiting ? tr('그 기기에서 허용을 기다려요', 'Waiting for that device to allow')
    : d.status === 'offline' ? [tr('꺼져 있음', 'Offline'), d.lastOk ? tr(`마지막 ${stamp(d.lastOk)}`, `last ${stamp(d.lastOk)}`) : null].filter(Boolean).join(' · ')
    : d.old || oldWin ? tr('그 기기 업데이트 필요', 'Update that device')
    : null;
  const reachable = d.status === 'pair' && !oldWin;
  return {
    word: on ? tr('연결됨', 'Connected') : tr('연결 안 됨', 'Not connected'),
    extra: extra || null,
    connect: reachable && !d.old && !waiting,
    unlink: d.paired,
    code: reachable && !waiting,
  };
}
