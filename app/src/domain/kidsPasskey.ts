// 패스키 나가기(일곱째 조각, '되면 고르기') — 숫자 네 자리는 그대로, 이 기기가 패스키(Face ID 등)를 쓸 수 있을 때만.
// rp = 패드가 연 주소의 호스트(중계면 중계 도메인). 맥(kids_passkey)이 도전값·rpIdHash·출처·서명을 본다 — 여기는 부르고 모양만 바꾼다
export type PasskeyReg = { id: string; clientData: string; authData: string; publicKey: string };
export type PasskeyAssertion = { id: string; clientData: string; authData: string; signature: string };

export const b64u = (b: ArrayBuffer): string => {
  let s = '';
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const unb64u = (s: string): Uint8Array => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
const ab = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer;

type PKC = { isUserVerifyingPlatformAuthenticatorAvailable: () => Promise<boolean> };
/** 이 기기에서 되나 — 안 되면 숫자판의 패스키 칸을 비워 둔다 */
export async function passkeyReady(pkc: PKC | undefined = (globalThis as { PublicKeyCredential?: PKC }).PublicKeyCredential): Promise<boolean> {
  if (!pkc) return false;
  try { return await pkc.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; }
}

type Creds = { create: (o: CredentialCreationOptions) => Promise<unknown>; get: (o: CredentialRequestOptions) => Promise<unknown> };
const nav = (): Creds => navigator.credentials as unknown as Creds;

/** 등록 — 누른 그 자리에서 바로 부른다(Safari 는 손가락 누름이 있어야 연다) */
export async function createPasskey(challenge: string, rp: string, creds: Creds = nav()): Promise<PasskeyReg> {
  const user = new Uint8Array(16);
  crypto.getRandomValues(user);
  const c = (await creds.create({
    publicKey: {
      challenge: ab(unb64u(challenge)), rp: { id: rp, name: 'Chammo' },
      user: { id: ab(user), name: 'guardian', displayName: 'Guardian' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      attestation: 'none', timeout: 60_000,
    },
  })) as { id: string; response: { clientDataJSON: ArrayBuffer; getAuthenticatorData: () => ArrayBuffer; getPublicKey: () => ArrayBuffer | null } } | null;
  const pub = c?.response.getPublicKey();
  if (!c || !pub) throw new Error('no passkey');
  return { id: c.id, clientData: b64u(c.response.clientDataJSON), authData: b64u(c.response.getAuthenticatorData()), publicKey: b64u(pub) };
}

/** 확인 — 그 rp 로 등록된 열쇠만 */
export async function getPasskey(challenge: string, rp: string, ids: string[], creds: Creds = nav()): Promise<PasskeyAssertion> {
  const c = (await creds.get({
    publicKey: { challenge: ab(unb64u(challenge)), rpId: rp, allowCredentials: ids.map((id) => ({ type: 'public-key' as const, id: ab(unb64u(id)) })), userVerification: 'required', timeout: 60_000 },
  })) as { id: string; response: { clientDataJSON: ArrayBuffer; authenticatorData: ArrayBuffer; signature: ArrayBuffer } } | null;
  if (!c) throw new Error('no passkey');
  return { id: c.id, clientData: b64u(c.response.clientDataJSON), authData: b64u(c.response.authenticatorData), signature: b64u(c.response.signature) };
}
