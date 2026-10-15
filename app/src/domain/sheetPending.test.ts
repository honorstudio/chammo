import { describe, expect, it } from 'vitest';
import { addLog, conflicts, countOf, EMPTY, sheetLines } from './sheetPending';
import type { LogEntry } from './sheetLog';

// 지어낸 값만
const P = 'xl/worksheets/sheet1.xml';
const cell = (r: number, c: number, v: unknown, f: string | null = null, before?: { v?: unknown; f?: string | null }, styled = false): LogEntry =>
  ({ k: 'cell', sheet: P, name: '월별합계', r, c, now: { v: v as never, f }, styled, ...(before ? { before: before as never } : {}) });
const op = (o: Record<string, unknown>): LogEntry => ({ k: 'op', op: { part: P, ...o }, name: '월별합계' });

describe('보낼 것 모으기', () => {
  it('처음 값은 첫 고침 직전, 지금 값은 마지막 — 되돌리면 빠진다', () => {
    let p = addLog(EMPTY, [cell(2, 1, 12, null, { v: 10 })]);
    p = addLog(p, [cell(2, 1, 15, null, { v: 12 })]);
    expect(p.cells).toEqual([{ sheet: P, name: '월별합계', r: 2, c: 1, before: { v: 10, f: null }, after: { v: 15, f: null }, styled: false }]);
    p = addLog(p, [cell(2, 1, 10, null, { v: 15 })]);
    expect(countOf(p)).toBe(0);
  });
  it('수식 다시 계산 칸은 사용자가 고친 게 아니다', () => {
    expect(countOf(addLog(EMPTY, [{ ...cell(5, 4, 99, 'SUM(B1:B4)'), calc: true } as LogEntry]))).toBe(0);
  });
  it('행을 끼우면 앞서 고친 칸 주소가 밀리고, 지우면 빠지고, 메모가 남는다', () => {
    let p = addLog(EMPTY, [cell(2, 1, 12, null, { v: 10 }), cell(7, 0, '메모', null, { v: null })]);
    p = addLog(p, [op({ op: 'insertRows', at: 3, n: 1 })]);
    expect(p.cells.map((x) => [x.r, x.c])).toEqual([[2, 1], [8, 0]]);
    p = addLog(p, [op({ op: 'deleteRows', at: 8, n: 1 })]);
    expect(p.cells.map((x) => [x.r, x.c])).toEqual([[2, 1]]);
    expect(p.notes).toEqual(['월별합계: 4행 앞에 1행 끼움', '월별합계: 9행 지움']);
  });
});

describe('보낼 글', () => {
  it('칸마다 시트!주소 처음 → 지금, 수식·서식, 메모', () => {
    let p = addLog(EMPTY, [
      cell(2, 1, 1234, null, { v: 3265000, f: 'SUMIFS(데이터!$C$2:$C$40,데이터!$A$2:$A$40,B$1,데이터!$B$2:$B$40,2)' }),
      cell(2, 4, 50, 'B3*2', { v: 50, f: 'B3+B3' }),
      cell(2, 2, 3680000, null, { v: 3680000 }, true),
      cell(20, 0, '한글', null, { v: null }),
    ]);
    p = addLog(p, [op({ op: 'insertCols', at: 6, n: 2 })]);
    expect(sheetLines('/H/dev/x/매출_정리.xlsx', p)).toEqual([
      '■ 매출_정리.xlsx (/H/dev/x/매출_정리.xlsx)',
      '· 월별합계!B3 3,265,000(=SUMIFS(데이터!$C$2:$C$40,데이터!$A$2:$A$40,B$1…) → 1,234',
      '· 월별합계!C3 서식 바뀜',
      '· 월별합계!E3 수식 바뀜 50(=B3+B3) → 50(=B3*2)',
      '· 월별합계!A21 (빈 칸) → "한글"',
      '· 월별합계: G열 앞에 2열 끼움',
    ]);
  });
  it('보낼 게 없으면 빈 줄', () => {
    expect(sheetLines('/a.xlsx', EMPTY)).toEqual([]);
  });
});

describe('바깥 변경과 충돌', () => {
  const outside = (cells: { r: number; c: number; v?: number | string; f?: string }[]) => ({ sheets: [{ name: '월별합계', part: P, cells }] });
  it('내가 고친 칸을 밖에서 안 건드렸으면 얹어도 된다(다른 칸은 바뀌어도)', () => {
    const log = [cell(2, 1, 12, null, { v: 10 })];
    expect(conflicts(log, outside([{ r: 2, c: 1, v: 10 }, { r: 5, c: 5, v: 999 }]))).toEqual([]);
  });
  it('수식 다시 계산 칸은 내 고침이 아니라 판정에서 뺀다', () => {
    expect(conflicts([cell(2, 1, 12, null, { v: 10 }), { ...cell(2, 4, 99, 'SUM(B3:D3)', { v: 50, f: 'SUM(B3:D3)' }), calc: true } as LogEntry], outside([{ r: 2, c: 1, v: 10 }, { r: 2, c: 4, v: 77, f: 'SUM(B3:C3)' }]))).toEqual([]);
  });
  it('같은 칸을 밖에서도 고쳤으면 충돌', () => {
    expect(conflicts([cell(2, 1, 12, null, { v: 10 })], outside([{ r: 2, c: 1, v: 11 }]))).toEqual(['월별합계!B3']);
  });
  it('수식 칸은 수식이 같으면 계산 결과가 달라도 괜찮다', () => {
    expect(conflicts([cell(2, 4, 7, null, { v: 50, f: 'SUM(A1:A3)' })], outside([{ r: 2, c: 4, v: 60, f: 'SUM(A1:A3)' }]))).toEqual([]);
  });
  it('행열 조작이 섞이면 판정 못 해서 충돌', () => {
    expect(conflicts([op({ op: 'insertRows', at: 1, n: 1 })], outside([]))).toEqual(['행·열·시트 조작']);
  });
});
