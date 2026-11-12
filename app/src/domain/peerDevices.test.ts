// 설정 > 기기 관리 > 다른 기기 참모 — 같은 테일스케일 계정 기기 줄의 작은 글과 할 수 있는 일(ADR 0007, 0.3.2 코드 없이 연결)
import { describe, expect, it } from 'vitest';
import { canRepair, connectLabel, farPaused, pausedText, peerView, tailscaleNeedsLook } from './peerDevices';
import type { RemoteDevice } from '../data/remote';

const D = (o: Partial<RemoteDevice>): RemoteDevice => ({ id: 'n1', name: 'office-imac', os: 'macOS', status: 'connected', paired: true, old: false, link: false, version: '0.3.2', lastOk: null, ...o });

describe('peerView — 줄 상태는 연결됨 / 연결 안 됨 둘', () => {
  it('연결됨 · 판, 끊기만', () => {
    expect(peerView(D({}), false)).toEqual({ word: '연결됨', extra: '0.3.2', connect: false, unlink: true, code: false });
  });
  it('처음 보는 기기 → 연결 안 됨, 연결 단추(코드는 대피로)', () => {
    expect(peerView(D({ status: 'pair', paired: false, version: '0.3.2' }), false)).toEqual({ word: '연결 안 됨', extra: null, connect: true, unlink: false, code: true });
  });
  it('열쇠가 끊긴 짝지은 기기 → 연결 안 됨, 다시 연결 + 끊기', () => {
    expect(peerView(D({ status: 'pair', paired: true }), false)).toMatchObject({ word: '연결 안 됨', connect: true, unlink: true });
  });
  it('허용을 기다리는 중엔 연결 단추 대신 기다림', () => {
    expect(peerView(D({ status: 'pair', paired: false }), true)).toMatchObject({ word: '연결 안 됨', extra: '그 기기에서 허용을 기다려요', connect: false });
  });
  it('안 닿는 짝지은 기기 → 연결 안 됨 · 마지막으로 닿은 때', () => {
    expect(peerView(D({ status: 'offline', lastOk: Date.parse('2026-10-15T09:05:00') }), false)).toEqual({ word: '연결 안 됨', extra: '꺼져 있음 · 마지막 10/15 09:05', connect: false, unlink: true, code: false });
  });
  it('옛 판은 연결 단추 없이 업데이트 권함 — 코드로만', () => {
    expect(peerView(D({ status: 'pair', paired: false, old: true, version: null }), false)).toEqual({ word: '연결 안 됨', extra: '그 기기 업데이트 필요', connect: false, unlink: false, code: true });
  });
  it('옛 윈도우(0.3.7 까지, link 없음)는 연결을 못 받아서 업데이트 권함 — 코드도 안 연다(그 기기가 답을 못 보낸다)', () => {
    expect(peerView(D({ status: 'pair', paired: false, os: 'windows', version: '0.3.7' }), false)).toEqual({ word: '연결 안 됨', extra: '그 기기 업데이트 필요', connect: false, unlink: false, code: false });
  });
  it('0.3.8 윈도우(link)는 맥처럼 연결 단추', () => {
    expect(peerView(D({ status: 'pair', paired: false, os: 'windows', version: '0.3.8', link: true }), false)).toEqual({ word: '연결 안 됨', extra: null, connect: true, unlink: false, code: true });
  });
  it('옛 코드로 한쪽만 짝지은 옛 윈도우가 끊기면 끊기만 — 업데이트 뒤 다시 연결', () => {
    expect(peerView(D({ status: 'pair', paired: true, os: 'windows', version: '0.3.7' }), false)).toEqual({ word: '연결 안 됨', extra: '그 기기 업데이트 필요', connect: false, unlink: true, code: false });
  });
});

describe('peerView — 같은 Chammo 계정이 아니라 멈춘 짝(11-09 보안)', () => {
  it('상대가 로그아웃·다른 계정 → 연결 멈춤 · 한 줄 · 다시 짝짓기(연결) + 끊기', () => {
    expect(peerView(D({ status: 'account', paused: 'other' }), false)).toEqual({ word: '연결 멈춤', extra: '계정이 바뀌어 연결이 멈췄어요 — 재연결해 주세요', connect: true, unlink: true, code: false });
  });
  it('계정이 안 묶인 옛 짝은 예전 방식이라 재연결(11-12 — 계정이 바뀐 게 아니다)', () => {
    expect(peerView(D({ status: 'account', paused: 'unbound' }), false)).toMatchObject({ extra: '예전 방식으로 연결한 컴퓨터예요. 지금 방식으로 재연결해 주세요', connect: true });
  });
  it('이 기기가 로그아웃 → 로그인부터(연결 단추 없음)', () => {
    expect(peerView(D({ status: 'account', paused: 'nologin' }), false)).toMatchObject({ word: '연결 멈춤', connect: false, unlink: true });
    expect(pausedText('nologin')).toContain('로그인');
  });
  it('다시 짝짓기를 누르면 허용을 기다림', () => {
    expect(peerView(D({ status: 'account', paused: 'other' }), true)).toMatchObject({ extra: '그 기기에서 허용을 기다려요', connect: false });
  });
});

describe('계정 때문에 멈춘 짝 — QA 0.4.11 문제 3-1·3-2·3-3', () => {
  it('3-1 단추 이름은 줄 글과 같은 "다시 짝짓기", 보통 짝은 "연결"', () => {
    expect(connectLabel(D({ status: 'account', paused: 'other' }))).toBe('재연결');
    expect(connectLabel(D({ status: 'pair', paired: false }))).toBe('연결');
  });
  it('3-2 기기 보기에서 멈춘 짝은 꺼진 기기와 따로 — 목록 상태 또는 읽기 오류 account:<코드>', () => {
    expect(farPaused(D({ status: 'account', paused: 'unbound' }), null)).toBe('unbound');
    expect(farPaused(D({ status: 'account' }), null)).toBe('other');
    expect(farPaused(undefined, 'account:nologin')).toBe('nologin');
    expect(farPaused(D({ status: 'offline' }), 'timeout')).toBeNull();
    expect(farPaused(undefined, null)).toBeNull();
    expect(farPaused(undefined, 'account:이상한값')).toBe('other');
  });
  it('3-2 다시 짝짓기는 로그인 안 한 기기에선 없다(로그인부터)', () => {
    expect(canRepair('other')).toBe(true);
    expect(canRepair('unbound')).toBe(true);
    expect(canRepair('unknown')).toBe(true);
    expect(canRepair('nologin')).toBe(false);
  });
  it('3-3 멈춘 짝이나 직통 폰 줄이 있으면 "테일스케일이 있는 분만" 칸을 펼친다', () => {
    expect(tailscaleNeedsLook([D({}), D({ id: 'n2', status: 'account', paused: 'other' })], [])).toBe(true);
    expect(tailscaleNeedsLook([], [{ direct: true }])).toBe(true);
    expect(tailscaleNeedsLook([D({}), D({ id: 'n2', status: 'offline' })], [{ direct: false }, {}])).toBe(false);
  });
});

describe('pausedText — 예전 방식 짝(11-12)', () => {
  it('계정이 안 묶인 옛 짝은 계정이 바뀐 게 아니라 다시 연결이 필요하다고', () => {
    expect(pausedText('unbound')).toContain('예전 방식');
    expect(pausedText('unbound')).not.toContain('계정이 바뀌어');
    expect(pausedText('other')).toContain('계정이 바뀌어');
  });
});
