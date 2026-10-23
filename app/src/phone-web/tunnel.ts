// 폰 ↔ 컴퓨터 터널 암호 (ADR 0013) — src-tauri/src/phone_tunnel.rs 와 한 글자도 같게. 같은 시험 값(tunnel-vectors.json)을 두 쪽이 본다.
// 표준 조각만: ECDH P-256 · HKDF-SHA256 · AES-256-GCM (WebCrypto). 폰 비밀 열쇠는 꺼낼 수 없는(extractable: false) CryptoKey 로만 다룬다.
// X25519 가 아닌 까닭: iOS 사파리는 X25519 CryptoKey 를 IndexedDB 에 못 넣는다(오류 없이 null, 2026-10-23 시뮬레이터 실측). 공개 열쇠 = 압축 안 한 점 65바이트
const enc = new TextEncoder();
const SEAL_INFO = enc.encode('chammo-seal/v1');
const TUNNEL_SALT = enc.encode('chammo-tunnel/v1');
const P2M = enc.encode('phone->mac');
const M2P = enc.encode('mac->phone');
const CONFIRM = 'chammo-ok';
export const HELLO = 1;
export const DATA = 2;
export const NONCE_LEN = 16;

const subtle = () => globalThis.crypto.subtle;
type Bytes = Uint8Array<ArrayBuffer>;

export const b64 = (b: Uint8Array): string => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const unb64 = (s: string): Bytes => {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad base64');
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
};
const cat = (...xs: Uint8Array[]): Bytes => {
  const out = new Uint8Array(xs.reduce((n, x) => n + x.length, 0));
  let i = 0;
  for (const x of xs) { out.set(x, i); i += x.length; }
  return out;
};
const rand = (n: number): Bytes => globalThis.crypto.getRandomValues(new Uint8Array(n));

export const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
export const importPublic = (raw: Uint8Array) => subtle().importKey('raw', raw as Bytes, ECDH, true, []);

/** ECDH P-256 합의 — 곡선 위 점이 아니면 WebCrypto 가 거절한다 */
export async function agree(mine: CryptoKey, theirRaw: Uint8Array): Promise<Bytes> {
  if (theirRaw.length !== 65 || theirRaw[0] !== 4) throw new Error('bad key');
  const pub = await importPublic(theirRaw);
  return new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: pub }, mine, 256));
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array): Promise<CryptoKey> {
  const k = await subtle().importKey('raw', ikm as Bytes, 'HKDF', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as Bytes, info: info as Bytes }, k, 256);
  return subtle().importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** 받는 쪽 공개 열쇠로 봉한다 — 일회용 열쇠(65) ‖ iv(12) ‖ 암호문. eph·iv 는 시험 값용 */
export async function seal(to: Uint8Array, pt: Uint8Array, eph?: CryptoKeyPair, iv: Bytes = rand(12)): Promise<Bytes> {
  const pair = eph ?? ((await subtle().generateKey(ECDH, false, ['deriveBits'])) as CryptoKeyPair);
  const ephPub = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  const key = await hkdf(await agree(pair.privateKey, to), cat(ephPub, to), SEAL_INFO);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: SEAL_INFO }, key, pt as Bytes));
  return cat(ephPub, iv, ct);
}

export async function open(me: CryptoKey, mePub: Uint8Array, sealed: Uint8Array): Promise<Bytes> {
  if (sealed.length < 65 + 12 + 16) throw new Error('shape');
  const eph = sealed.slice(0, 65);
  const key = await hkdf(await agree(me, eph), cat(eph, mePub), SEAL_INFO);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: sealed.slice(65, 77), additionalData: SEAL_INFO }, key, sealed.slice(77)));
}

const ctrBytes = (n: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n);
  return b;
};
const nonceOf = (n: bigint) => cat(new Uint8Array(4), ctrBytes(n));

/** 폰 hello 틀 — 1 ‖ {v:1, pk, n} */
export function helloFrame(pk: Uint8Array, n: Uint8Array): Bytes {
  return cat(new Uint8Array([HELLO]), enc.encode(JSON.stringify({ v: 1, pk: b64(pk), n: b64(n) })));
}

/** 한 연결의 열쇠 둘과 번호 — 폰 쪽 */
export class Session {
  private constructor(private readonly sendKey: CryptoKey, private readonly recvKey: CryptoKey, private sendCtr: bigint, private recvCtr: bigint) {}

  /** 컴퓨터 답 hello 를 확인하고 연다. shared = 폰 정적 열쇠 ↔ QR 로 받은 컴퓨터 열쇠 합의 */
  static async connect(shared: Uint8Array, nP: Uint8Array, reply: Uint8Array): Promise<Session> {
    if (reply[0] !== HELLO) throw new Error('shape');
    const v = JSON.parse(new TextDecoder().decode(reply.slice(1))) as { n?: string; c?: string };
    if (typeof v.n !== 'string' || typeof v.c !== 'string') throw new Error('shape');
    const salt = cat(TUNNEL_SALT, nP, unb64(v.n));
    const s = new Session(await hkdf(shared, salt, P2M), await hkdf(shared, salt, M2P), 1n, -1n);
    const c = new TextDecoder().decode(await s.open(unb64(v.c)));
    if (c !== CONFIRM) throw new Error('confirm');
    return s;
  }

  async seal(pt: Uint8Array): Promise<Bytes> {
    const ctr = this.sendCtr++;
    const head = cat(new Uint8Array([DATA]), ctrBytes(ctr));
    return cat(head, new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonceOf(ctr), additionalData: head }, this.sendKey, pt as Bytes)));
  }

  /** 다음 차례 틀만(번호 = 앞 번호 + 1) — 틀린 틀은 번호를 안 올린다 */
  async open(frame: Uint8Array): Promise<Bytes> {
    if (frame.length < 9 + 16 || frame[0] !== DATA) throw new Error('shape');
    const ctr = new DataView(frame.buffer, frame.byteOffset + 1, 8).getBigUint64(0);
    if (ctr !== this.recvCtr + 1n) throw new Error('order');
    const pt = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: nonceOf(ctr), additionalData: frame.slice(0, 9) }, this.recvKey, frame.slice(9)));
    this.recvCtr = ctr;
    return pt;
  }
}
