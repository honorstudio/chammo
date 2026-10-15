// 설정 > 폰과 메신저 > 다른 기기 참모 — 같은 테일스케일 계정 기기 줄의 작은 글과 할 수 있는 일(ADR 0007)
import { describe, expect, it } from 'vitest';
import { peerAction, peerSub } from './peerDevices';
import type { RemoteDevice } from '../data/remote';

const D = (o: Partial<RemoteDevice>): RemoteDevice => ({ id: 'n1', name: 'office-imac', os: 'macOS', status: 'connected', paired: true, old: false, version: '0.3.2', lastOk: null, ...o });

describe('peerSub', () => {
  it('연결됨 · 판', () => expect(peerSub(D({}))).toBe('연결됨 · 0.3.2'));
  it('짝짓기 필요', () => expect(peerSub(D({ status: 'pair', paired: false, version: null }))).toBe('짝짓기 필요'));
  it('끊긴 기기는 마지막으로 닿은 때', () => expect(peerSub(D({ status: 'offline', lastOk: Date.parse('2026-10-15T09:05:00') }))).toBe('연결 끊김 · 마지막 10/15 09:05'));
  it('옛 판은 업데이트 권함', () => expect(peerSub(D({ old: true, version: null }))).toBe('연결됨 · 그 기기 업데이트 필요'));
});

describe('peerAction', () => {
  it('짝 안 지은 기기 → 코드로 짝짓기', () => expect(peerAction(D({ status: 'pair', paired: false }))).toBe('pair'));
  it('열쇠가 끊긴 짝지은 기기 → 다시 짝짓기 + 끊기', () => expect(peerAction(D({ status: 'pair', paired: true }))).toBe('repair'));
  it('연결됨·끊김 → 끊기만', () => {
    expect(peerAction(D({}))).toBe('unpair');
    expect(peerAction(D({ status: 'offline' }))).toBe('unpair');
  });
});
