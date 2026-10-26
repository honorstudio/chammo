// 폰 숫자 확인(ADR 0014) — 컴퓨터(Rust device_link)와 같은 숫자, 같은 순서(5단계: 양쪽이 봉해 두고 연다)
import { describe, expect, it } from 'vitest';
import { commitMOf, commitOf, LinkRun, sasOf, sasText } from './sas';

const v = (n: number, len: number) => { const b = new Uint8Array(len).fill(n); if (len === 65) b[0] = 4; return b; };
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

describe('확인 숫자 — Rust 와 같은 기준값(파이썬 hashlib 로 따로 계산)', () => {
  it('commit·컴퓨터 commit·숫자', async () => {
    expect(hex(await commitOf(v(1, 65), v(5, 16)))).toBe('428a4f53eb71855eac1a221ec8fd681433c897c42ffe888a3e0293ac13a04d64');
    expect(hex(await commitMOf(v(2, 65), v(6, 16)))).toBe('6e20d412184215ea55b70bbc65640879effd9720806b16ba783471353ae4885b');
    expect(await sasOf(v(1, 65), v(2, 65), v(3, 32), 'd9', v(5, 16), v(6, 16))).toBe(113836);
    expect(await sasOf(v(1, 65), v(2, 65), v(3, 32), 'd8', v(5, 16), v(6, 16))).not.toBe(113836);
    expect(sasText(892263)).toBe('892 263');
    expect(sasText(5)).toBe('000 005');
  });
});

describe('단계 순서 — 컴퓨터 commit 을 받기 전엔 nP 를 안 열고, nM 이 commit 과 맞아야 숫자', () => {
  const run = () => new LinkRun({ pt: v(1, 65), mt: v(2, 65), sign: v(3, 32), dev: 'd9' }, v(5, 16));
  it('link1 → link2(cM) → link3(nP) → link4(nM) → 숫자', async () => {
    const r = run();
    const l1 = await r.link1();
    expect(l1.step).toBe('link1');
    expect(l1.dev).toBe('d9');
    expect(JSON.stringify(l1)).not.toContain('nP');
    const l3 = await r.link2(await commitMOf(v(2, 65), v(6, 16)));
    expect(l3).toMatchObject({ step: 'link3' });
    expect(r.canFinish()).toBe(false);
    expect(await r.link4(v(6, 16))).toBe(113836);
    expect(r.canFinish()).toBe(true);
  });
  it('순서를 어기면·commit 과 다른 nM 이면 거절', async () => {
    await expect(run().link2(new Uint8Array(32))).rejects.toThrow();
    const r = run();
    await r.link1();
    await expect(r.link4(v(6, 16))).rejects.toThrow('order');
    await r.link2(await commitMOf(v(2, 65), v(6, 16)));
    await expect(r.link4(v(7, 16))).rejects.toThrow('commit');
    expect(r.canFinish()).toBe(false);
    const r2 = run();
    await r2.link1();
    await r2.link2(await commitMOf(v(2, 65), v(6, 16)));
    await expect(r2.link2(new Uint8Array(32))).rejects.toThrow('once');
  });
});

describe('컴퓨터 열쇠 모양', () => {
  it('진짜 P-256 공개 열쇠는 통과, 다른 모양은 거절', async () => {
    const { keyShape } = await import('./linkKnock');
    const { b64 } = await import('./tunnel');
    for (let i = 0; i < 5; i++) {
      const kp = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
      expect(keyShape(b64(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))))).toBe(true);
    }
    expect(keyShape(b64(new Uint8Array(65)))).toBe(false);
    expect(keyShape('BA' + 'x'.repeat(84))).toBe(false);
    expect(keyShape(undefined)).toBe(false);
  });
});
