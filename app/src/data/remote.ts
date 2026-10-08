// 다른 기기의 참모 — Rust(remote.rs)가 테일넷으로 그 기기 폰 서버에 대신 보낸다(맥 userspace 는 SOCKS5 경유, 열쇠는 키체인).
// 화면은 폰과 같은 길(peerApi)을 쓰고 운반만 remote_call 로 바꾼다. 1단계 = 보기 + 채팅 + 대기함 답하기(허용 목록은 Rust 가 다시 본다)
// 원격이 준 글은 남의 글이다 — 이 맥 파일 열기·명령 길로 넘기지 않는다(그런 길은 여기 없다)
import { invoke } from '@tauri-apps/api/core';
import { makeApi, type Io, type PeerApi } from './peerApi';

/** 그 기기가 열쇠를 끊었거나(설정에서 끊기) 이 맥 키체인에 열쇠가 없다 — 다시 짝지어야 한다 */
export class NeedsPairError extends Error {
  constructor() {
    super('pair');
  }
}

type CallOut = { status: number; text: string | null; b64: string | null };

export type RemoteDevice = {
  id: string;
  name: string;
  os: string;
  /** connected = 열쇠가 통함 · pair = 참모는 있는데 짝짓기 필요 · offline = 짝지은 기기가 안 닿음 */
  status: 'connected' | 'pair' | 'offline';
  paired: boolean;
  /** hello 를 모르는 옛판 — 보기·채팅은 되지만 그 기기 업데이트 권함 */
  old: boolean;
  version: string | null;
  lastOk: number | null;
};

function b64bytes(s: string): ArrayBuffer {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function remoteIo(id: string): Io {
  const call = async (method: 'GET' | 'POST', path: string, body: string | null): Promise<CallOut> => {
    let r: CallOut;
    try {
      r = await invoke<CallOut>('remote_call', { id, method, path, body });
    } catch (e) {
      if (e === 'pair') throw new NeedsPairError();
      throw new Error(String(e));
    }
    if (r.status < 200 || r.status >= 300) throw new Error(r.text || `HTTP ${r.status}`);
    return r;
  };
  return {
    text: (path) => call('GET', path, null).then((r) => r.text ?? ''),
    json: <T>(path: string) => call('GET', path, null).then((r) => JSON.parse(r.text ?? 'null') as T),
    post: <T>(path: string, body: object) => call('POST', path, JSON.stringify(body)).then((r) => (r.text ? JSON.parse(r.text) : null) as T),
    bytes: (path) => call('GET', path, null).then((r) => (r.b64 ? b64bytes(r.b64) : new TextEncoder().encode(r.text ?? '').buffer)),
  };
}

const apis = new Map<string, PeerApi>();
/** 그 기기 참모 길 — 폰 data/web 과 같은 이름·모양 */
export function remoteApi(id: string): PeerApi {
  let a = apis.get(id);
  if (!a) {
    a = makeApi(remoteIo(id));
    apis.set(id, a);
  }
  return a;
}

/** 기기 칸 — 같은 테일스케일 계정 기기 중 참모가 있는 것(짝지은 기기는 꺼져 있어도) */
export const remoteDevices = () => invoke<{ me: string; devices: RemoteDevice[] }>('remote_devices');
/** 처음 한 번 — 그 기기 설정 > 모바일의 연결 코드(16진 32자, QR 주소째 붙여도 됨) */
export const remotePair = (id: string, code: string) => invoke<void>('remote_pair', { id, code });
/** 이 맥에서 그 기기 열쇠 지우기(그 기기 설정의 '다른 기기 참모' 줄은 거기서 끊는다) */
export const remoteUnpair = (id: string) => invoke<void>('remote_unpair', { id });
