// 아이폰 사파리에서 로그인하면 홈 화면 앱엔 안 넘어간다(저장 공간이 따로) — 사파리면 홈 화면에 먼저 추가하게
import { describe, expect, it } from 'vitest';
import { isIos, loginPlace } from './homeFirst';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15';
const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A315N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';

describe('isIos', () => {
  it('아이폰·아이폰 크롬은 iOS', () => {
    expect(isIos(IPHONE, 5)).toBe(true);
    expect(isIos(IOS_CHROME, 5)).toBe(true);
  });
  it('아이패드는 데스크톱 UA 라 손가락 수로 가른다 — 진짜 맥(손가락 0)은 아님', () => {
    expect(isIos(IPAD_DESKTOP, 5)).toBe(true);
    expect(isIos(IPAD_DESKTOP, 0)).toBe(false);
  });
  it('안드로이드는 아님', () => {
    expect(isIos(ANDROID, 5)).toBe(false);
  });
});

describe('loginPlace', () => {
  it('iOS 사파리(홈 화면 앱 아님)면 여기서 로그인하지 않고 홈 화면 먼저', () => {
    expect(loginPlace({ ios: true, standalone: false })).toBe('home-first');
  });
  it('iOS 홈 화면 앱이면 여기서', () => {
    expect(loginPlace({ ios: true, standalone: true })).toBe('here');
  });
  it('안드로이드·데스크톱은 브라우저와 설치 앱이 저장을 나눠 써서 어디서든 여기서', () => {
    expect(loginPlace({ ios: false, standalone: false })).toBe('here');
    expect(loginPlace({ ios: false, standalone: true })).toBe('here');
  });
});
