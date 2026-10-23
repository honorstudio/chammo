// 중계 길 폰의 웹 푸시 (ADR 0013 결정 7) — 중계 VAPID 열쇠로 구독하고 구독 주소를 중계에 맡긴다(본문 없는 푸시 → '새 메시지').
// 컴퓨터 열쇠(/api/push-key)는 안 쓴다 — 한 서비스 워커엔 열쇠 하나라서
import { phoneKeys } from './keys';
import type { RelayLink } from './link';
import { call } from './relayClient';

export async function relayPushKey(l: RelayLink): Promise<string> {
  const r = await call(l.relay, await phoneKeys(), l.device, 'GET', '/v0/push/key');
  if (r.status !== 200 || typeof r.json?.key !== 'string') throw new Error(`중계 푸시 열쇠를 못 받았어요 (${r.status})`);
  return r.json.key;
}

export async function relayPushSubscribe(l: RelayLink, sub: PushSubscriptionJSON): Promise<void> {
  const r = await call(l.relay, await phoneKeys(), l.device, 'POST', '/v0/me/push', { endpoint: sub.endpoint });
  if (r.status !== 200) throw new Error(`중계에 알림을 못 걸었어요 (${r.status})`);
}

export async function relayPushUnsubscribe(l: RelayLink): Promise<void> {
  await call(l.relay, await phoneKeys(), l.device, 'POST', '/v0/me/push/delete', {});
}
