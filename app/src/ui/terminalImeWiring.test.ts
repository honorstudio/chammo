// 윈도우 터미널 한글 두 번(2026-11-09) — 한글 다리는 맥 몫, 진단은 다리와 따로
import { describe, expect, it } from 'vitest';
import pane from './TerminalPane.tsx?raw';

describe('TerminalPane 한글 다리 배선', () => {
  it('다리는 imeBridgeOn(IS_WIN, imeMode) 가 참일 때만 건다 — 맥은 늘 참이라 지금 그대로', () => {
    expect(pane).toMatch(/imeBridgeOn\(IS_WIN, imeMode\) \? installImeBridge\(/);
  });
  it('보기 전용 창엔 다리도 진단도 안 건다', () => {
    expect(pane).toMatch(/const detachIme = readOnly \? \(\) => \{\} :/);
    expect(pane).toMatch(/const detachTrace = readOnly \? \(\) => \{\} : installImeTrace\(term\)/);
  });
  it('진단은 다리 밖에서 — 다리를 안 거는 윈도우에서도 키·조합 이벤트가 적힌다', () => {
    const bridge = pane.slice(pane.indexOf('function installImeBridge'), pane.indexOf('function installImeTrace'));
    expect(bridge).not.toContain("'keyup'");
    const trace = pane.slice(pane.indexOf('function installImeTrace'));
    for (const t of ['keydown', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend']) expect(trace).toContain(`'${t}'`);
  });
  it('끌 때 둘 다 뗀다', () => {
    expect(pane).toContain('detachIme();');
    expect(pane).toContain('detachTrace();');
  });
  it('다리 안 조합 막기(swallow)는 그대로 — 맥에서 조합 이벤트가 오면 xterm 조합 처리를 막는다(2026-09-28 "사사이이")', () => {
    expect(pane).toMatch(/for \(const t of COMPOSITION\) root\.addEventListener\(t, swallow, true\)/);
  });
});
