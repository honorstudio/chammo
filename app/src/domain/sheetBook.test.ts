import { describe, expect, it } from 'vitest';
import { a1, cellName, colPx, fromUniverStyle, range, rowPx, toUniver, toUniverCond, toUniverStyle, type SheetBook } from './sheetBook';

// 지어낸 값만
const book: SheetBook = {
  sheets: [{
    name: '매출', part: 'xl/worksheets/sheet1.xml', hidden: false,
    cells: [
      { r: 0, c: 0, v: '품목', s: 1 }, { r: 1, c: 0, v: 120 }, { r: 1, c: 1, v: '1월' }, { r: 1, c: 2, f: 'A2*2', v: 240 },
      { r: 2, c: 2, f: 'A3*2' }, { r: 3, c: 0, v: true }, { r: 3, c: 1, v: '#DIV/0!', err: true }, { r: 4, c: 4, s: 2 },
    ],
    merges: ['A1:B1'], cols: [{ min: 1, max: 2, width: 16, hidden: true }], rows: [{ r: 0, ht: 28 }], freeze: [1, 0],
    cond: [{ sqref: 'B2:E13', kind: 'expression', formulas: ['B2<AVERAGE(B$2:B$13)*0.8'], dxf: 0, priority: 2 }, { sqref: 'C3', kind: 'colorScale', formulas: [], priority: 1 }],
    valid: [], charts: 1, images: 0,
  }, { name: '숨김', part: 'xl/worksheets/s2.xml', hidden: true, cells: [], merges: [], cols: [], rows: [], cond: [], valid: [], charts: 0, images: 0 }],
  styles: {
    cell: [{}, { font: { b: true, sz: 14, color: '#FF0000', name: '맑은 고딕' }, fill: '#FFF2CC', numFmt: '#,##0"원"', align: { h: 'center', v: 'center', wrap: true }, border: { l: { style: 'thin', color: '#000000' }, b: { style: 'double' } } }, { fill: '#DDEBF7' }],
    dxf: [{ fill: '#FFC7CE', font: { color: '#9C0006' } }],
    font: { sz: 11, color: '#000000', name: '맑은 고딕' },
  },
};

describe('주소', () => {
  it('A1 ↔ 행·열', () => {
    expect(a1('B3')).toEqual([2, 1]);
    expect(a1('$AA$10')).toEqual([9, 26]);
    expect(a1('나')).toBeNull();
    expect(range('C4:A1')).toEqual({ startRow: 0, startColumn: 0, endRow: 3, endColumn: 2 });
    expect(cellName(9, 26)).toBe('AA10');
    expect(cellName(0, 701)).toBe('ZZ1');
  });
  it('엑셀 너비·높이 → 픽셀(기본 8.43자 = 64px, 15pt = 20px)', () => {
    expect(colPx(8.43)).toBe(64);
    expect(rowPx(15)).toBe(20);
  });
});

describe('Univer 로', () => {
  const { data, ids } = toUniver(book);
  const s0 = (data.sheets as Record<string, Record<string, unknown>>)[ids[0]!]!;
  const cells = s0.cellData as Record<number, Record<number, Record<string, unknown>>>;
  it('값·수식·종류', () => {
    expect(cells[0]![0]).toEqual({ v: '품목', t: 1, s: 'x1' });
    expect(cells[1]![1]!.t).toBe(4); // 숫자로 시작하는 글은 글 그대로
    expect(cells[1]![2]).toEqual({ f: '=A2*2', v: 240 });
    expect(cells[2]![2]).toEqual({ f: '=A3*2' }); // 계산 결과 없으면 화면이 계산
    expect(cells[3]![0]).toEqual({ v: true, t: 3 });
    expect(cells[4]![4]).toEqual({ s: 'x2' }); // 값 없이 서식만
  });
  it('병합·열 너비·숨김·행 높이·고정 틀·숨김 시트', () => {
    expect(s0.mergeData).toEqual([{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 1 }]);
    // 열 번호는 0부터(Rust 가 바꿔 줌) — 1~2 = B·C
    expect((s0.columnData as Record<number, unknown>)[0]).toBeUndefined();
    expect((s0.columnData as Record<number, unknown>)[2]).toEqual({ w: 117, hd: 1 });
    expect((s0.rowData as Record<number, unknown>)[0]).toEqual({ h: 37 });
    expect(s0.freeze).toEqual({ ySplit: 1, xSplit: 0, startRow: 1, startColumn: 0 });
    expect((data.sheets as Record<string, Record<string, unknown>>)[ids[1]!]!.hidden).toBe(1);
    expect(s0.defaultStyle).toEqual({ ff: '맑은 고딕', fs: 11 });
  });
  it('조건부 서식 — 그릴 수 있는 것만 리소스로', () => {
    const res = data.resources as { name: string; data: string }[];
    expect(res[0]!.name).toBe('SHEET_CONDITIONAL_FORMATTING_PLUGIN');
    const rules = JSON.parse(res[0]!.data)[ids[0]!];
    expect(rules).toHaveLength(1);
    expect(rules[0].rule).toEqual({ type: 'highlightCell', subType: 'formula', value: '=B2<AVERAGE(B$2:B$13)*0.8', style: { bg: { rgb: '#FFC7CE' }, cl: { rgb: '#9C0006' } } });
  });
  it('cellIs 숫자 비교는 그리고 칸 참조 비교는 뺀다', () => {
    expect(toUniverCond({ sqref: 'A1:A9', kind: 'cellIs', op: 'between', formulas: ['10', '20'], priority: 1 }, [], 'x')!.rule).toMatchObject({ subType: 'number', operator: 'between', value: [10, 20] });
    expect(toUniverCond({ sqref: 'A1', kind: 'cellIs', op: 'greaterThan', formulas: ['$B$1'], priority: 1 }, [], 'x')).toBeNull();
  });
});

describe('서식 왕복', () => {
  it('Univer 서식 → 서식 → Univer 서식이 같다', () => {
    const s = book.styles.cell[1]!;
    const u = toUniverStyle(s);
    expect(u).toMatchObject({ bl: 1, fs: 14, ff: '맑은 고딕', cl: { rgb: '#FF0000' }, bg: { rgb: '#FFF2CC' }, ht: 2, vt: 2, tb: 3, n: { pattern: '#,##0"원"' } });
    expect(fromUniverStyle(u, book.styles.font)).toEqual(s);
  });
  it('기본 글꼴과 같으면 글꼴은 빼고, 빈 서식은 빈 것', () => {
    expect(fromUniverStyle({ bg: { rgb: '#ddebf7' }, ff: '맑은 고딕', fs: 11 }, book.styles.font)).toEqual({ fill: '#DDEBF7' });
    expect(fromUniverStyle(null, book.styles.font)).toEqual({});
    // 편집기가 글을 칠 때 얹는 기본 글자색은 고른 색이 아니다
    expect(fromUniverStyle({ cl: { rgb: '#1b1c1f' }, ff: '맑은 고딕', fs: 11 }, { sz: 11, name: '맑은 고딕', color: '#000000' })).toEqual({});
    // 표가 새 행에 옮겨 붙인 기본 서식(General·검정 기본 글꼴)은 서식 없음
    expect(fromUniverStyle({ n: { pattern: 'General' }, ff: '맑은 고딕', fs: 11, cl: { rgb: '#000000' }, vt: 3 }, { sz: 11, name: '맑은 고딕' })).toEqual({ align: { v: 'bottom' } });
  });
});
