// 창 진입점은 ErrorBoundary 로 감싼다 — 렌더 오류 하나로 흰 화면이 됐다(2026-10-11 bug-hunt, 하네스: read_orch_order null → root 빈 칸)
import { describe, expect, it } from 'vitest';
import main from '../main.tsx?raw';
import mobile from '../mobile.tsx?raw';
import reader from '../reader.tsx?raw';

describe('흰 화면 막이', () => {
  it.each([['main', main], ['mobile', mobile], ['reader', reader]])('%s 진입점이 ErrorBoundary 로 감싼다', (_n, src) => {
    expect(src).toMatch(/<ErrorBoundary>/);
  });
});
