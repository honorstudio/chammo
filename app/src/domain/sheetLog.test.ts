import { describe, expect, it } from 'vitest';
import { blockedOf, cellState, compile, fromCalc, fromMutation, type CellState, type LogCtx } from './sheetLog';

// 지어낸 시트 — s0 은 불러온 시트(부품 경로), 새 시트는 이름이 열쇠
function ctx(cells: Record<string, CellState> = {}) {
  const names = new Map<string, string>([['s0', '매출']]);
  const c: LogCtx = {
    key: (id) => (id === 's0' ? 'xl/worksheets/sheet1.xml' : names.get(id) ?? id),
    name: (id) => names.get(id) ?? id,
    cell: (id, r, col) => cells[`${id}!${r}!${col}`] ?? { v: null, f: null },
    renamed: (id, n) => { names.set(id, n); },
  };
  return c;
}

describe('변경 → 기록', () => {
  it('칸 값은 그 순간 칸 상태를, 서식을 건드렸는지도', () => {
    const c = ctx({ 's0!2!1': { v: 12, f: null, style: {} }, 's0!2!2': { v: 24, f: 'B3*2', style: { fill: '#FFF2CC' } } });
    const log = fromMutation('sheet.mutation.set-range-values', { subUnitId: 's0', cellValue: { 2: { 1: { v: 12 }, 2: { s: 'x1' } } } }, c);
    expect(log).toEqual([
      { k: 'cell', sheet: 'xl/worksheets/sheet1.xml', name: '매출', r: 2, c: 1, now: { v: 12, f: null, style: {} }, styled: false, before: undefined },
      { k: 'cell', sheet: 'xl/worksheets/sheet1.xml', name: '매출', r: 2, c: 2, now: { v: 24, f: 'B3*2', style: { fill: '#FFF2CC' } }, styled: true, before: undefined },
    ]);
  });
  it('글만 쳤는데 서식이 같이 와도 직전 서식과 같으면 서식 안 바뀜', () => {
    const c = ctx({ 's0!2!1': { v: 12, f: null, style: { numFmt: '#,##0' } } });
    const before = new Map([['s0!2!1', { v: 10, f: null, style: { numFmt: '#,##0' } }]]);
    const [e] = fromMutation('sheet.mutation.set-range-values', { subUnitId: 's0', cellValue: { 2: { 1: { v: 12, s: 'x3' } } } }, c, before);
    expect(e).toMatchObject({ styled: false, before: { v: 10 } });
  });
  it('행·열 끼우기/지우기, 병합, 너비·높이(픽셀 → 엑셀 단위)', () => {
    const c = ctx();
    const g = { startRow: 3, endRow: 4, startColumn: 1, endColumn: 2 };
    const n = { name: '매출' };
    expect(fromMutation('sheet.mutation.insert-row', { subUnitId: 's0', range: g }, c)[0]).toEqual({ k: 'op', op: { op: 'insertRows', part: 'xl/worksheets/sheet1.xml', at: 3, n: 2 }, ...n });
    expect(fromMutation('sheet.mutation.remove-col', { subUnitId: 's0', range: g }, c)[0]).toEqual({ k: 'op', op: { op: 'deleteCols', part: 'xl/worksheets/sheet1.xml', at: 1, n: 2 }, ...n });
    expect(fromMutation('sheet.mutation.add-worksheet-merge', { subUnitId: 's0', ranges: [g] }, c)[0]).toEqual({ k: 'op', op: { op: 'merge', part: 'xl/worksheets/sheet1.xml', range: 'B4:C5' }, ...n });
    expect(fromMutation('sheet.mutation.set-worksheet-col-width', { subUnitId: 's0', ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }], colWidth: 117 }, c)[0]).toEqual({ k: 'op', op: { op: 'colWidth', part: 'xl/worksheets/sheet1.xml', at: 0, n: 1, width: 16 }, ...n });
    expect(fromMutation('sheet.mutation.set-worksheet-row-height', { subUnitId: 's0', ranges: [{ startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 }], rowHeight: { 0: 40, 1: null } }, c)).toEqual([{ k: 'op', op: { op: 'rowHeight', part: 'xl/worksheets/sheet1.xml', at: 1, n: 1, height: 30 }, ...n }]);
  });
  it('새 시트는 이름으로, 이름을 바꾸면 옛 이름을 가리키고 그 뒤로는 새 이름', () => {
    const c = ctx();
    expect(fromMutation('sheet.mutation.insert-sheet', { sheet: { id: 'n1', name: '시트2' } }, c)[0]).toEqual({ k: 'op', op: { op: 'addSheet', name: '시트2' } });
    expect(fromMutation('sheet.mutation.set-worksheet-name', { subUnitId: 'n1', name: '정리' }, c)[0]).toMatchObject({ k: 'op', op: { op: 'renameSheet', part: '시트2', name: '정리' } });
    expect(fromMutation('sheet.mutation.remove-sheet', { subUnitId: 'n1' }, c)[0]).toMatchObject({ k: 'op', op: { op: 'deleteSheet', part: '정리' } });
  });
  it('저장이 못 따라가는 조작은 blocked', () => {
    const c = ctx();
    const log = [...fromMutation('sheet.mutation.move-rows', {}, c), ...fromMutation('sheet.mutation.reorder-range', {}, c), ...fromMutation('sheet.mutation.insert-sheet', { sheet: { id: 'n', name: 'x', cellData: { 0: { 0: { v: 1 } } } } }, c)];
    expect(blockedOf(log)).toEqual(['행 끌어 옮기기', '정렬', '내용 있는 시트 만들기']);
    expect(compile(log)).toEqual([]);
  });
});

