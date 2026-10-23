// 이 폰이 짝지은 컴퓨터(중계 길) — 공개 값만 localStorage 에. 열쇠는 keys.ts(IndexedDB), 토큰은 data/web.ts 와 같은 'chammo.token'
export type RelayLink = {
  /** 중계 주소(https://…) — QR 에서 */
  relay: string;
  /** 컴퓨터의 중계 기기 id = 허브 id */
  mac: string;
  /** 컴퓨터 터널 공개 열쇠(P-256, 65바이트) — QR 에서. 중계가 바꿀 수 없다 */
  macX: string;
  /** 이 폰의 중계 기기 id — 컴퓨터가 들여 준 것 */
  device: string;
  /** 컴퓨터 이름(화면 표시) */
  macName?: string;
};

const KEY = 'chammo.relay';
/** 짝짓기 QR 의 # 뒤(p·m·k·r) */
export type PairLink = { code: string; mac: string; macX: string; relay: string };

export function readLink(): RelayLink | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as RelayLink | null;
    return v && typeof v.relay === 'string' && typeof v.mac === 'string' && typeof v.macX === 'string' && typeof v.device === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function saveLink(l: RelayLink | null) {
  try {
    if (l) localStorage.setItem(KEY, JSON.stringify(l));
    else localStorage.removeItem(KEY);
  } catch { /* 개인 정보 보호 모드 — 짝짓기 전에 열쇠 저장에서 먼저 걸린다 */ }
}

/** 중계 길인가 — 컴퓨터 화면(data/web.ts)이 전송 길을 고를 때 */
export const relayMode = () => readLink() !== null;

const HEX32 = /^[0-9a-f]{32}$/;
const KEY65 = /^B[A-Za-z0-9_-]{86}$/; // 압축 안 한 P-256 점(04…) 65바이트 base64url
const ID = /^[A-Za-z0-9-]{1,64}$/;

/** QR 주소의 # 뒤 → 짝짓기 값. 모양이 틀리면 null. 중계 주소는 https(개발은 로컬 http)만 */
export function parsePairHash(hash: string): PairLink | null {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const code = (q.get('p') ?? '').toLowerCase();
  const mac = q.get('m') ?? '';
  const macX = q.get('k') ?? '';
  const relay = (q.get('r') ?? '').replace(/\/+$/, '');
  if (!HEX32.test(code) || !ID.test(mac) || !KEY65.test(macX)) return null;
  let u: URL;
  try { u = new URL(relay); } catch { return null; }
  const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && local)) || u.pathname !== '/' || u.search || u.hash || u.username) return null;
  return { code, mac, macX, relay: u.origin };
}
