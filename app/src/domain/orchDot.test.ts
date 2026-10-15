// 참모 상태 = 프사 옆 점(시안 phone-dash O1) — 글자 배지(일함·물음·쉼) 대신. 색은 데스크톱 상태 점과 같은 말
import { describe, expect, it } from 'vitest';
import { orchDot } from './orchDot';

describe('참모 상태 점', () => {
  it('묻는 중이 먼저(노랑) — 일하는 중이어도', () => {
    expect(orchDot('working', true)).toEqual({ cls: 'st-wait', label: '물음' });
    expect(orchDot('blocked', false)).toEqual({ cls: 'st-wait', label: '물음' });
  });
  it('일하는 중 파랑, 나머지 쉼 초록', () => {
    expect(orchDot('working', false)).toEqual({ cls: 'st-work', label: '일하는 중' });
    expect(orchDot('idle', false)).toEqual({ cls: 'st-done', label: '쉼' });
  });
});
