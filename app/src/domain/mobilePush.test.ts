import { describe, expect, it } from 'vitest';
import { autoResubscribe, b64urlBytes, goFrom, pushSupport } from './mobilePush';

describe('pushSupport — 이 폰에서 웹 푸시를 켤 수 있나', () => {
  const base = { sw: true, push: true, notif: true, standalone: true, ios: true, permission: 'default' };
  it('홈 화면에 붙인 앱이면 켤 수 있다', () => {
    expect(pushSupport(base)).toBe('ok');
  });
  it('아이폰 사파리 탭에선 안 된다 — 홈 화면에 추가부터(iOS 16.4+)', () => {
    expect(pushSupport({ ...base, standalone: false, push: false })).toBe('need-home');
    expect(pushSupport({ ...base, standalone: false })).toBe('need-home');
  });
  it('안드로이드·데스크톱 브라우저는 탭에서도 된다', () => {
    expect(pushSupport({ ...base, ios: false, standalone: false })).toBe('ok');
  });
  it('막아 뒀거나 기능이 없으면', () => {
    expect(pushSupport({ ...base, permission: 'denied' })).toBe('denied');
    expect(pushSupport({ ...base, ios: false, sw: false })).toBe('unsupported');
  });
});

describe('b64urlBytes — VAPID 공개 키(base64url) → 바이트', () => {
  it('패딩 없는 url 안전 글자', () => {
    expect(Array.from(b64urlBytes('-_8'))).toEqual([0xfb, 0xff]);
    expect(b64urlBytes('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4').length).toBe(65);
  });
});

describe('goFrom — 알림을 누르고 열렸을 때 갈 곳(?go=)', () => {
  it('세션 알림은 그 참모, 결정 대기는 참모 바꾸기 시트', () => {
    expect(goFrom('?go=session%3Aabc12345')).toEqual({ to: 'session', id: 'abc12345' });
    expect(goFrom('?go=inbox')).toEqual({ to: 'inbox' });
    expect(goFrom('')).toBeNull();
    expect(goFrom('?go=evil')).toBeNull();
  });
});

describe('autoResubscribe — 앱 업데이트·서비스 워커 갱신으로 구독이 사라지면 다시(2026-10-03)', () => {
  it('허락돼 있고 구독이 없고 사용자가 직접 끈 게 아니면 다시 구독', () => {
    expect(autoResubscribe({ can: 'ok', permission: 'granted', hasSub: false, userOff: false })).toBe(true);
  });
  it('직접 껐거나·이미 있거나·허락 전이면 안 한다', () => {
    expect(autoResubscribe({ can: 'ok', permission: 'granted', hasSub: false, userOff: true })).toBe(false);
    expect(autoResubscribe({ can: 'ok', permission: 'granted', hasSub: true, userOff: false })).toBe(false);
    expect(autoResubscribe({ can: 'ok', permission: 'default', hasSub: false, userOff: false })).toBe(false);
    expect(autoResubscribe({ can: 'need-home', permission: 'granted', hasSub: false, userOff: false })).toBe(false);
  });
});
