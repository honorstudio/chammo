// 설정 > 폰과 메신저 > 다른 기기 참모 — 같은 테일스케일 계정 기기 줄(Rust remote_devices)의 작은 글·할 일(ADR 0007)
import type { RemoteDevice } from '../data/remote';
import { tr } from '../i18n';

const stamp = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 줄 아래 작은 글 — 상태 · 판(또는 마지막으로 닿은 때) */
export function peerSub(d: RemoteDevice): string {
  const word = d.status === 'connected' ? tr('연결됨', 'Connected') : d.status === 'pair' ? tr('짝짓기 필요', 'Needs pairing') : tr('연결 끊김', 'Offline');
  const extra =
    d.status === 'offline' ? (d.lastOk ? tr(`마지막 ${stamp(d.lastOk)}`, `last ${stamp(d.lastOk)}`) : null)
    : d.old ? tr('그 기기 업데이트 필요', 'update that device')
    : d.status === 'connected' ? d.version
    : null;
  return extra ? `${word} · ${extra}` : word;
}

/** pair = 코드로 처음 짝짓기 · repair = 열쇠가 끊겨 다시(끊기도) · unpair = 끊기만 */
export function peerAction(d: RemoteDevice): 'pair' | 'repair' | 'unpair' {
  if (d.status === 'pair') return d.paired ? 'repair' : 'pair';
  return 'unpair';
}
