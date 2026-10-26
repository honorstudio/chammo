// 종단 암호 봉투의 열쇠 감싸기 — HPKE(RFC 9180) base 모드, DHKEM(P-256, HKDF-SHA256) / HKDF-SHA256 / AES-128-GCM
// (chammo-relay ADR 0007 · 계획 2026-10-24 e2e-multiteam §2.3). src-tauri/src/e2e_hpke.rs 와 같은 글 — 두 쪽 다 RFC 부록 A.3.1
// 벡터(hpke-vectors.json)로 고정한다. WebCrypto 만 쓴다(사파리는 X25519 CryptoKey 를 IndexedDB 에 못 넣어 P-256, ADR 0013).
// 받는 쪽 비밀 열쇠는 꺼낼 수 없는 CryptoKey 라 공개 점(65바이트)을 따로 받는다.
export const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
type Bytes = Uint8Array<ArrayBuffer>;

const te = new TextEncoder();
const N_PK = 65;
const i2osp = (n: number, w: number) => {
  const o = new Uint8Array(w);
  for (let i = w - 1; i >= 0; i--, n = Math.floor(n / 256)) o[i] = n & 255;
  return o;
};
const cat = (...a: Bytes[]) => {
  const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let i = 0;
  for (const x of a) o.set(x, i), (i += x.length);
  return o;
};
const KEM = cat(te.encode('KEM'), i2osp(0x10, 2));
const SUITE = cat(te.encode('HPKE'), i2osp(0x10, 2), i2osp(1, 2), i2osp(1, 2));
const V1 = te.encode('HPKE-v1');

async function hmac(key: Bytes, data: Bytes) {
  const k = await crypto.subtle.importKey('raw', key.length ? key : new Uint8Array(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
const extract = (suite: Bytes, salt: Bytes, label: string, ikm: Bytes) => hmac(salt, cat(V1, suite, te.encode(label), ikm));
async function expand(suite: Bytes, prk: Bytes, label: string, info: Bytes, L: number) {
  const full = cat(i2osp(L, 2), V1, suite, te.encode(label), info);
  let t: Bytes = new Uint8Array();
  let out: Bytes = new Uint8Array();
  for (let i = 1; out.length < L; i++) {
    t = await hmac(prk, cat(t, full, Uint8Array.of(i)));
    out = cat(out, t);
  }
  return out.slice(0, L);
}

async function point(b: Bytes) {
  if (b.length !== N_PK || b[0] !== 4) throw new Error('bad key');
  return crypto.subtle.importKey('raw', b, ECDH, false, []);
}

async function sharedSecret(me: CryptoKey, their: Bytes, enc: Bytes, pkR: Bytes) {
  const dh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: await point(their) }, me, 256));
  return expand(KEM, await extract(KEM, new Uint8Array(), 'eae_prk', dh), 'shared_secret', cat(enc, pkR), 32);
}

/** 열쇠 일정 뒤의 상태 — 번호(seq)가 하나씩 는다 */
export class Context {
  seq = 0;
  private constructor(
    readonly rawKey: Bytes,
    readonly baseNonce: Bytes,
    private readonly key: CryptoKey,
  ) {}
  static async create(ss: Bytes, info: Bytes) {
    const ctx = cat(Uint8Array.of(0), await extract(SUITE, new Uint8Array(), 'psk_id_hash', new Uint8Array()), await extract(SUITE, new Uint8Array(), 'info_hash', info));
    const secret = await extract(SUITE, ss, 'secret', new Uint8Array());
    const raw = await expand(SUITE, secret, 'key', ctx, 16);
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    return new Context(raw, await expand(SUITE, secret, 'base_nonce', ctx, 12), key);
  }
  private nonce() {
    const n = this.baseNonce.slice();
    const s = i2osp(this.seq, 8);
    for (let i = 0; i < 8; i++) n[4 + i] = n[4 + i]! ^ s[i]!;
    return n;
  }
  async seal(aad: Bytes, pt: Bytes) {
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: this.nonce(), additionalData: aad }, this.key, pt));
    this.seq++;
    return ct;
  }
  async open(aad: Bytes, ct: Bytes) {
    const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: this.nonce(), additionalData: aad }, this.key, ct));
    this.seq++;
    return pt;
  }
}

/** 보내는 쪽 — 일회용 열쇠를 줄 수 있다(시험·벡터). 안 주면 새로 만든다 */
export async function contextS(pkR: Bytes, info: Bytes, eph?: CryptoKeyPair) {
  await point(pkR);
  const e = eph ?? ((await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair);
  const enc = new Uint8Array(await crypto.subtle.exportKey('raw', e.publicKey));
  return { enc, ctx: await Context.create(await sharedSecret(e.privateKey, pkR, enc, pkR), info) };
}

/** 받는 쪽 — 꺼낼 수 없는 비밀 열쇠 + 내 공개 점 */
export async function contextR(skR: CryptoKey, pkR: Bytes, enc: Bytes, info: Bytes) {
  return Context.create(await sharedSecret(skR, enc, enc, pkR), info);
}

/** 한 번 봉하기 — 받는 기기 공개 열쇠로 */
export async function seal(pkR: Bytes, info: Bytes, aad: Bytes, pt: Bytes) {
  const { enc, ctx } = await contextS(pkR, info);
  return { enc, ct: await ctx.seal(aad, pt) };
}

/** 한 번 열기 */
export async function open(skR: CryptoKey, pkR: Bytes, enc: Bytes, info: Bytes, aad: Bytes, ct: Bytes) {
  return (await contextR(skR, pkR, enc, info)).open(aad, ct);
}
