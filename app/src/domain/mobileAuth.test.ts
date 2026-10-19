import { describe, expect, it } from 'vitest';
import { bootPair, codeFromText, groupCode, homeCodeFrom, homeUrl, pairCodeFrom, spentBy } from './mobileAuth';

describe('bootPair — 켤 때 짝짓기(QR ?pair= · 홈 화면 앱 넘기기 ?home=)', () => {
  const qr = '0123456789abcdef0123456789abcdef';
  const hand = 'fedcba9876543210fedcba9876543210';
  const browser = { standalone: false, hasToken: false, tried: null };
  const app = { standalone: true, hasToken: false, tried: null };

  it('사파리가 QR 로 열리면 그 코드로 짝짓고, 끝나면 홈 화면 앱 넘기기 코드를 받아 다시 연다', () => {
    expect(bootPair({ ...browser, search: `?pair=${qr}` })).toEqual({ code: qr, home: false, handoff: true });
    // 이미 열쇠가 있어도 QR 을 다시 찍었으면 다시 짝짓는다(옛 열쇠를 같이 내서 줄이 안 는다)
    expect(bootPair({ ...browser, hasToken: true, search: `?pair=${qr}` })).toEqual({ code: qr, home: false, handoff: true });
  });

  it('사파리는 ?home= 코드를 쓰지 않는다 — 홈 화면 앱 몫이라 남겨 둔다', () => {
    expect(bootPair({ ...browser, search: `?home=${hand}` })).toBeNull();
  });

  it('홈 화면 앱 첫 켜기 — 시작 주소의 ?home= 코드로 홈 화면 앱 짝짓기, 다시 넘기지 않는다', () => {
    expect(bootPair({ ...app, search: `?home=${hand}` })).toEqual({ code: hand, home: true, handoff: false });
  });

  it('홈 화면 앱에 열쇠가 있으면 시작 주소의 지난 코드는 건드리지 않는다(켤 때마다 같은 주소로 열린다)', () => {
    expect(bootPair({ ...app, hasToken: true, search: `?home=${hand}` })).toBeNull();
    expect(bootPair({ ...app, hasToken: true, search: `?pair=${qr}` })).toBeNull();
  });

  it('홈 화면 앱은 같은 코드를 두 번 내지 않는다 — 지난 코드를 켤 때마다 내면 틀린 횟수가 쌓여 맥의 살아 있는 코드가 죽는다', () => {
    expect(bootPair({ ...app, tried: hand, search: `?home=${hand}` })).toBeNull();
    // 다른(새) 코드면 한 번
    expect(bootPair({ ...app, tried: hand, search: `?home=${qr}` })).toEqual({ code: qr, home: true, handoff: false });
  });

  it('QR 주소가 시작 주소로 굳은 홈 화면 앱(넘기기 실패) — 열쇠 없으면 홈 화면 앱으로 한 번만', () => {
    expect(bootPair({ ...app, search: `?pair=${qr}` })).toEqual({ code: qr, home: true, handoff: false });
    expect(bootPair({ ...app, tried: qr, search: `?pair=${qr}` })).toBeNull();
  });

  it('코드가 없거나 모양이 다르면 null', () => {
    expect(bootPair({ ...browser, search: '' })).toBeNull();
    expect(bootPair({ ...app, search: '?home=zz' })).toBeNull();
    expect(bootPair({ ...app, search: `?go=abc` })).toBeNull();
  });

  it('코드를 썼다고 적는 건 맥이 답했을 때만 — 망이 안 닿아 실패한 코드는 다음 켜기에 다시 낸다', () => {
    expect(spentBy(new Error('짝짓기 코드가 틀렸거나 10분이 지났어요'))).toBe(true);
    expect(spentBy(new TypeError('Load failed'))).toBe(false); // 사파리 fetch 망 오류
    expect(spentBy(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('넘기기 주소는 ?home=<코드> 하나 — 읽으면 그대로', () => {
    expect(homeUrl(hand)).toBe(`/?home=${hand}`);
    expect(homeCodeFrom(homeUrl(hand).slice(1))).toBe(hand);
    expect(homeCodeFrom(`?home=${hand}0`)).toBeNull();
  });
});

describe('짝짓기 주소에서 코드 읽기', () => {
  it('?pair= 의 16진 32자만', () => {
    const c = 'a'.repeat(32);
    expect(pairCodeFrom(`?pair=${c}`)).toBe(c);
    expect(pairCodeFrom(`?x=1&pair=${c}`)).toBe(c);
    expect(pairCodeFrom('?pair=zz')).toBeNull();
    expect(pairCodeFrom(`?pair=${c}0`)).toBeNull();
    expect(pairCodeFrom(`?k=${'f'.repeat(64)}`)).toBeNull();
    expect(pairCodeFrom('')).toBeNull();
  });
});

describe('codeFromText — 붙여 넣은 글에서 연결 코드(홈 화면 앱 연결)', () => {
  const c = '0123456789abcdef0123456789abcdef';
  it('코드 그대로·띄어 쓴 묶음·대문자·앞뒤 공백', () => {
    expect(codeFromText(c)).toBe(c);
    expect(codeFromText(' 0123 4567 89ab cdef 0123 4567 89AB CDEF\n')).toBe(c);
  });
  it('주소를 통째로 붙여도(?pair=)', () => {
    expect(codeFromText(`https://mac.ts.net/?pair=${c}`)).toBe(c);
  });
  it('모양이 다르면 null', () => {
    expect(codeFromText('hello')).toBeNull();
    expect(codeFromText(c.slice(1))).toBeNull();
    expect(codeFromText(`${c}0`)).toBeNull();
  });
});

describe('groupCode — 화면에 읽기 좋게 4자씩', () => {
  it('묶음', () => {
    expect(groupCode('0123456789abcdef0123456789abcdef')).toBe('0123 4567 89ab cdef 0123 4567 89ab cdef');
  });
});
