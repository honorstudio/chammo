import { describe, expect, it } from 'vitest';
import orchRail from './OrchRail.tsx?raw';
import usePick from './usePick.ts?raw';
import dragPath from './dragPath.ts?raw';

// WebKit(맥)은 앱이 조금만 밀려도 놓기 직전 끌기 사건을 buttons 0 으로 준다 — 그걸 보고 바로 끝내면 빨리 놓은 게 빗나간다(2026-10-12).
// 포인터 끌기는 buttons 0 을 dragEnd.lostRelease 로만 다룬다
describe('포인터 끌기는 buttons 0 을 바로 끝내기로 보지 않는다', () => {
  for (const [name, src] of [['OrchRail', orchRail], ['usePick(보관함 네모 고르기)', usePick], ['dragPath', dragPath]] as const) {
    it(name, () => {
      expect(src).not.toMatch(/buttons\s*===?\s*0\s*\)\s*\{?\s*finish/);
      expect(src).toMatch(/lostRelease\(/);
    });
  }
});
