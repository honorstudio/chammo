// 다른 기기 참모 채팅(ADR 0011) — 그 기기 HQ 세션 고르기, 사람 입력만 보내기
import { describe, expect, it } from 'vitest';
import { remoteAssistants, sendAllowed, TRUST_MS } from './remoteChat';

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
