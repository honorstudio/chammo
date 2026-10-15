/**
 * 폰 읽기 전용 엑셀 표 — 시트 하나를 화면 표 모양으로(병합은 rowSpan·colSpan, 덮인 칸은 뺀다). 화면 라이브러리 없이 <table> 로 그린다
 */
import { colPx, range, rowPx, type SheetData, type SheetStyle } from './sheetBook';
import { formatCell } from './sheetFormat';

export interface PhoneCell { c: number; text: string; css: Record<string, string>; rowSpan?: number; colSpan?: number; num?: boolean }
export interface PhoneRow { r: number; h?: number; cells: PhoneCell[] }
export interface PhoneGrid { widths: number[]; rows: PhoneRow[] }

const H: Record<string, string> = { left: 'left', center: 'center', right: 'right', justify: 'justify', distributed: 'center', centerContinuous: 'center', fill: 'left' };

function css(s: SheetStyle | undefined): Record<string, string> {
  const o: Record<string, string> = {};
  if (!s) return o;
  if (s.font?.b) o.fontWeight = '700';
  if (s.font?.i) o.fontStyle = 'italic';
  if (s.font?.u || s.font?.strike) o.textDecoration = [s.font?.u && 'underline', s.font?.strike && 'line-through'].filter(Boolean).join(' ');
  if (s.font?.color) o.color = s.font.color;
  if (s.fill) o.background = s.fill;
  if (s.align?.h && H[s.align.h]) o.textAlign = H[s.align.h]!;
  if (s.align?.wrap) o.whiteSpace = 'normal';
  return o;
}

/** 시트 → 폰 표. 빈 시트면 줄 없음 */
export function phoneGrid(sheet: SheetData, styles: SheetStyle[]): PhoneGrid {
  const cells = new Map(sheet.cells.map((x) => [`${x.r}!${x.c}`, x]));
  const maxR = Math.max(-1, ...sheet.cells.map((x) => x.r));
  const maxC = Math.max(-1, ...sheet.cells.map((x) => x.c));
  const merges = sheet.merges.map(range).filter((g): g is NonNullable<typeof g> => !!g);
  const lastR = Math.max(maxR, ...merges.map((g) => g.endRow));
  const lastC = Math.max(maxC, ...merges.map((g) => g.endColumn));
  const width = (c: number) => { const col = sheet.cols.find((x) => x.min <= c && c <= x.max); return col?.hidden ? 0 : colPx(col?.width ?? sheet.defaultColWidth ?? 8.43); };
  const hiddenRow = new Set(sheet.rows.filter((x) => x.hidden).map((x) => x.r));
  const height = new Map(sheet.rows.filter((x) => x.ht).map((x) => [x.r, rowPx(x.ht!)]));
  const covered = new Set<string>();
  const top = new Map<string, { rowSpan: number; colSpan: number }>();
  for (const g of merges) {
    top.set(`${g.startRow}!${g.startColumn}`, { rowSpan: g.endRow - g.startRow + 1, colSpan: g.endColumn - g.startColumn + 1 });
    for (let r = g.startRow; r <= g.endRow; r++) for (let c = g.startColumn; c <= g.endColumn; c++) if (r !== g.startRow || c !== g.startColumn) covered.add(`${r}!${c}`);
  }
  const widths = Array.from({ length: lastC + 1 }, (_, c) => width(c));
  const rows: PhoneRow[] = [];
  for (let r = 0; r <= lastR; r++) {
    if (hiddenRow.has(r)) continue;
    const out: PhoneCell[] = [];
    for (let c = 0; c <= lastC; c++) {
      const k = `${r}!${c}`;
      if (covered.has(k) || widths[c] === 0) continue;
      const x = cells.get(k);
      const st = x?.s ? styles[x.s] : undefined;
      const num = typeof x?.v === 'number';
      const cell: PhoneCell = { c, text: formatCell(x?.v, st?.numFmt), css: css(st), ...(num ? { num } : {}) };
      const span = top.get(k);
      if (span) Object.assign(cell, span.rowSpan > 1 ? { rowSpan: span.rowSpan } : {}, span.colSpan > 1 ? { colSpan: span.colSpan } : {});
      out.push(cell);
    }
    rows.push({ r, ...(height.has(r) ? { h: height.get(r) } : {}), cells: out });
  }
  return { widths, rows };
}
