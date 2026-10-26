// 다른 기기 참모 채팅(ADR 0011) — 그 기기 HQ 세션 고르기, 사람 입력만 보내기
import { describe, expect, it } from 'vitest';
import { HUMAN_SAY_MIN, oldSayError, remoteAssistants, sayTooOld, sendAllowed, TRUST_MS } from './remoteChat';

const HQ = 'C:\\Users\\me/.chammo/hq';
const list = JSON.stringify([
  { id: 'aaaa0001', sessionId: 'u-1', cwd: 'C:/Users/me/.chammo/hq', name: '참모', status: 'busy', state: 'working' },
  { id: 'aaaa0002', sessionId: 'u-2', cwd: 'c:\\users\\me\\.chammo\\HQ', name: '참모-2 · 영상', status: 'idle', state: 'working' },
  { id: 'bbbb0003', sessionId: 'u-3', cwd: 'C:/dev/shop', name: 'shop', status: 'busy' },
  { id: 'cccc0004', cwd: 'C:/Users/me/.chammo/hq', name: '대화 기록 없음' },
]);

describe('그 기기 참모 목록', () => {
  it('HQ 폴더 세션 중 대화 기록이 있는 것만, 상태째', () => {
    expect(remoteAssistants(list, HQ)).toEqual([
      { id: 'aaaa0001', name: '참모', sessionId: 'u-1', state: 'working' },
      { id: 'aaaa0002', name: '참모-2 · 영상', sessionId: 'u-2', state: 'idle' },
    ]);
  });
  it('깨진 목록은 빈 것', () => {
    expect(remoteAssistants('not json', HQ)).toEqual([]);
    expect(remoteAssistants('{}', HQ)).toEqual([]);
  });
});

describe('보내기는 사람 입력 직후만', () => {
  it('진짜 키·클릭 뒤 잠깐만', () => {
    expect(sendAllowed(1000, 1000 + TRUST_MS - 1)).toBe(true);
    expect(sendAllowed(1000, 1000 + TRUST_MS + 1)).toBe(false);
    expect(sendAllowed(0, 5000)).toBe(false);
  });
});

describe('그 기기 판이 낮으면 말 걸기가 안 된다고 알린다(10-26 영상 PC 0.3.9)', () => {
  it('원격 사람 말은 0.4.0 부터 — 판 비교는 숫자로', () => {
    expect(HUMAN_SAY_MIN).toBe('0.4.0');
    expect(['0.3.9', '0.3.10', '0.2.99'].map(sayTooOld)).toEqual([true, true, true]);
    expect(['0.4.0', '0.4.1', '0.10.0', '1.0.0', '0.4.0-beta'].map(sayTooOld)).toEqual([false, false, false, false, false]);
  });
  it('판을 모르면 막지 않는다(보내 보고 답으로 가린다)', () => {
    expect([sayTooOld(undefined), sayTooOld(''), sayTooOld('dev')]).toEqual([false, false, false]);
  });
  it('옛 판 폰 서버의 거절(peer 열쇠 길 없음·404)은 판 낮음으로', () => {
    expect(['not for a peer key', 'HTTP 404', 'HTTP 403', ' not found '].map(oldSayError)).toEqual([true, true, true, true]);
    expect(['pair', '그 기기에 안 닿아요', 'HTTP 500', '테일넷에 그 기기가 안 보여요'].map(oldSayError)).toEqual([false, false, false, false]);
  });
});

import chatSrc from '../ui/chat/RemoteChat.tsx?raw';
import farSrc from '../ui/far/Far.tsx?raw';
describe('원격 채팅 칸이 판 낮음을 말한다', () => {
  it('보내기 전 판으로 막고, 옛 판 거절 답도 같은 안내로', () => {
    expect(chatSrc).toContain('if (sayTooOld(target.version)) { setErr(tooOld); return; }');
    expect(chatSrc).toContain('oldSayError(String(e)) ? tooOld');
    expect(farSrc).toMatch(/version: status\?\.id === t\.dev/);
  });
});
