// 짝짓기 두드리기 (ADR 0013 결정 3) — 아직 중계에 없는 폰 열쇠로 컴퓨터 허브를 두드려, QR 코드와 내 공개 열쇠를 컴퓨터 열쇠로 봉해 보낸다.
// 컴퓨터가 코드를 확인하고 나를 중계에 '내 기기'로 들인 뒤 토큰을 내 열쇠로 봉해 돌려준다. 중계는 상자를 못 연다
import { phoneKeys } from './keys';
import type { PairLink, RelayLink } from './link';
import { wsUrl } from './relayClient';
import { b64, open, seal, unb64 } from './tunnel';

const WAIT_MS = 60_000;
const enc = new TextEncoder();

export const KNOCK_ERRORS: Record<string, string> = {
  code: '짝짓기 코드가 틀렸거나 10분이 지났어요 — 컴퓨터 Chammo 설정 > 폰과 메신저에서 QR 을 새로 만들어 주세요',
  relay: '컴퓨터가 이 폰을 중계에 못 들였어요 — 컴퓨터가 Chammo 계정에 로그인돼 있는지 봐 주세요',
  offline: '컴퓨터 Chammo 가 꺼져 있어요 — 켜고 QR 을 다시 찍어 주세요',
  timeout: '컴퓨터가 답이 없어요 — 컴퓨터 Chammo 가 켜져 있는지 보고 다시 해 주세요',
  net: '중계 서버에 못 붙었어요 — 인터넷 연결을 봐 주세요',
  refused: '컴퓨터가 이 QR 을 못 열었어요 — 컴퓨터 Chammo 에서 QR 을 새로 만들어 주세요',
  key: '짝짓기 확인이 맞지 않아요 — QR 을 새로 만들어 다시 찍어 주세요',
  held: '컴퓨터 Chammo 에서 이 폰 연결을 허용해 주세요 — 허용한 뒤 같은 QR 을 다시 열면 돼요',
};

export type Paired = { token: string; link: RelayLink };

/** prev = 같은 컴퓨터(m·k 같음)와 다시 짝지을 때만 그 옛 토큰(컴퓨터가 줄을 바꿔 끼운다) — 다른 컴퓨터엔 절대 안 보낸다(pairPlan) */
export async function knockPair(p: PairLink, o: { home: boolean; prev: string | null }): Promise<Paired> {
  const k = await phoneKeys();
  const pt = { code: p.code, sign: k.signPub, x: k.xPub, ua: navigator.userAgent, home: o.home, ...(o.prev ? { prev: o.prev } : {}) };
  const box = b64(await seal(unb64(p.macX), enc.encode(JSON.stringify(pt))));
  const ws = new WebSocket(await wsUrl(p.relay, `/v0/hubs/${p.mac}/knock`, k));
  const reply = await new Promise<string>((ok, no) => {
    const t = setTimeout(() => { no(new Error(KNOCK_ERRORS.timeout)); ws.close(); }, WAIT_MS);
    const end = (f: () => void) => { clearTimeout(t); f(); };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'knock', box }));
    ws.onerror = () => end(() => no(new Error(KNOCK_ERRORS.net)));
    ws.onclose = () => end(() => no(new Error(KNOCK_ERRORS.timeout)));
    ws.onmessage = (ev) => {
      let m: { t?: string; box?: string };
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.t === 'offline') end(() => no(new Error(KNOCK_ERRORS.offline)));
      if (m.t === 'refused') end(() => no(new Error(KNOCK_ERRORS.refused)));
      if (m.t === 'reply' && typeof m.box === 'string') { const b = m.box; end(() => ok(b)); }
    };
  });
  const v = JSON.parse(new TextDecoder().decode(await open(k.x.privateKey, unb64(k.xPub), unb64(reply)))) as { ok?: boolean; error?: string; token?: string; device?: string; mac?: { name?: string } };
  if (!v.ok || typeof v.token !== 'string' || typeof v.device !== 'string') throw new Error(KNOCK_ERRORS[v.error ?? ''] ?? `짝짓기 실패 (${v.error ?? '?'})`);
  return { token: v.token, link: { relay: p.relay, mac: p.mac, macX: p.macX, device: v.device, macName: v.mac?.name } };
}
