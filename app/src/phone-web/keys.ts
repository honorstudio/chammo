// 폰 열쇠 둘 (ADR 0013) — Ed25519(중계 요청 서명)·ECDH P-256(컴퓨터와 터널 — 사파리가 X25519 열쇠를 IndexedDB 에 못 넣어서). 비밀 열쇠는 꺼낼 수 없는 CryptoKey 로 IndexedDB 에만.
// 같은 출처(입구 주소)의 입구 화면·컴퓨터 화면이 같이 쓴다. 홈 화면 앱은 사파리와 저장 공간이 따로라 열쇠도 따로(짝짓기도 따로)
import { b64, ECDH } from './tunnel';

export type PhoneKeys = { sign: CryptoKeyPair; x: CryptoKeyPair; signPub: string; xPub: string };

const DB = 'chammo-phone';
const STORE = 'keys';
const ID = 'device';

function db(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error ?? new Error('IndexedDB'));
  });
}

async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  try {
    return await new Promise<T>((ok, no) => {
      const r = f(d.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error ?? new Error('IndexedDB'));
    });
  } finally {
    d.close();
  }
}

const raw = async (k: CryptoKey) => b64(new Uint8Array(await crypto.subtle.exportKey('raw', k)));

async function make(): Promise<PhoneKeys> {
  const sign = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair;
  const x = (await crypto.subtle.generateKey(ECDH, false, ['deriveBits'])) as CryptoKeyPair;
  return { sign, x, signPub: await raw(sign.publicKey), xPub: await raw(x.publicKey) };
}

let cached: Promise<PhoneKeys> | null = null;

/** 있으면 그것, 없으면 만들어 넣는다. 못 넣는 브라우저(개인 정보 보호 모드)면 오류 — 짝짓기 전에 알린다 */
export function phoneKeys(): Promise<PhoneKeys> {
  cached ??= (async () => {
    const have = await tx<PhoneKeys | undefined>('readonly', (s) => s.get(ID) as IDBRequest<PhoneKeys | undefined>);
    if (have?.sign && have.x) return have;
    const k = await make();
    await tx('readwrite', (s) => s.put(k, ID));
    const back = await tx<PhoneKeys | undefined>('readonly', (s) => s.get(ID) as IDBRequest<PhoneKeys | undefined>);
    if (back?.signPub !== k.signPub) throw new Error('이 브라우저가 열쇠 저장을 막아요(개인 정보 보호 모드?) — 일반 창에서 QR 을 다시 열어 주세요');
    return k;
  })();
  cached.catch(() => { cached = null; });
  return cached;
}

/** 열쇠를 버린다 — 끊긴 기기(중계 401)·다른 컴퓨터로 다시 짝지을 때. 다음 phoneKeys() 가 새로 만든다 */
export async function forgetKeys(): Promise<void> {
  cached = null;
  await tx('readwrite', (s) => s.delete(ID));
}
