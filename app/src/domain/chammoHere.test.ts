import { describe, expect, it } from 'vitest';
import { hereOthers, peerAccount, type HereAccount } from './chammoHere';

const me: HereAccount = { folder: '.chammo', current: true, email: 'me@example.com', name: '나' };
const qa: HereAccount = { folder: '.chammo-team3', current: false, email: 'other@example.com', name: '남' };

describe('이 컴퓨터의 다른 Chammo', () => {
  it('지금 앱 줄은 빼고 다른 데이터 폴더만, 다른 계정이면 표시', () => {
    // 10-26: 아이맥 시험판이 남의 계정에 붙어 있었는데 본판 기기 관리엔 안 보였다
    expect(hereOthers([me, qa], 'me@example.com')).toEqual([{ folder: '.chammo-team3', who: 'other@example.com (남)', other: true }]);
    expect(hereOthers([me, { ...qa, email: 'me@example.com' }], 'me@example.com')[0]!.other).toBe(false);
    expect(hereOthers([me], 'me@example.com')).toEqual([]);
  });
  it('이메일이 없으면 이름만', () => {
    expect(hereOthers([me, { ...qa, email: '' }], '')[0]!.who).toBe('남');
  });
});

describe('다른 기기 줄의 계정', () => {
  it('그 기기 앱 계정 + 다른 데이터 폴더, 내 계정과 다르면 표시', () => {
    const v = peerAccount([{ ...me, email: 'other@example.com', name: '' }, { ...qa, email: 'me@example.com' }], 'me@example.com');
    expect(v).toEqual({ main: { who: 'other@example.com', other: true, signedIn: true }, others: [{ folder: '.chammo-team3', who: 'me@example.com (남)', other: false }] });
  });
  it('로그인 안 한 기기·옛 판(계정 칸 없음)', () => {
    expect(peerAccount([{ ...me, email: '', name: '' }], 'me@example.com')?.main).toEqual({ who: '', other: false, signedIn: false });
    expect(peerAccount(undefined, 'me@example.com')).toBeNull();
    expect(peerAccount([], 'me@example.com')).toBeNull();
  });
});
