import { describe, expect, it } from 'vitest';
import type { PhoneReply } from '../../domain/phoneGacha';
import { gachaBridge } from './phoneBridge';
import app from '../../App.tsx?raw';

const view = { coins: 1, pity: 0, owned: {}, equip: {}, fresh: [] };

describe('폰 뽑기 다리(App window.__gachaPhone)', () => {
  it('요청과 꺼 둠을 넘기고, 같은 대기표로 답한다', async () => {
    const got: unknown[] = [];
    const sent: [string, PhoneReply][] = [];
    const b = gachaBridge(async (req, off) => { got.push([req, off]); return { ok: true, view }; }, async (k, r) => { sent.push([k, r]); }, () => true);
    await b({ key: 'k1', req: { rid: 'abcd1234', op: 'pull', n: 1 } });
    expect(got).toEqual([[{ rid: 'abcd1234', op: 'pull', n: 1 }, true]]);
    expect(sent).toEqual([['k1', { ok: true, view }]]);
  });
  it('처리가 던지면 답하지 않고 삼킨다(폰 서버가 시간 초과로)', async () => {
    const sent: string[] = [];
    const b = gachaBridge(async () => { throw new Error('write failed'); }, async (k) => { sent.push(k); }, () => false);
    await expect(b({ key: 'k2', req: {} })).resolves.toBeUndefined();
    expect(sent).toEqual([]);
  });
  it('App 이 이 다리로 window.__gachaPhone 을 건다(꺼 둠 = 뽑기 기능 꺼짐)', () => {
    expect(app).toMatch(/gachaBridge\(gachaPhone, gachaPhoneReply, \(\) => !featuresRef\.current\.gacha\)/);
    expect(app).toMatch(/w\.__gachaPhone = /);
  });
});
