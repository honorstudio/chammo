import { describe, expect, it } from 'vitest';
import rail from '../ui/space/OrchRail.tsx?raw';
import { WAKE_GAP_MS, wakeOnce } from './railWake';

// 2026-10-15 윈도우 0.3.0 확인 — 쉬는 참모 프사를 처음 누르면 호버 카드만 뜨고 안 깨웠다(맥은 한 번에).
// click 하나에만 기대면 호버 카드가 막 뜨는 사이 press→release 가 어긋난 판에서 click 이 안 온다 — pointerup 으로도 깨우고, 둘이 겹치면 한 번만
describe('쉬는 참모 깨우기 — pointerup·click 어느 쪽이 먼저 와도 한 번', () => {
  it('처음 오는 신호는 깨우고, 곧바로 오는 다른 신호는 무시한다', () => {
    const first = wakeOnce(0, 1000);
    expect(first).toEqual({ wake: true, at: 1000 });
    expect(wakeOnce(first.at, 1000 + 30)).toEqual({ wake: false, at: 1000 });
  });
  it('간격이 지나면 다시 깨운다(같은 칸을 나중에 또 누름)', () => {
    expect(wakeOnce(1000, 1000 + WAKE_GAP_MS)).toEqual({ wake: true, at: 1000 + WAKE_GAP_MS });
  });
  it('띠 쉬는 참모 단추는 눌렀다 뗌(pointerup)과 click 둘 다 같은 wake 로 — 맥은 click 하나로 되던 길을 그대로 둔다', () => {
    const btn = rail.slice(rail.indexOf('className="lk-av rest"'), rail.indexOf('</button>', rail.indexOf('className="lk-av rest"')));
    expect(btn).toMatch(/onPointerDown=\{\(e\) => \{ if \(e\.button === 0\) pressed\.current = r\.key; \}\}/);
    expect(btn).toMatch(/onPointerUp=\{\(e\) => \{ if \(e\.button === 0 && !e\.ctrlKey && pressed\.current === r\.key\) wake\(r\); pressed\.current = null; \}\}/);
    expect(btn).toMatch(/onClick=\{\(\) => wake\(r\)\}/);
  });
});
