// 설정 > 폰과 메신저 > 다른 기기 참모 — 같은 테일스케일 계정 기기 줄의 작은 글과 할 수 있는 일(ADR 0007, 0.3.2 코드 없이 연결)
import { describe, expect, it } from 'vitest';
import { peerView } from './peerDevices';
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
