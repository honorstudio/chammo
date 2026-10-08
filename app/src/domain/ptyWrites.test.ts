import { describe, expect, it } from 'vitest';
import { pendingWrites } from './ptyWrites';

describe('pendingWrites — pty 번호를 받기 전에 쓴 글도 버리지 않는다', () => {
  // 2026-10-05 윈도우 QA: 윈도우 가짜 콘솔(ConPTY)이 먼저 묻는 "커서 어디?"(ESC[6n)가 pty_open 답보다 먼저 웹뷰에 와서
  // xterm 의 답(ESC[1;1R)이 버려졌다 → 콘솔이 영영 멈춰 claude attach 가 안 뜨고, 폰에서 보낸 글이 그 창으로 사라졌다
  const make = () => {
    const sent: [number, string][] = [];
    const w = pendingWrites((id, d) => sent.push([id, d]));
    return { w, sent };
  };

  it('번호 전에 쓴 커서 답은 번호를 받는 순간 보낸다', () => {
    const { w, sent } = make();
    w.write('\x1b[1;1R');
    expect(sent).toEqual([]);
    w.open(7);
    expect(sent).toEqual([[7, '\x1b[1;1R']]);
  });

  it('번호 전에 여러 번 쓴 것은 순서대로 한 번에 — 따로 보내면 도착 순서가 섞일 수 있다', () => {
    const { w, sent } = make();
    w.write('\x1b[1;1R');
    w.write('a');
    w.write('b');
    w.open(3);
    expect(sent).toEqual([[3, '\x1b[1;1Ra' + 'b']]);
  });

  it('번호를 받은 뒤엔 바로 보낸다', () => {
    const { w, sent } = make();
    w.open(2);
    w.write('x');
    w.write('y');
    expect(sent).toEqual([[2, 'x'], [2, 'y']]);
  });

  it('쓴 게 없으면 열 때 아무것도 안 보낸다', () => {
    const { w, sent } = make();
    w.open(5);
    expect(sent).toEqual([]);
  });

  it('닫으면(열기 전 창이 사라짐) 모아 둔 것을 버리고 더 받지 않는다', () => {
    const { w, sent } = make();
    w.write('lost');
    w.close();
    w.write('after');
    w.open(9);
    expect(sent).toEqual([]);
  });

  it('번호를 못 받는 동안 쌓이는 양에 끝이 있다 — 오래된 것부터 버린다', () => {
    const { w, sent } = make();
    w.write('old');
    w.write('n'.repeat(70_000));
    w.open(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]![1].startsWith('old')).toBe(false);
    expect(sent[0]![1].length).toBeLessThanOrEqual(64 * 1024);
  });
});
