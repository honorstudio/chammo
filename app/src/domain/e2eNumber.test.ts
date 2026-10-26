// 새 기기 허용 확인 숫자(chammo-relay ADR 0007, 시안 e2e-approve v1) — 넣는 칸 다듬기·보여 주기
import { describe, expect, it } from 'vitest';
import { cellsOf, digits4, digits6, fmtSas } from './e2eNumber';

describe('확인 숫자', () => {
  it('넣은 글에서 숫자만 6자리까지', () => {
    expect(digits6('482 913')).toBe('482913');
    expect(digits6('4-8-2-9-1-3-7')).toBe('482913');
    expect(digits6('48a2')).toBe('482');
    expect(digits6('')).toBe('');
  });
  it('보여 줄 땐 세 자리씩 띄우고 앞 0 을 채운다', () => {
    expect(fmtSas(482913)).toBe('482 913');
    expect(fmtSas(7)).toBe('000 007');
  });
  it('칸 여섯 — 다음에 넣을 칸 표시', () => {
    expect(cellsOf('4829')).toEqual([
      { ch: '4', cur: false }, { ch: '8', cur: false }, { ch: '2', cur: false },
      { ch: '9', cur: false }, { ch: '', cur: true }, { ch: '', cur: false },
    ]);
    expect(cellsOf('482913').some((c) => c.cur)).toBe(false);
  });
  it('새 기기에 넣는 4자리(R7) — 숫자만 4자리까지, 칸 넷', () => {
    expect(digits4('07 2a4 1')).toBe('0724');
    expect(cellsOf('72', 4)).toEqual([{ ch: '7', cur: false }, { ch: '2', cur: false }, { ch: '', cur: true }, { ch: '', cur: false }]);
  });
});
