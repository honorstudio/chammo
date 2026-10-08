import { describe, expect, it } from 'vitest';
import { flowText, readPhoneLogin, showCard } from './phoneLogin';

describe('readPhoneLogin — 맥 /api/login 답', () => {
  it('판단 + 흐름', () => {
    const v = readPhoneLogin(JSON.stringify({ need: { since: 5, sessions: ['아이맥 · 자동화'], machine: false, at: 9 }, flow: { state: 'waiting', url: 'https://claude.com/cai/oauth/authorize?code=true', error: null } }));
    expect(v).toEqual({ need: { since: 5, sessions: ['아이맥 · 자동화'], machine: false }, flow: { state: 'waiting', url: 'https://claude.com/cai/oauth/authorize?code=true', error: null } });
  });
  it('깨졌거나 모르는 값은 버린다 — 주소는 https 로그인 주소만', () => {
    expect(readPhoneLogin('x')).toEqual({ need: null, flow: { state: 'idle', url: null, error: null } });
    const v = readPhoneLogin(JSON.stringify({ need: { since: 'x', sessions: [1] }, flow: { state: 'boom', url: 'javascript:alert(1)' } }));
    expect(v).toEqual({ need: null, flow: { state: 'idle', url: null, error: null } });
    expect(readPhoneLogin(JSON.stringify({ need: null, flow: { state: 'waiting', url: 'http://claude.com/x' } })).flow.url).toBeNull();
    expect(readPhoneLogin(JSON.stringify({ need: { since: 1, sessions: ['a', 2], machine: true } })).need).toEqual({ since: 1, sessions: ['a'], machine: true });
  });
});

describe('showCard — 홈 맨 위 카드', () => {
  it('로그인 필요거나 폰 로그인이 도는 중이면', () => {
    const idle = { state: 'idle' as const, url: null, error: null };
    expect(showCard({ need: null, flow: idle })).toBe(false);
    expect(showCard({ need: { since: 1, sessions: [], machine: true }, flow: idle })).toBe(true);
    expect(showCard({ need: null, flow: { ...idle, state: 'checking' } })).toBe(true);
    expect(showCard({ need: null, flow: { ...idle, state: 'done' } })).toBe(false);
  });
});

describe('flowText — 단계 말', () => {
  it('실패 이유마다', () => {
    expect(flowText({ state: 'failed', url: null, error: 'code' })).toBe('코드가 맞지 않았어요. 다시 시작해 주세요.');
    expect(flowText({ state: 'failed', url: null, error: 'timeout' })).toBe('10분이 지나 접었어요. 다시 시작해 주세요.');
    expect(flowText({ state: 'failed', url: null, error: 'spawn' })).toBe('맥에서 로그인을 못 띄웠어요. 다시 시작해 주세요.');
    expect(flowText({ state: 'done', url: null, error: null })).toBe('로그인됐어요. 멈춘 세션은 맥이 이어서 하게 해요.');
    expect(flowText({ state: 'checking', url: null, error: null })).toBe('확인하는 중…');
  });
});
