// 폰 터널 암호가 컴퓨터(Rust phone_tunnel)와 같은 값을 내는지 — 고정 시험 값 파일을 두 쪽이 본다
import { describe, expect, it } from 'vitest';
import V from './tunnel-vectors.json';
import { agree, b64, ECDH, helloFrame, open, seal, Session, unb64 } from './tunnel';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** 씨앗(32) + 공개 점(65) → P-256 비밀 열쇠 — 시험만(앱은 씨앗을 모르는 꺼낼 수 없는 열쇠) */
const priv = (seed: string, pub: string) => {
  const p = unb64(pub);
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: seed, x: b64(p.slice(1, 33)), y: b64(p.slice(33, 65)) }, ECDH, false, ['deriveBits']);
};

describe('터널 암호 — Rust 와 같은 값', () => {
  it('봉하기: 같은 일회용 열쇠·iv 면 같은 상자', async () => {
    const ephPub = b64(unb64(V.seal.out).slice(0, 65));
    const eph = { privateKey: await priv(V.seal.ephSeed, ephPub), publicKey: await crypto.subtle.importKey('raw', unb64(ephPub), ECDH, true, []) };
    const out = await seal(unb64(V.macPub), enc.encode(V.seal.pt), eph as CryptoKeyPair, unb64(V.seal.iv));
    expect(b64(out)).toBe(V.seal.out);
  });

  it('봉한 것을 받는 쪽 열쇠로 연다 · 다른 열쇠·바뀐 상자는 실패', async () => {
    const mac = await priv(V.macSeed, V.macPub);
    expect(dec.decode(await open(mac, unb64(V.macPub), unb64(V.seal.out)))).toBe(V.seal.pt);
    const phone = await priv(V.phoneSeed, V.phonePub);
    await expect(open(phone, unb64(V.phonePub), unb64(V.seal.out))).rejects.toThrow();
    const bad = unb64(V.seal.out);
    bad[bad.length - 1] = bad.at(-1)! ^ 1;
    await expect(open(mac, unb64(V.macPub), bad)).rejects.toThrow();
  });

  it('컴퓨터 답 hello → 세션: 컴퓨터 틀을 열고, 폰 틀은 Rust 와 같은 바이트', async () => {
    const shared = await agree(await priv(V.phoneSeed, V.phonePub), unb64(V.macPub));
    const s = await Session.connect(shared, unb64(V.tunnel.nP), unb64(V.tunnel.reply));
    expect(dec.decode(await s.open(unb64(V.tunnel.m2p)))).toBe(V.tunnel.m2pPt);
    expect(b64(await s.seal(enc.encode(V.tunnel.p2mPt)))).toBe(V.tunnel.p2m);
  });

  it('번호 되감기·건너뛰기는 거절, 틀린 틀은 번호를 안 올린다', async () => {
    const shared = await agree(await priv(V.phoneSeed, V.phonePub), unb64(V.macPub));
    const s = await Session.connect(shared, unb64(V.tunnel.nP), unb64(V.tunnel.reply));
    const f = unb64(V.tunnel.m2p);
    const t = f.slice();
    t[t.length - 1] = t.at(-1)! ^ 1;
    await expect(s.open(t)).rejects.toThrow();
    await s.open(f);
    await expect(s.open(f)).rejects.toThrow('order');
  });

  it('QR 의 컴퓨터 열쇠가 바꿔치기되면 확인이 안 풀린다', async () => {
    const fake = (await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
    const fakePub = new Uint8Array(await crypto.subtle.exportKey('raw', fake.publicKey));
    const wrong = await agree(await priv(V.phoneSeed, V.phonePub), fakePub);
    await expect(Session.connect(wrong, unb64(V.tunnel.nP), unb64(V.tunnel.reply))).rejects.toThrow();
  });

  it('hello 틀 모양 = 1 ‖ {v,pk,n}', () => {
    const f = helloFrame(unb64(V.phonePub), unb64(V.tunnel.nP));
    expect(f[0]).toBe(1);
    expect(JSON.parse(dec.decode(f.slice(1)))).toEqual({ v: 1, pk: V.phonePub, n: V.tunnel.nP });
  });

  it('곡선 위 점이 아니면 합의를 거절한다', async () => {
    await expect(agree(await priv(V.phoneSeed, V.phonePub), new Uint8Array(65))).rejects.toThrow();
    const bad = unb64(V.macPub);
    bad[64] = bad[64]! ^ 1;
    await expect(agree(await priv(V.phoneSeed, V.phonePub), bad)).rejects.toThrow();
  });
});
