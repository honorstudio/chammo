// 참모 상태 = 프사 옆 점(시안 phone-dash O1) — 글자 배지(일함·물음·쉼) 대신. 색은 데스크톱 상태 점과 같은 말
import { describe, expect, it } from 'vitest';
import { orchDot } from './orchDot';
import { statusTone } from './status';

describe('참모 상태 점', () => {
  it('묻는 중이 먼저(노랑) — 일하는 중이어도', () => {
    expect(orchDot('working', true)).toEqual({ cls: 'st-wait', label: '물음' });
    expect(orchDot('blocked', false)).toEqual({ cls: 'st-wait', label: '물음' });
    expect(orchDot('asks', false)).toEqual({ cls: 'st-wait', label: '물음' });
    expect(orchDot('login', false)).toEqual({ cls: 'st-wait', label: '로그인 필요' });
  });
  it('일하는 중 파랑, 나머지 쉼 초록', () => {
    expect(orchDot('working', false)).toEqual({ cls: 'st-work', label: '일하는 중' });
    expect(orchDot('idle', false)).toEqual({ cls: 'st-done', label: '쉼' });
    expect(orchDot('done', false)).toEqual({ cls: 'st-done', label: '답함' });
  });
  // L10(2026-10-11 bug-hunt) — 폰은 날 state 만 봐서 감시(Monitor)를 띄운 참모가 '일함', 데스크톱은 '백그라운드 기다림'(도는 고리 없음)
  it('백그라운드 기다림은 일하는 중이 아니다 — 데스크톱 statusTone 과 같은 갈래', () => {
    expect(orchDot('bgwait', false)).toEqual({ cls: 'st-done', label: '백그라운드 기다림' });
    for (const st of ['working', 'asks', 'blocked', 'login', 'bgwait', 'done', 'idle', 'stale', 'unknown'] as const) {
      const tone = statusTone(st);
      expect(orchDot(st, false).cls).toBe(tone === 'run' ? 'st-work' : tone === 'ask' ? 'st-wait' : 'st-done');
    }
  });
});
