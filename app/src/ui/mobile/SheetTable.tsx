// 폰 엑셀 표 — 읽기만(맥 스페이스에서 고친다). 시트 탭 + 칸 주소(열 글자·행 번호)가 붙은 표
import { useMemo, useState } from 'react';
import { colName, type SheetBook, type SheetData } from '../../domain/sheetBook';
import { phoneGrid } from '../../domain/sheetPhone';
import { machine, tr } from '../../i18n';

type Book = SheetBook & { sheets: (SheetData & { cut?: number })[] };

export function SheetTable({ book }: { book: Book }) {
  const visible = book.sheets.map((s, i) => ({ s, i })).filter((x) => !x.s.hidden);
  const [at, setAt] = useState(visible[0]?.i ?? 0);
  const sheet = book.sheets[at];
  const grid = useMemo(() => (sheet ? phoneGrid(sheet, book.styles.cell) : null), [sheet, book]);
  if (!sheet || !grid) return <p className="m-muted">{tr('빈 통합 문서예요', 'This workbook is empty')}</p>;
  return (
    <div className="m-xlsx">
      {visible.length > 1 && (
        <div className="m-xlsx-tabs" role="tablist">
          {visible.map(({ s, i }) => <button key={s.part} type="button" role="tab" aria-selected={i === at} className={i === at ? 'on' : undefined} onClick={() => setAt(i)}>{s.name}</button>)}
        </div>
      )}
      {grid.rows.length ? (
        <div className="m-xlsx-scroll">
          <table className="m-xlsx-table">
            <colgroup><col style={{ width: 36 }} />{grid.widths.map((w, c) => <col key={c} style={{ width: w }} />)}</colgroup>
            <thead><tr><th />{grid.widths.map((w, c) => (w ? <th key={c} scope="col">{colName(c)}</th> : null))}</tr></thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row.r} style={row.h ? { height: row.h } : undefined}>
                  <th scope="row">{row.r + 1}</th>
                  {row.cells.map((x) => <td key={x.c} rowSpan={x.rowSpan} colSpan={x.colSpan} className={x.num ? 'num' : undefined} style={x.css}>{x.text}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="m-muted">{tr('빈 시트예요', 'This sheet is empty')}</p>}
      {(sheet.cut ?? 0) > 0 && <p className="m-muted m-sm">{tr(`앞 2,000행만 보여 줘요 — 나머지 ${sheet.cut!.toLocaleString('ko-KR')}행은 ${machine()}에서`, `Showing the first 2,000 rows — the other ${sheet.cut!.toLocaleString('en-US')} rows are on your ${machine()}`)}</p>}
      {sheet.charts > 0 && <p className="m-muted m-sm">{tr(`차트 ${sheet.charts}개는 ${machine()}에서 봐요`, `View the ${sheet.charts} chart(s) on your ${machine()}`)}</p>}
    </div>
  );
}
