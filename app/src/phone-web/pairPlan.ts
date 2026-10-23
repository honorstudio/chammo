// 짝짓기 링크를 받을 때 할 일 (보안 검토 A·D) — 링크 하나로 남의 컴퓨터 화면이 이 출처에 조용히 들어앉지 않게
// - 중계 주소는 입구 설정(config.json)의 것만. QR 의 r 이 다르면 거절(남의 중계로 끌려가지 않게)
// - 이미 다른 컴퓨터와 짝지어 있으면 먼저 확인받고, 바꾸면 받아 둔 화면·열쇠·토큰을 다 지운다
// - 짝지을 때마다 새 열쇠(끊긴 열쇠로 다시 짝지으면 중계가 409). 옛 토큰(prev)은 같은 컴퓨터(m·k 같음)일 때만 보낸다
import { parsePairHash, type PairLink, type RelayLink } from './link';

export type PairPlan =
  | { kind: 'bad'; why: 'shape' | 'relay' | 'config' }
  | { kind: 'confirm'; from: string }
  | { kind: 'pair'; link: PairLink; fresh: true; sendPrev: boolean; wipeAll: boolean };

export function planPair(hash: string, cfgRelay: string | undefined, current: RelayLink | null, confirmed: boolean): PairPlan {
  const p = parsePairHash(hash);
  if (!p) return { kind: 'bad', why: 'shape' };
  if (!cfgRelay) return { kind: 'bad', why: 'config' };
  if (p.relay !== cfgRelay.replace(/\/+$/, '')) return { kind: 'bad', why: 'relay' };
  if (!current) return { kind: 'pair', link: p, fresh: true, sendPrev: false, wipeAll: true };
  const same = current.mac === p.mac && current.macX === p.macX && current.relay === p.relay;
  if (same) return { kind: 'pair', link: p, fresh: true, sendPrev: true, wipeAll: false };
  if (!confirmed) return { kind: 'confirm', from: current.macName ?? '지금 컴퓨터' };
  return { kind: 'pair', link: p, fresh: true, sendPrev: false, wipeAll: true };
}
