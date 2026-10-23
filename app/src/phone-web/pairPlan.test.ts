// 보안 검토 A·D — 짝짓기 링크를 어떻게 받나(확인·지우기·prev·중계 고정)
import { describe, expect, it } from 'vitest';
import { planPair } from './pairPlan';

const K1 = `B${'A'.repeat(86)}`;
const K2 = `B${'B'.repeat(86)}`;
const RELAY = 'https://relay.example';
const hash = (m: string, k: string, r = RELAY) => `#p=${'a'.repeat(32)}&m=${m}&k=${k}&r=${encodeURIComponent(r)}`;
const cur = { relay: RELAY, mac: 'mac-1', macX: K1, device: 'd1', macName: '집 맥' };

describe('planPair', () => {
  it('처음 짝짓기 — 새 열쇠로, prev 없이', () => {
    expect(planPair(hash('mac-1', K1), RELAY, null, false)).toMatchObject({ kind: 'pair', fresh: true, sendPrev: false, wipeAll: true });
  });

  it('같은 컴퓨터(m·k 같음) 다시 — 새 열쇠, prev 보냄(같은 줄 바꿔 끼우기), 화면은 안 지움', () => {
    expect(planPair(hash('mac-1', K1), RELAY, cur, false)).toMatchObject({ kind: 'pair', fresh: true, sendPrev: true, wipeAll: false });
  });

  it('다른 컴퓨터(m 이나 k 가 다름) — 먼저 확인, 확인하면 다 지우고 prev 없이', () => {
    expect(planPair(hash('mac-2', K2), RELAY, cur, false)).toEqual({ kind: 'confirm', from: '집 맥' });
    expect(planPair(hash('mac-1', K2), RELAY, cur, false)).toEqual({ kind: 'confirm', from: '집 맥' });
    expect(planPair(hash('mac-2', K2), RELAY, cur, true)).toMatchObject({ kind: 'pair', fresh: true, sendPrev: false, wipeAll: true });
  });

  it('중계 주소는 입구 설정 것만 — QR 의 r 이 다르거나 설정이 없으면 거절', () => {
    expect(planPair(hash('mac-1', K1, 'https://evil.example'), RELAY, null, false)).toEqual({ kind: 'bad', why: 'relay' });
    expect(planPair(hash('mac-1', K1), undefined, null, false)).toEqual({ kind: 'bad', why: 'config' });
  });

  it('모양이 틀린 링크는 거절', () => {
    expect(planPair('#p=zz', RELAY, null, false)).toEqual({ kind: 'bad', why: 'shape' });
  });
});
