// 설정 > Chammo 계정 — 화면 판단(순수 함수)
import { describe, expect, it } from 'vitest';
import { readmeEn, readmeKo } from '../ui/readmes';
import { deleteConfirmOk, PRIVACY_URL, TERMS_URL } from './teamAccount';

describe('계정 지우기 확인', () => {
  it('계정 이메일을 그대로 쳐야(대소문자·앞뒤 빈칸도 그대로)', () => {
    expect(deleteConfirmOk({ email: 'me@example.com', name: '지수' }, 'me@example.com')).toBe(true);
    for (const t of ['', 'ME@example.com', ' me@example.com', 'me@example.com ', '지수']) expect(deleteConfirmOk({ email: 'me@example.com', name: '지수' }, t)).toBe(false);
  });
  it('이메일이 없는 계정은 이름, 둘 다 없으면 못 지운다', () => {
    expect(deleteConfirmOk({ email: '', name: '지수' }, '지수')).toBe(true);
    expect(deleteConfirmOk({ email: '', name: '' }, '')).toBe(false);
  });
});

describe('처리방침·약관 링크 — 설정 계정 칸과 README 가 같은 주소', () => {
  it('README 한·영 개인정보 칸에 둘 다 있다', () => {
    for (const r of [readmeKo, readmeEn]) {
      expect(r).toContain(PRIVACY_URL);
      expect(r).toContain(TERMS_URL);
    }
  });
});
