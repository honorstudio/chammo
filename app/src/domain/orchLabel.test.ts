import { describe, expect, it } from 'vitest';
import { cleanLabel, orchBadge } from './orchLabel';

describe('cleanLabel — 참모 별명(개발·디자인 등, 사용자 마음대로. 비우면 설정 이름으로 돌아감)', () => {
  it('앞뒤 공백을 떼고 24자까지, 비었으면 null(설정 이름)', () => {
    expect(cleanLabel('  개발  ')).toBe('개발');
    expect(cleanLabel('   ')).toBeNull();
    expect(cleanLabel('가'.repeat(30))).toBe('가'.repeat(24));
  });
  it('줄바꿈은 띄어쓰기로', () => {
    expect(cleanLabel('디자인\n담당')).toBe('디자인 담당');
  });
});

describe('orchBadge — 메뉴 참모 네모 속 한 글자(이름 전체를 넣어 세로로 쪼개졌다, 아이맥 0.2.0)', () => {
  it('끝 숫자가 있으면 그 숫자', () => {
    expect(orchBadge('참모-2')).toBe('2');
    expect(orchBadge('Chammo 3')).toBe('3');
  });
  it('숫자가 없으면 첫 글자 하나, 기본 이름이면 1', () => {
    expect(orchBadge('아이맥')).toBe('아');
    expect(orchBadge('참모')).toBe('1');
    expect(orchBadge('')).toBe('1');
    expect(orchBadge('chammo')).toBe('C');
  });
});
