import { describe, expect, it } from 'vitest';
import { b64u, createPasskey, getPasskey, passkeyReady, unb64u } from './kidsPasskey';

const buf = (...b: number[]) => new Uint8Array(b).buffer;

describe('패스키 나가기(일곱째 조각) — 패드 쪽', () => {
  it('base64url 왕복(맥 kids_passkey 와 같은 모양 — 채움 없음)', () => {
    const b = new Uint8Array([0, 255, 62, 63, 250, 1]);
    expect(b64u(b.buffer)).toBe('AP8-P_oB');
    expect([...unb64u('AP8-P_oB')]).toEqual([...b]);
  });

  it('되나: 패스키 객체가 없거나 플랫폼 인증기가 없으면 false(칸을 비워 둔다)', async () => {
    expect(await passkeyReady(undefined)).toBe(false);
    expect(await passkeyReady({ isUserVerifyingPlatformAuthenticatorAvailable: async () => false })).toBe(false);
    expect(await passkeyReady({ isUserVerifyingPlatformAuthenticatorAvailable: async () => { throw new Error('x'); } })).toBe(false);
    expect(await passkeyReady({ isUserVerifyingPlatformAuthenticatorAvailable: async () => true })).toBe(true);
  });

  it('등록: 이 기기 인증기·본인 확인 필수·ES256·rp 는 패드 주소, 맥에 보낼 네 칸', async () => {
    let seen: CredentialCreationOptions | undefined;
    const creds = {
      create: async (o: CredentialCreationOptions) => {
        seen = o;
        return { id: 'Y3JlZA', response: { clientDataJSON: buf(1), getAuthenticatorData: () => buf(2), getPublicKey: () => buf(3) } };
      },
      get: async () => null,
    };
    const r = await createPasskey('AQID', 'pad.example.com', creds);
    expect(r).toEqual({ id: 'Y3JlZA', clientData: 'AQ', authData: 'Ag', publicKey: 'Aw' });
    const pk = seen!.publicKey!;
    expect([...new Uint8Array(pk.challenge as ArrayBuffer)]).toEqual([1, 2, 3]);
    expect(pk.rp.id).toBe('pad.example.com');
    expect(pk.pubKeyCredParams).toEqual([{ type: 'public-key', alg: -7 }]);
    expect(pk.authenticatorSelection).toMatchObject({ authenticatorAttachment: 'platform', userVerification: 'required' });
    expect(pk.attestation).toBe('none');
  });

  it('등록: 공개키를 못 주는 기기면 실패(숫자 길만 남는다)', async () => {
    const creds = { create: async () => ({ id: 'a', response: { clientDataJSON: buf(1), getAuthenticatorData: () => buf(2), getPublicKey: () => null } }), get: async () => null };
    await expect(createPasskey('AQID', 'pad.example.com', creds)).rejects.toThrow();
  });

  it('확인: 등록된 열쇠만·본인 확인 필수, 맥에 보낼 네 칸', async () => {
    let seen: CredentialRequestOptions | undefined;
    const creds = {
      create: async () => null,
      get: async (o: CredentialRequestOptions) => {
        seen = o;
        return { id: 'Y3JlZA', response: { clientDataJSON: buf(1), authenticatorData: buf(2), signature: buf(4) } };
      },
    };
    const a = await getPasskey('AQID', 'pad.example.com', ['Y3JlZA'], creds);
    expect(a).toEqual({ id: 'Y3JlZA', clientData: 'AQ', authData: 'Ag', signature: 'BA' });
    const pk = seen!.publicKey!;
    expect(pk.rpId).toBe('pad.example.com');
    expect(pk.userVerification).toBe('required');
    expect(pk.allowCredentials?.map((c) => [...new Uint8Array(c.id as ArrayBuffer)])).toEqual([[99, 114, 101, 100]]);
  });
});
