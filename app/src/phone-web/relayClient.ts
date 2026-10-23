// 중계 서버 부르기 — 폰 Ed25519 열쇠로 서명(서버 ADR 0002). 서명할 글은 Rust team_relay_keys::signing_text·서버 src/auth.ts 와 한 글자도 같게
import { b64 } from './tunnel';
import type { PhoneKeys } from './keys';

const enc = new TextEncoder();
const PREFIX = 'chammo-relay/v0';

const sha = async (body: Uint8Array) => b64(new Uint8Array(await crypto.subtle.digest('SHA-256', body as Uint8Array<ArrayBuffer>)));

export async function signingText(method: string, path: string, ts: string, nonce: string, body: Uint8Array) {
  return [PREFIX, method, path, ts, nonce, await sha(body)].join('\n');
}

export async function sign(k: PhoneKeys, method: string, path: string, body: Uint8Array = new Uint8Array()) {
  const ts = String(Date.now());
  const nonce = b64(crypto.getRandomValues(new Uint8Array(16)));
  const text = await signingText(method, path, ts, nonce, body);
  const sig = b64(new Uint8Array(await crypto.subtle.sign('Ed25519', k.sign.privateKey, enc.encode(text))));
  return { ts, nonce, sig };
}

/** 서명한 WebSocket 주소 — device 가 없으면 등록 전 열쇠(key)로(두드리기) */
export async function wsUrl(relay: string, path: string, k: PhoneKeys, device?: string): Promise<string> {
  const s = await sign(k, 'GET', path);
  const who: Record<string, string> = device ? { device } : { key: k.signPub };
  const q = new URLSearchParams({ ...who, ...s });
  return `${relay.replace(/^http/, 'ws')}${path}?${q}`;
}

/** 서명한 HTTP(CORS — 서버 WEB_ORIGINS 에 입구 주소가 있어야). → {status, json} */
export async function call(relay: string, k: PhoneKeys, device: string | null, method: 'GET' | 'POST', path: string, payload?: unknown) {
  const body = payload === undefined ? new Uint8Array() : enc.encode(JSON.stringify(payload));
  const s = await sign(k, method, path, body);
  const headers: Record<string, string> = { 'X-Chammo-Ts': s.ts, 'X-Chammo-Nonce': s.nonce, 'X-Chammo-Sig': s.sig };
  if (device) headers['X-Chammo-Device'] = device;
  else headers['X-Chammo-Key'] = k.signPub;
  if (body.length) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${relay}${path}`, { method, headers, body: body.length ? body : undefined, credentials: 'omit', cache: 'no-store' });
  return { status: r.status, json: (await r.json().catch(() => null)) as Record<string, unknown> | null };
}
