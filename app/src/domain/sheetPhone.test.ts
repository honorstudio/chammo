import { describe, expect, it } from 'vitest';
import { phoneGrid } from './sheetPhone';
import type { SheetData } from './sheetBook';

// 지어낸 값만
const sheet = (over: Partial<SheetData> = {}): SheetData => ({
  name: '매출', part: 'p', hidden: false, merges: [], cols: [], rows: [], cond: [], valid: [], charts: 0, images: 0,
  cells: [{ r: 0, c: 0, v: '가상 상점 매출', s: 1 }, { r: 1, c: 0, v: '연필' }, { r: 1, c: 1, v: 60000, s: 2 }, { r: 2, c: 1, v: 46112, s: 3 }],
  ...over,
});
const styles = [{}, { font: { b: true, color: '#1F3864' }, align: { h: 'center' } }, { numFmt: '#,##0"원"', fill: '#FFF2CC' }, { numFmt: 'yyyy-mm-dd' }];

describe('폰 읽기 전용 표', () => {
  it('숫자 서식·글자 서식·정렬', () => {
    const g = phoneGrid(sheet(), styles);
    expect(g.rows[0]!.cells[0]).toMatchObject({ text: '가상 상점 매출', css: { fontWeight: '700', color: '#1F3864', textAlign: 'center' } });
    expect(g.rows[1]!.cells[1]).toMatchObject({ text: '60,000원', css: { background: '#FFF2CC' }, num: true });
    expect(g.rows[2]!.cells[1]!.text).toBe('2026-03-31');
    expect(g.widths).toEqual([64, 64]);
  });
  it('병합은 rowSpan·colSpan, 덮인 칸은 빠진다', () => {
    const g = phoneGrid(sheet({ merges: ['A1:B2'] }), styles);
    expect(g.rows[0]!.cells).toEqual([expect.objectContaining({ c: 0, rowSpan: 2, colSpan: 2 })]);
    expect(g.rows[1]!.cells).toEqual([]);
  });
  it('숨긴 행·열은 안 그리고, 너비·높이는 픽셀로', () => {
    const g = phoneGrid(sheet({ cols: [{ min: 0, max: 0, width: 20 }, { min: 1, max: 1, hidden: true }], rows: [{ r: 1, hidden: true }, { r: 0, ht: 30 }] }), styles);
    expect(g.widths).toEqual([145, 0]);
    expect(g.rows.map((r) => r.r)).toEqual([0, 2]);
    expect(g.rows[0]!.h).toBe(40);
    expect(g.rows[1]!.cells.map((c) => c.c)).toEqual([0]); // B 열은 숨김
  });
  it('빈 시트는 줄 없음', () => {
    expect(phoneGrid(sheet({ cells: [] }), styles).rows).toEqual([]);
  });
});
