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

/** 계정 때문에 멈춘 짝의 한 줄(Rust peer_account::word 와 같은 말) */
export function pausedText(p: RemoteDevice['paused']): string {
  if (p === 'nologin') return tr('이 기기가 Chammo 에 로그인하지 않아 연결이 멈췄어요 — 로그인한 뒤 재연결해 주세요', 'Paused because this device is signed out of Chammo — sign in, then pair again');
  if (p === 'unknown') return tr('Chammo 계정을 확인하지 못해 연결이 멈췄어요 — 인터넷을 확인하고 재연결해 주세요', "Paused because the Chammo account couldn't be checked — check the internet, then pair again");
  // 10월 테일넷 짝 — 계정이 바뀐 게 아니라 Chammo 기기 id 를 안 묶은 예전 방식(11-12)
  if (p === 'unbound') return tr('예전 방식으로 연결한 컴퓨터예요. 지금 방식으로 재연결해 주세요', 'Connected the old way. Please reconnect.');
  return tr('계정이 바뀌어 연결이 멈췄어요 — 재연결해 주세요', 'Paused because the account changed — pair again');
}

/** waiting = 이 기기가 그 기기에 연결을 요청하고 허용을 기다리는 중 */
export function peerView(d: RemoteDevice, waiting: boolean): PeerView {
  // 같은 Chammo 계정이 아닌 짝(11-09) — 아무것도 안 오간다. 다시 짝지으면(그쪽 사람이 카드 허용) 다시 된다
  if (d.status === 'account') {
    return { word: tr('연결 멈춤', 'Paused'), extra: waiting ? tr('그 기기에서 허용을 기다려요', 'Waiting for that device to allow') : pausedText(d.paused), connect: !waiting && d.paused !== 'nologin', unlink: d.paired, code: false };
  }
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

type Paused = NonNullable<RemoteDevice['paused']>;
const PAUSED: readonly Paused[] = ['unbound', 'other', 'nologin', 'unknown'];

/** 연결 단추 이름 — 계정 때문에 멈춘 짝은 줄 글('… — 다시 짝짓기')과 같은 말(QA 0.4.11 문제 3-1) */
export const connectLabel = (d: RemoteDevice) => (d.status === 'account' ? tr('재연결', 'Pair again') : tr('연결', 'Connect'));

/** 기기 보기(Far)에서 그 기기가 계정 때문에 멈췄나 — 고를 때 받은 목록 상태(account) 또는 읽기 오류 'account:<코드>'(Rust remote.rs).
 *  꺼진 기기('켜지면 저절로 이어져요')와 달리 기다려도 안 풀린다(문제 3-2). 아니면 null */
export function farPaused(status: RemoteDevice | undefined, err: string | null): Paused | null {
  if (status?.status === 'account') return status.paused ?? 'other';
  const m = err?.trim().match(/^account:(\S+)/);
  if (!m) return null;
  return PAUSED.find((p) => p === m[1]) ?? 'other';
}

/** 그 자리에서 다시 짝지을 수 있나 — 이 기기가 Chammo 에 로그아웃했으면 로그인부터 */
export const canRepair = (p: Paused) => p !== 'nologin';

/** 설정 › 기기 관리 '테일스케일이 있는 분만' 칸을 저절로 펼칠까 — 멈춘 짝이나 계정 확인이 안 된 직통 폰 줄이 있으면(문제 3-3) */
export const tailscaleNeedsLook = (peers: RemoteDevice[], phones: { direct?: boolean }[]) => peers.some((d) => d.status === 'account') || phones.some((g) => !!g.direct);
