// 문서 편집기(BlockNote)가 저장할 때 마크다운 표를 통째로 다시 쓴다 — 칸 맞춤 공백이 붙고 정렬(---:)이 사라져
// 한 글자만 고쳐도 git diff 에 표 전체가 떴다(2026-10-03 QA 10번). 원래 파일의 표를 되살린다

type Table = { start: number; end: number; cells: string[]; delim: string };

const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const cellsOf = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/\s+/g, ' '));

/** 표 찾기 — 머리 줄 + 구분 줄(---) + 몸 줄. 코드 블록(```) 안은 건너뛴다 */
function tables(lines: string[]): Table[] {
  const out: Table[] = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i]!)) { fence = !fence; continue; }
    if (fence || !isRow(lines[i]!) || !DELIM.test(lines[i + 1] ?? '')) continue;
    let end = i + 2;
    while (end < lines.length && isRow(lines[end]!)) end++;
    const body = [lines[i]!, ...lines.slice(i + 2, end)];
    out.push({ start: i, end, cells: body.map((l) => cellsOf(l).join('\u0001')), delim: lines[i + 1]! });
    i = end - 1;
  }
  return out;
}

const cols = (delim: string) => cellsOf(delim).length;
const same = (a: Table, b: Table) => a.cells.length === b.cells.length && a.cells.every((c, i) => c === b.cells[i]);

/** next(편집기가 쓴 글)의 표를 original(원래 파일) 표로 — 내용이 같으면 원래 글 그대로, 고쳤으면 정렬 줄만(표 수·칸 수가 같을 때) */
export function keepTables(original: string, next: string): string {
  const oLines = original.split('\n');
  const nLines = next.split('\n');
  const o = tables(oLines);
  const n = tables(nLines);
  if (!o.length || !n.length) return next;
  const used = new Set<number>();
  const out: string[] = [];
  let at = 0;
  n.forEach((t, i) => {
    out.push(...nLines.slice(at, t.start));
    const k = o.findIndex((x, j) => !used.has(j) && same(x, t));
    if (k >= 0) {
      used.add(k);
      out.push(...oLines.slice(o[k]!.start, o[k]!.end));
    } else {
      const block = nLines.slice(t.start, t.end);
      // 고친 표 — 같은 행이 가장 많은 원래 표와 짝(고친 블록만 넘어오니 표 수로 짝지으면 상관없는 표를 잡는다)
      const overlap = (x: Table) => t.cells.filter((c) => x.cells.includes(c)).length;
      const twin = o.filter((x, j) => !used.has(j) && overlap(x) > 0).sort((a, b) => overlap(b) - overlap(a))[0]; // 겹치는 행이 없으면 새 표
      if (twin && cols(twin.delim) === cols(t.delim)) {
        block[1] = twin.delim;
        // 안 바뀐 행은 원래 줄, 바뀐 행은 원래 표가 칸 맞춤 없이 썼으면 그 모양으로(한 칸 고쳤다고 표 전체가 바뀌지 않게)
        const tLines = oLines.slice(twin.start, twin.end).filter((_, k) => k !== 1);
        const compact = tLines.every((l) => !/[^|\s]\s{2,}\||\|\s{2,}/.test(l));
        const free = tLines.map((l, k) => ({ l, key: twin.cells[k]! }));
        for (let k = 0; k < block.length; k++) {
          if (k === 1) continue;
          const key = cellsOf(block[k]!).join('\u0001');
          const hit = free.findIndex((x) => x.key === key);
          if (hit >= 0) { block[k] = free[hit]!.l; free.splice(hit, 1); }
          else if (compact) block[k] = `| ${cellsOf(block[k]!).join(' | ')} |`;
        }
      }
      out.push(...block);
    }
    at = t.end;
  });
  out.push(...nLines.slice(at));
  return out.join('\n');
}
