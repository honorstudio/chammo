// 종단 암호 봉투 열쇠 감싸기(HPKE P-256) — RFC 9180 부록 A.3.1 벡터를 Rust(e2e_hpke)와 같은 파일로 본다
import { describe, expect, it } from 'vitest';
import V from './hpke-vectors.json';
import { contextR, contextS, ECDH, open, seal } from './hpke';

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** 비밀 스칼라(32) + 공개 점(65) → 꺼낼 수 없는 P-256 비밀 열쇠(앱은 씨앗을 모른다 — 시험만) */
const priv = (d: string, pub: string) => {
  const p = hex(pub);
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: b64(hex(d)), x: b64(p.slice(1, 33)), y: b64(p.slice(33, 65)) }, ECDH, false, ['deriveBits']);
};

describe('HPKE P-256 — RFC 9180 A.3.1', () => {
  it('보내는 쪽 열쇠·base_nonce 가 RFC 와 같다', async () => {
    const eph = { privateKey: await priv(V.skEm, V.pkEm), publicKey: await crypto.subtle.importKey('raw', hex(V.pkEm), ECDH, true, []) };
    const { enc, ctx } = await contextS(hex(V.pkRm), hex(V.info), eph as CryptoKeyPair);
    expect(toHex(enc)).toBe(V.pkEm);
    expect(toHex(ctx.rawKey)).toBe(V.key);
    expect(toHex(ctx.baseNonce)).toBe(V.baseNonce);
  });

  it('번호마다 암호문이 RFC 와 같고, 꺼낼 수 없는 받는 열쇠로 연다', async () => {
    const eph = { privateKey: await priv(V.skEm, V.pkEm), publicKey: await crypto.subtle.importKey('raw', hex(V.pkEm), ECDH, true, []) };
    const { ctx: s } = await contextS(hex(V.pkRm), hex(V.info), eph as CryptoKeyPair);
    const r = await contextR(await priv(V.skRm, V.pkRm), hex(V.pkRm), hex(V.pkEm), hex(V.info));
    for (const e of V.encryptions) {
      s.seq = e.seq;
      r.seq = e.seq;
      const ct = await s.seal(hex(e.aad), hex(V.pt));
      expect(toHex(ct), `seq ${e.seq}`).toBe(e.ct);
      expect(toHex(await r.open(hex(e.aad), ct))).toBe(V.pt);
    }
  });

  it('한 번 봉하기 왕복 · 틀린 열쇠·aad·info 는 실패', async () => {
    const kp = (await crypto.subtle.generateKey(ECDH, false, ['deriveBits'])) as CryptoKeyPair;
    const other = (await crypto.subtle.generateKey(ECDH, false, ['deriveBits'])) as CryptoKeyPair;
    const pk = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    const opk = new Uint8Array(await crypto.subtle.exportKey('raw', other.publicKey));
    const te = new TextEncoder();
    const info = te.encode('chammo-e2e/1 room cid dev');
    const { enc, ct } = await seal(pk, info, te.encode('aad'), te.encode('content key'));
    expect(enc.length).toBe(65);
    expect(new TextDecoder().decode(await open(kp.privateKey, pk, enc, info, te.encode('aad'), ct))).toBe('content key');
    await expect(open(other.privateKey, opk, enc, info, te.encode('aad'), ct)).rejects.toThrow();
    await expect(open(kp.privateKey, pk, enc, info, te.encode('AAD'), ct)).rejects.toThrow();
    await expect(open(kp.privateKey, pk, enc, te.encode('chammo-e2e/1 room cid other'), te.encode('aad'), ct)).rejects.toThrow();
  });

  it('65바이트 비압축 점이 아니면 거절', async () => {
    const kp = (await crypto.subtle.generateKey(ECDH, false, ['deriveBits'])) as CryptoKeyPair;
    const pk = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    await expect(seal(pk.slice(0, 33), new Uint8Array(), new Uint8Array(), new Uint8Array())).rejects.toThrow();
    await expect(open(kp.privateKey, pk, new Uint8Array(64).fill(4), new Uint8Array(), new Uint8Array(), new Uint8Array(32))).rejects.toThrow();
  });
});
