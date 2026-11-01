// 중계 길 폰의 구독 알리기 — 중계엔 구독 주소만, 컴퓨터엔 터널로 구독 열쇠까지(컴퓨터가 본문을 봉한다, 2026-11-01)
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let macFails = false;
vi.mock('../../phone-web/link', () => ({ readLink: () => ({ relay: 'https://relay.test', device: 'ph-1' }) }));
vi.mock('../../phone-web/relayPush', () => ({
  relayPushKey: async () => 'k',
  relayPushSubscribe: async (_l: unknown, s: PushSubscriptionJSON) => { calls.push(`relay ${JSON.stringify(Object.keys(s))}`); },
  relayPushUnsubscribe: async () => { calls.push('relay-off'); },
}));
vi.mock('../../data/web', () => ({
  getPushKey: async () => 'mac-k',
  pushSubscribe: async (s: PushSubscriptionJSON) => { if (macFails) throw new Error('터널 끊김'); calls.push(`mac ${s.keys?.p256dh}/${s.keys?.auth}`); },
  pushUnsubscribe: async () => { calls.push('mac-off'); },
}));

const sub: PushSubscriptionJSON = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'P', auth: 'A' } };

describe('중계 길 폰 구독', () => {
  beforeEach(() => { calls.length = 0; macFails = false; });

  it('중계에도 걸고, 컴퓨터에도 구독 열쇠를 알린다', async () => {
    const { register } = await import('./usePush');
    await register(sub);
    expect(calls.sort()).toEqual(['mac P/A', 'relay ["endpoint","keys"]']);
  });

  it('컴퓨터에 못 알려도 중계 구독은 그대로 — 새 메시지라도 온다', async () => {
    const { register } = await import('./usePush');
    macFails = true;
    await expect(register(sub)).resolves.toBeUndefined();
    expect(calls).toEqual(['relay ["endpoint","keys"]']);
  });
});