describe('기록 → 저장 조작', () => {
  const cell = (r: number, c: number, v: number, styled = false, style = {}) => ({ k: 'cell' as const, sheet: 'p', name: '매출', r, c, now: { v, f: null, style }, styled });
  it('같은 칸을 여러 번 고치면 마지막만, 서식을 한 번이라도 건드렸으면 서식도', () => {
    expect(compile([cell(0, 0, 1, true, { fill: '#000000' }), cell(0, 1, 5), cell(0, 0, 2, false, { fill: '#000000' })])).toEqual([
      { op: 'cell', part: 'p', r: 0, c: 1, v: 5, f: null },
      { op: 'cell', part: 'p', r: 0, c: 0, v: 2, f: null, style: { fill: '#000000' } },
    ]);
  });
  it('행열 조작을 사이에 두면 합치지 않는다(자리가 달라서)', () => {
    const ins = { k: 'op' as const, op: { op: 'insertRows', part: 'p', at: 0, n: 1 } };
    expect(compile([cell(0, 0, 1), ins, cell(0, 0, 2)]).map((o) => o.op)).toEqual(['cell', 'insertRows', 'cell']);
  });
});

describe('칸 상태 읽기', () => {
  it('수식 = 떼고, 참거짓, 서식 id 를 풀어서', () => {
    const styles = { x1: { bl: 1, bg: { rgb: '#FFF2CC' } } };
    expect(cellState({ v: 24, f: '=B3*2', s: 'x1' }, (id) => styles[id as 'x1'], { sz: 11 })).toEqual({ v: 24, f: 'B3*2', style: { font: { b: true, sz: 11 }, fill: '#FFF2CC' } });
    expect(cellState({ v: 1, t: 3 }, () => null, {}).v).toBe(true);
    expect(cellState(null, () => null, {})).toEqual({ v: null, f: null });
  });
});

describe('수식 다시 계산 결과', () => {
  it('아는 값과 같으면 안 남기고(열 때 첫 계산), 바뀐 칸만 수식과 같이', () => {
    const c = { ...ctx(), formula: (_s: string, r: number) => (r === 2 ? 'SUM(B1:B2)' : null) };
    const known = new Map<string, unknown>([['s0!1!1', 10], ['s0!2!1', 30]]);
    const p = { unitData: { wb: { s0: { 1: { 1: { v: 10 } }, 2: { 1: { v: 35 } } } } } };
    expect(fromCalc(p, c, known)).toEqual([{ k: 'cell', sheet: 'xl/worksheets/sheet1.xml', name: '매출', r: 2, c: 1, now: { v: 35, f: 'SUM(B1:B2)' }, styled: false, calc: true }]);
    expect(fromCalc(p, c, known)).toEqual([]); // 같은 결과가 또 와도
    // 파일에 15자리로 적힌 값과 끝자리만 다른 계산 결과는 같은 값
    expect(fromCalc({ unitData: { wb: { s0: { 5: { 1: { v: 3944666.6666666665 } } } } } }, c, new Map([['s0!5!1', 3944666.66666667]]))).toEqual([]);
  });
});
