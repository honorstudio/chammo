import type { BlockNoteEditor } from '@blocknote/core';

// 문서 복사의 text/plain — BlockNote 는 여기에 마크다운(| --- |·백틱·**)을 넣는다(copyExtension). 카톡·메모에 붙이면
// 그 기호가 그대로 보여서 사람이 읽는 글로 바꾼다(사용자 2026-10-02). text/html 은 BlockNote 것 그대로(서식 붙여넣기용)
type State = BlockNoteEditor['prosemirrorState'];
type PMNode = State['doc'];
type Fragment = PMNode['content'];
type Pos = PMNode extends { resolve(p: number): infer R } ? R : never;
type Slice = ReturnType<PMNode['slice']>;
/** ProseMirror Selection 중 쓰는 것만 — TextSelection·CellSelection·AllSelection 다 된다 */
export type CopySelection = { $from: Pos; $to: Pos; content(): Slice };

const oneLine = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim();

/** 표 → 한 행 = 한 줄, 칸 사이 탭(카톡·메모·스프레드시트 다 자연스럽다). 머리 줄이 비어 있으면 뺀다 */
export function rowsText(rows: string[][]): string {
  const cells = rows.map((r) => r.map(oneLine));
  if (cells.length && cells[0]!.every((c) => c === '')) cells.shift();
  return cells.map((r) => r.join('\t')).join('\n');
}

/** 글 줄 — 서식(코드·굵게) 표시는 없이 글만. 링크는 글 뒤에 (주소), 글이 곧 주소면 한 번만(links=false 면 글만). 줄바꿈 노드는 \n */
function inlineText(block: PMNode, links = true): string {
  let out = '';
  let run = '';
  let href: string | null = null;
  const flush = () => {
    out += links && href && run.trim() !== href ? `${run} (${href})` : run;
    run = '';
  };
  block.forEach((n) => {
    const h = (n.marks.find((m) => m.type.name === 'link')?.attrs.href as string | undefined) ?? null;
    if (h !== href) { flush(); href = h; }
    run += n.isText ? n.text! : n.type.name === 'hardBreak' ? '\n' : n.textContent;
  });
  flush();
  return out;
}

const CELL = new Set(['tableCell', 'tableHeader']);
const rowCells = (row: PMNode) => {
  const cells: string[] = [];
  row.forEach((cell) => {
    if (!CELL.has(cell.type.name)) return;
    const parts: string[] = [];
    cell.forEach((b) => parts.push(b.isTextblock ? inlineText(b) : b.textContent));
    cells.push(parts.join(' '));
  });
  return cells;
};

/** 블록들을 줄로 — 목록 기호는 사람 글(- · 1. · [x]), 하위 블록은 두 칸 들여쓰기, 표는 rowsText */
function blockLines(frag: Fragment, indent: string, out: string[]) {
  let num = 0;
  const rows: string[][] = [];
  const flushRows = () => { if (rows.length) { const t = rowsText(rows.splice(0)); if (t) out.push(...t.split('\n').map((l) => indent + l)); } };
  frag.forEach((node) => {
    const name = node.type.name;
    if (name === 'tableRow') { rows.push(rowCells(node)); return; } // 셀 여러 개를 고른 조각은 표 없이 행부터 온다
    flushRows();
    if (name === 'blockGroup') { blockLines(node.content, indent, out); return; }
    if (name === 'blockContainer') {
      // blockContainer = [블록 내용, (하위 blockGroup)]
      node.forEach((child) => {
        if (child.type.name === 'blockGroup') { blockLines(child.content, indent + '  ', out); return; }
        const kind = child.type.name;
        if (kind === 'numberedListItem') num = num ? num + 1 : Number(child.attrs.start) || 1;
        else num = 0;
        if (kind === 'table') { blockLines(child.content, indent, out); return; }
        if (!child.isTextblock) return; // 그림·파일 같은 글 없는 블록
        const prefix = kind === 'bulletListItem' ? '- ' : kind === 'numberedListItem' ? `${num}. ` : kind === 'checkListItem' ? (child.attrs.checked ? '[x] ' : '[ ] ') : '';
        const text = inlineText(child);
        out.push(...(prefix + text).split('\n').map((l) => indent + l));
      });
      return;
    }
    if (name === 'table') { blockLines(node.content, indent, out); return; }
    if (node.isTextblock) out.push(...inlineText(node).split('\n').map((l) => indent + l));
    else if (node.childCount) blockLines(node.content, indent, out);
  });
  flushRows();
}

/** 고른 조각 → 사람 글. 한 줄(한 블록·한 셀) 안 일부만 골랐으면 고른 글만 */
export function copyText(sel: CopySelection): string {
  const { $from, $to } = sel;
  if ($from.sameParent($to) && $from.parent.isTextblock) return inlineText($from.parent.cut($from.parentOffset, $to.parentOffset), false);
  const out: string[] = [];
  blockLines(sel.content().content, '', out);
  while (out.length && out[out.length - 1]!.trim() === '') out.pop();
  while (out.length && out[0]!.trim() === '') out.shift();
  return out.join('\n');
}
