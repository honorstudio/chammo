import { describe, expect, it } from 'vitest';
import { WIDGET_POLL_MS } from './useTama';

describe('다마고치 위젯 물음 주기(2026-10-11 사용자 승인 — 300ms 가 앱 IPC 의 40%)', () => {
  it('1초', () => expect(WIDGET_POLL_MS).toBe(1000));
});
