// 중계엔 구독 주소만 — 구독 열쇠(p256dh·auth)가 중계로 가면 중계가 본문을 지어 보낼 수 있다(2026-11-01)
import { expect, it, vi } from 'vitest';

const sent: unknown[] = [];
vi.mock('./keys', () => ({ phoneKeys: async () => ({}) }));
vi.mock('./relayClient', () => ({ call: async (_r: string, _k: unknown, _d: string, _m: string, _p: string, body: unknown) => { sent.push(body); return { status: 200, json: {} }; } }));

it('중계 구독엔 endpoint 만 싣는다', async () => {
  const { relayPushSubscribe } = await import('./relayPush');
  await relayPushSubscribe({ relay: 'https://relay.test', device: 'd' } as never, { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'P', auth: 'A' } });
  expect(sent).toEqual([{ endpoint: 'https://fcm.googleapis.com/fcm/send/x' }]);
});
