import { describe, expect, it } from 'vitest';
import { accountLine, dotOf, stageOf, tokenFrom, tokenLooksRight, type MessengerView } from './messenger';

const base: MessengerView = { hasToken: false, bot: null, on: false, user: null, pending: null, running: false, error: null, waiting: false, tokenFile: false };
const gd = { name: '길동', username: 'gildong', id: 7001 };

describe('설정 > 텔레그램 단계', () => {
  it('토큰 → 짝짓기 → 연결됨 순서', () => {
    expect(stageOf(null)).toBe('loading');
    expect(stageOf(base)).toBe('token');
    expect(stageOf({ ...base, hasToken: true, bot: 'my_bot' })).toBe('pair');
    expect(stageOf({ ...base, hasToken: true, bot: 'my_bot', user: gd })).toBe('linked');
    // 링크를 누른 계정은 맥 확인이 먼저 — 이미 짝이 있어도
    expect(stageOf({ ...base, hasToken: true, bot: 'my_bot', user: gd, pending: { ...gd, id: 9 } })).toBe('confirm');
    // 토큰이 없으면(키체인에서 지워짐) 짝이 남아 있어도 토큰부터
    expect(stageOf({ ...base, hasToken: false, bot: 'my_bot', user: gd })).toBe('token');
  });

  it('상태 점 — 켜져 받는 중·오류·꺼짐', () => {
    expect(dotOf({ ...base, on: true, running: true })).toBe('ok');
    expect(dotOf({ ...base, on: true, running: true, error: '못 닿아요' })).toBe('err');
    expect(dotOf({ ...base, on: true, running: false, error: '토큰' })).toBe('err');
    expect(dotOf({ ...base, on: false })).toBe('off');
  });

  it('계정 줄은 @이름과 숫자 id — 이름만으론 못 알아본다', () => {
    expect(accountLine(gd)).toBe('@gildong · 7001');
    expect(accountLine({ name: 'x', username: null, id: 5 })).toBe('5');
  });

  it('토큰 모양은 Rust token_ok 와 같다', () => {
    expect(tokenLooksRight(' 123456789:AAH4kq9_sZx-Qw3eRtYuIoP1aSdFgHjKlZx ')).toBe(true);
    for (const bad of ['', '123:abc', 'abc:AAH4kq9_sZx-Qw3eRtYuIoP1aSdFgHjKlZx', '123456789:AAH4kq9 sZx-Qw3eRtYuIoP1aSdFgHjKlZx', '123456789:AAH4kq9_sZx-Qw3eRtYuIoP1aSdFgHjKl"x']) {
      expect(tokenLooksRight(bad)).toBe(false);
    }
  });
});

describe('tokenFrom — 붙여 넣은 글에서 토큰만', () => {
  const T = '123456789:AAH4kq9_sZx-Qw3eRtYuIoP1aSdFgHjKlZx';
  it('폰에서 복사하면 줄바꿈된 자리에 줄바꿈·공백이 끼어도 붙인다(2026-10-10 연결 버튼이 안 켜졌다)', () => {
    expect(tokenFrom('123456789:AAH4kq9_sZx-Qw3eRtYu\nIoP1aSdFgHjKlZx')).toBe(T);
    expect(tokenFrom(' 123456789:AAH4kq9_sZx-Qw3eRtYu IoP1aSdFgHjKlZx ')).toBe(T);
  });
  it('BotFather 메시지를 통째로 붙여도 토큰만 꺼낸다', () => {
    expect(tokenFrom(`Done! Congratulations on your new bot. Use this token to access the HTTP API:\n${T}\nKeep your token secure`)).toBe(T);
  });
  it('토큰이 없으면 붙인 글 그대로(버튼은 꺼진 채)', () => {
    expect(tokenFrom('hello')).toBe('hello');
    expect(tokenLooksRight(tokenFrom('hello'))).toBe(false);
  });
});
