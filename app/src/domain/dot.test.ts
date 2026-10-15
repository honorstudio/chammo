import { describe, expect, it } from 'vitest';
import { dotKind, worstDot } from './dot';

// 점 모양(홈·모드 v1 정할 것 9, 사용자 10/11 "추천대로") — 일함·기다림·쉼·꺼짐 넷. 앱 어디서나 같은 판단
describe('dotKind — 세션 하나의 점', () => {
  it('사람 차례(답 기다림·막힘·로그인)는 기다림', () => {
    expect(dotKind({ status: 'ask' })).toBe('ask');
    for (const st of ['asks', 'blocked', 'login'] as const) expect(dotKind({ status: 'wait', st })).toBe('ask');
  });
  it('도는 중은 일함', () => {
    expect(dotKind({ status: 'run' })).toBe('run');
    expect(dotKind({ status: 'wait', st: 'working' })).toBe('run');
  });
  it('그 밖은 쉼, 꺼진 건 꺼짐', () => {
    expect(dotKind({ status: 'wait' })).toBe('rest');
    expect(dotKind({ status: 'wait', st: 'idle' })).toBe('rest');
    expect(dotKind({ off: true })).toBe('off');
    expect(dotKind({})).toBe('off');
  });
  it('꺼짐 표시가 있어도 사람 차례가 먼저는 아니다 — 꺼진 세션은 꺼짐', () => {
    expect(dotKind({ status: 'ask', off: true })).toBe('off');
  });
});

describe('worstDot — 여럿 중 가장 급한 것', () => {
  it('기다림 > 일함 > 쉼 > 꺼짐', () => {
    expect(worstDot(['rest', 'run', 'ask'])).toBe('ask');
    expect(worstDot(['rest', 'run'])).toBe('run');
    expect(worstDot(['off', 'rest'])).toBe('rest');
    expect(worstDot([])).toBe('off');
  });
});
