import { describe, expect, it } from 'vitest';
import { autoResubscribe, b64urlBytes, goFrom, lastUsable, noteJump, PUSH_HINT, pushError, pushSupport } from './mobilePush';
import type { Session } from './session';

describe('pushSupport — 이 폰에서 웹 푸시를 켤 수 있나', () => {
  const base = { sw: true, push: true, notif: true, standalone: true, ios: true, permission: 'default', secure: true };
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
  it('http 주소(보안 안 된 출처)면 따로 — 서비스 워커·푸시가 아예 없어서 종이 조용히 숨었다(남의 테일넷 HTTPS 꺼짐, 2026-10-22)', () => {
    expect(pushSupport({ ...base, secure: false, sw: false, push: false })).toBe('insecure');
    expect(pushSupport({ ...base, ios: false, standalone: false, secure: false, sw: false, push: false })).toBe('insecure');
    // 아이폰 사파리 탭이어도 '홈 화면에 추가' 안내는 소용없다 — http 면 홈 화면 앱도 못 받는다
    expect(pushSupport({ ...base, standalone: false, secure: false, sw: false })).toBe('insecure');
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

describe('PUSH_HINT — 종을 눌렀는데 못 켤 때 까닭(QA 2차)', () => {
  it('http 안내는 데스크톱 설정의 실제 탭 이름(기기 관리)을 가리킨다 — \'모바일\' 탭은 없다', () => {
    expect(PUSH_HINT.insecure).toContain('기기 관리');
    expect(PUSH_HINT.insecure).not.toContain('설정 > 모바일');
  });
  it('막힘 안내는 브라우저 탭으로 연 경우(사이트 설정)도 말한다 — 홈 화면 앱이 아니면 설정 > 알림에 참모가 없다', () => {
    expect(PUSH_HINT.denied).toMatch(/사이트 설정/);
  });
});

describe('pushError — 브라우저가 준 영어 오류를 그대로 띄우지 않는다(QA 2차 iOS \'User denied push permission\')', () => {
  it('허락 거절(NotAllowedError)은 우리말 까닭으로', () => {
    const e = Object.assign(new Error('User denied push permission'), { name: 'NotAllowedError' });
    expect(pushError(e)).toMatch(/허락/);
    expect(pushError(e)).not.toMatch(/User denied/);
  });
  it('우리가 만든 한글 오류는 그대로, 모르는 오류는 우리말 앞머리 + 원문', () => {
    expect(pushError(new Error('알림을 허락해야 받을 수 있어요'))).toBe('알림을 허락해야 받을 수 있어요');
    expect(pushError(new Error('AbortError: boom'))).toMatch(/^알림을 못 켰어요 — /);
  });
});

describe('noteJump — 눌린 알림 갈 곳 → 폰에서 할 일(2026-10-23 사용자: 앱만 열리고 보던 시트 그대로)', () => {
  const o = (id: string, sessionId: string) => ({ id, sessionId, name: id }) as Session;
  const orchs = [o('a1', 'aaaa-1111'), o('5e55a0d1', '5e55a0d1-7c2b-4f3e-9a10-2b8d4c6e0f13')];
  it('참모 답 → 그 참모 채팅', () => {
    expect(noteJump({ to: 'session', id: 'a1' }, orchs)).toEqual({ orch: 'a1' });
  });
  it('결정·직접 카드 → 그 참모 채팅의 그 카드(참모는 전체 대화 번호로 와도 찾는다)', () => {
    expect(noteJump({ to: 'card', orch: '5e55a0d1-7c2b-4f3e-9a10-2b8d4c6e0f13', card: 'w:t1' }, orchs)).toEqual({ orch: '5e55a0d1', card: 'w:t1' });
    expect(noteJump({ to: 'card', orch: 'a1', card: 'd:c9' }, orchs)).toEqual({ orch: 'a1', card: 'd:c9' });
  });
  it('팀 메시지 → 그 대화', () => {
    expect(noteJump({ to: 'team', room: 'r1' }, orchs)).toEqual({ team: 'r1' });
  });
  it('결정 대기함(옛 갈 곳) → 답을 기다림 목록(참모 바꾸기 시트)', () => {
    expect(noteJump({ to: 'inbox' }, orchs)).toEqual({ picker: true });
  });
  it('모르는 참모(꺼짐·하위 세션) → 할 일 없음(보던 화면 그대로)', () => {
    expect(noteJump({ to: 'session', id: 'sub1' }, orchs)).toBeNull();
    expect(noteJump({ to: 'card', orch: 'zz', card: 'w:t1' }, orchs)).toBeNull();
  });
});

describe('lastUsable — 컴퓨터의 마지막 알림 갈 곳(latest)을 믿을 만한가', () => {
  it('30분 안의 갈 곳만', () => {
    expect(lastUsable({ target: 'session:a1', age: 12 })).toEqual({ to: 'session', id: 'a1' });
    expect(lastUsable({ target: 'session:a1', age: 31 * 60 })).toBeNull();
    expect(lastUsable({ target: '', age: 3 })).toBeNull();
    expect(lastUsable({ target: 'latest', age: 3 })).toBeNull(); // 다시 latest 로 돌지 않게
    expect(lastUsable({ target: 'session:a1', age: null })).toBeNull();
  });
});
