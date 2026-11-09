// 폰 열쇠 둘 (ADR 0013) — Ed25519(중계 요청 서명)·ECDH P-256(컴퓨터와 터널 — 사파리가 X25519 열쇠를 IndexedDB 에 못 넣어서). 비밀 열쇠는 꺼낼 수 없는 CryptoKey 로 IndexedDB 에만.
// 같은 출처(입구 주소)의 입구 화면·컴퓨터 화면이 같이 쓴다. 홈 화면 앱은 사파리와 저장 공간이 따로라 열쇠도 따로(짝짓기도 따로)
import { readLink } from './link';
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

const read = () => tx<PhoneKeys | undefined>('readonly', (s) => s.get(ID) as IDBRequest<PhoneKeys | undefined>);

/** 저장된 줄을 어떻게 하나 — use 쓴다 · make 줄이 없다(처음·forgetKeys 뒤) · broken 줄은 있는데 열쇠를 못 읽는다.
 *  전엔 broken 도 새 열쇠로 덮어써서, 잠깐 못 읽었을 뿐인 열쇠가 영영 사라지고 중계가 401 을 냈다(2026-11-07 조사) */
export const keyPlan = (have: { sign?: unknown; x?: unknown } | null | undefined): 'use' | 'make' | 'broken' => (!have ? 'make' : have.sign && have.x ? 'use' : 'broken');

/** 링크가 있는데 쓸 열쇠가 없다 — 새로 만들면 옛 기기 id 로 서명해 401 만 난다. 다시 이어야 한다 */
export class NoKeysError extends Error {
  override name = 'NoKeysError';
  constructor() {
    super('이 폰 열쇠가 없어요');
  }
}

/** 짝지은 기기로 서명할 열쇠 — 저장된 것만. 없으면 만들지 않고 NoKeysError(터널·푸시 구독) */
export async function linkedKeys(): Promise<PhoneKeys> {
  if (cached) return cached;
  const have = await read();
  if (keyPlan(have) !== 'use') throw new NoKeysError();
  cached = Promise.resolve(have!);
  return have!;
}

/** 로그인·짝짓기 — 있으면 그것, 없으면 만들어 넣는다. 못 넣는 브라우저(개인 정보 보호 모드)면 오류 — 짝짓기 전에 알린다.
 *  링크가 있는데 줄을 못 읽으면 덮어쓰지 않는다(다시 잇기가 forgetKeys 로 지운 뒤 만든다) */
export function phoneKeys(): Promise<PhoneKeys> {
  cached ??= (async () => {
    const have = await read();
    const plan = keyPlan(have);
    if (plan === 'use') return have!;
    if (plan === 'broken' && readLink()) throw new NoKeysError();
    const k = await make();
    await tx('readwrite', (s) => s.put(k, ID));
    const back = await read();
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
