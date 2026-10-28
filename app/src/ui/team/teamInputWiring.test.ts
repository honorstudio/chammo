// 팀챗 입력(10-29 사용자) — ⌘A 가 따로 창에서 안 먹었다 · '내 참모에게'를 누르고 한참 뒤에야 반응해 여러 번 눌렀다
import { describe, expect, it } from 'vitest';
import convo from './TeamConvo.tsx?raw';
import messenger from '../../messenger.tsx?raw';

describe('메신저 따로 창 ⌘A', () => {
  it('Rust 가 앞 창에 부르는 __menu("select_all") 를 단다 — 메인 창과 같은 selectAllHere(보고 있는 칸만)', () => {
    expect(messenger).toMatch(/__menu[^\n]*select_all[^\n]*selectAllHere\(false, null\)/);
  });
});

describe('내 참모에게 넘기기 — 누르는 즉시', () => {
  const s = convo.slice(convo.indexOf('const handOver'), convo.indexOf('let prevAt'));
  it('보내기(1~3초, 10-29 실측) 전에 카드를 닫고 그 말 밑에 넘기는 중을 단다', () => {
    const send = s.indexOf('handoff.send(');
    expect(send).toBeGreaterThan(0);
    expect(s.indexOf('setHanding(null)')).toBeGreaterThan(-1);
    expect(s.indexOf('setHanding(null)')).toBeLessThan(send);
    expect(s.indexOf('setHandPend(')).toBeLessThan(send);
    expect(convo).toContain('에게 넘기는 중');
  });
  it('보내는 중에 또 누르면 한 번만 — 같은 말이 참모에게 여러 번 가지 않게', () => {
    expect(s).toMatch(/if \(handFly\.current\.has\(key\)\) return;/);
    expect(s).toContain('.finally(');
    expect(s).toContain('handFly.current.delete(key)');
  });
  it('넘기는 중인 말엔 내 참모에게 단추를 안 보인다', () => {
    expect(convo).toMatch(/const pend = handPend\[[^\n]*\n\s*const canHand = !!handoff && !pend &&/);
  });
  it('못 넘기면 오류 한 줄 + 카드를 붙일 말째 다시 연다', () => {
    expect(s).toContain('못 넘겼어요');
    expect(s).toMatch(/setHanding\(\(h\) => h \?\? it\)/);
  });
});

describe('@ 내 참모 — 보내는 즉시 줄이 뜬다', () => {
  const s = convo.slice(convo.indexOf('const sendMine'), convo.indexOf('const send = (checked'));
  it('보내기 전에 보내는 중 줄을 넣고, 되면 보냄·안 되면 뺀다', () => {
    expect(s.indexOf('setToMine(')).toBeLessThan(s.indexOf('handoff.send('));
    expect(s).toMatch(/setToMine\(\(x\) => x\.filter\(/);
    expect(convo).toContain('에게 보내는 중');
  });
});
