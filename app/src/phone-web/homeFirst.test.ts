// 아이폰 사파리에서 로그인하면 홈 화면 앱엔 안 넘어간다(저장 공간이 따로) — 사파리면 홈 화면에 먼저 추가하게
import { describe, expect, it } from 'vitest';
import { deviceUa, isAndroid, isIos, loginPlace, phoneName } from './homeFirst';

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
  it('데스크톱은 여기서', () => {
    expect(loginPlace({ ios: false, standalone: false })).toBe('here');
    expect(loginPlace({ ios: false, standalone: true })).toBe('here');
  });
  // 2026-11-18 사용자 "aos 는 ios 랑 다르게 웹에서 작동하게 되고 있음. 그냥 설치해서(pwa) 사용하도록" — 크롬 탭이면 설치부터
  it('안드로이드 크롬 탭이면 설치 먼저, 설치한 앱이면 여기서', () => {
    expect(loginPlace({ ios: false, android: true, standalone: false })).toBe('install-first');
    expect(loginPlace({ ios: false, android: true, standalone: true })).toBe('here');
  });
});

describe('isAndroid', () => {
  it('안드로이드 폰·태블릿만 — 아이폰·아이패드(맥 UA)·맥은 아님', () => {
    expect(isAndroid(ANDROID)).toBe(true);
    expect(isAndroid('Mozilla/5.0 (Linux; Android 15; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36')).toBe(true);
    expect(isAndroid(IPHONE)).toBe(false);
    expect(isAndroid(IPAD_DESKTOP)).toBe(false);
  });
});

// 11-18 사용자: 아이패드를 연결했더니 기기 관리에 'Android · 폰' — iPadOS 사파리는 맥 UA 를 보내서 'iPhone|iPad' 정규식에 안 걸렸다
const ANDROID_TAB = 'Mozilla/5.0 (Linux; Android 15; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36';
describe('phoneName — 계정에 올리는 기기 이름', () => {
  it('아이패드(맥 UA + 손가락)는 iPad, 아이폰은 iPhone', () => {
    expect(phoneName(IPAD_DESKTOP, 5)).toBe('iPad');
    expect(phoneName('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', 5)).toBe('iPad');
    expect(phoneName(IPHONE, 5)).toBe('iPhone');
    expect(phoneName(IOS_CHROME, 5)).toBe('iPhone');
  });
  it('안드로이드 폰·태블릿(Mobile 없음)을 가른다', () => {
    expect(phoneName(ANDROID, 5)).toBe('Android');
    expect(phoneName(ANDROID_TAB, 5)).toBe('Android Tablet');
  });
  it('그 밖(데스크톱 브라우저)은 안드로이드라고 하지 않는다', () => {
    expect(phoneName(IPAD_DESKTOP, 0)).not.toBe('Android');
  });
});

describe('deviceUa — 컴퓨터가 기기 이름을 짓는 UA', () => {
  it('맥 UA 아이패드엔 iPad 를 붙여 컴퓨터가 Mac 으로 짓지 않게', () => {
    expect(deviceUa(IPAD_DESKTOP, 5)).toContain('iPad');
    expect(deviceUa(IPAD_DESKTOP, 0)).toBe(IPAD_DESKTOP);
    expect(deviceUa(IPHONE, 5)).toBe(IPHONE);
  });
});
