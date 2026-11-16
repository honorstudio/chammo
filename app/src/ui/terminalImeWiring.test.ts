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
  it('keypress 막이(공개 이슈 #13)는 키 처리기 맨 앞 — 윈도우 붙여넣기·복사·맥 키보다 먼저 모든 keydown 을 봐야 229 를 놓치지 않는다', () => {
    const at = pane.indexOf('term.attachCustomKeyEventHandler((e) => {');
    expect(at).toBeGreaterThan(0);
    const body = pane.slice(at, pane.indexOf('const win = IS_WIN', at));
    expect(body).toMatch(/if \(imeKeypress\(e\) && !imeNoKeypressGuard\) e\.preventDefault\(\);/);
    expect(pane).toMatch(/const imeKeypress = imeKeypressGuard\(\);\n\s*term\.attachCustomKeyEventHandler/); // 터미널마다 따로
  });
  it('막이는 플랫폼을 안 가린다 — 229 뒤 keypress 가 오면 어디서든 같은 두 번 길이다', () => {
    expect(pane).not.toMatch(/IS_WIN[^\n]*imeKeypressGuard|imeKeypressGuard[^\n]*IS_WIN/);
  });
  it('진단은 keypress 도 적는다 — 조합 없이 keypress 로 오는 길을 가르는 증거', () => {
    const trace = pane.slice(pane.indexOf('function installImeTrace'));
    expect(trace).toContain("'keypress'");
  });
});
