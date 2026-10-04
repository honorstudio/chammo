import type { BlockNoteEditor } from '@blocknote/core';

type PMNode = BlockNoteEditor['prosemirrorState']['doc'];
const CELL = new Set(['tableCell', 'tableHeader']);

/**
 * 문서 편집기 ⌘A — 노션처럼 누를 때마다 넓힌다(사용자 2026-10-02: 표 칸 안에서도, 문서 전체로도 안 먹었다).
 * 커서가 있는 칸(표 셀이면 셀, 아니면 그 블록)의 글 전체 → 이미 그만큼(이상) 골라져 있거나 칸이 비었거나 칸을 걸쳐 있으면 문서 전체('all').
 * 돌려주는 from·to 는 글 위치(TextSelection 으로 바로 쓴다)
 */
export function selectAllStep(doc: PMNode, from: number, to: number): { from: number; to: number } | 'all' {
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  let range: { from: number; to: number } | null = null;
  for (let d = $from.depth; d > 0; d--) {
    if (!CELL.has($from.node(d).type.name)) continue;
    // 셀 = [tableParagraph…] — 첫 문단 글 처음 ~ 마지막 문단 글 끝
    if ($to.depth >= d && $to.before(d) === $from.before(d)) range = { from: $from.start(d) + 1, to: $from.end(d) - 1 };
    break;
  }
  if (!range && $from.parent.isTextblock && $from.sameParent($to)) range = { from: $from.start(), to: $from.end() };
  if (!range || range.from >= range.to) return 'all';
  if (from <= range.from && to >= range.to) return 'all';
  return range;
}

/**
 * 문서 전체를 글 범위로 — 첫 블록 글 처음 ~ 마지막 블록 글 끝(TextSelection 으로 쓴다).
 * AllSelection(0 ~ 끝)이면 BlockNote 가 마우스를 움직일 때마다 "Position 0 is not within a blockContainer" 경고를
 * 초당 수백 번 찍었다(2026-10-02 개발판 실측). 첫·끝 블록이 그림처럼 글 없는 블록이면 그 블록이 빠지니 null(→ AllSelection)
 */
export function wholeText(doc: PMNode): { from: number; to: number } | null {
  let first: { pos: number; node: PMNode } | null = null;
  let last: { pos: number; node: PMNode } | null = null;
  doc.descendants((node, pos) => {
    if (!node.isTextblock && !(node.isBlock && node.isLeaf)) return true;
    if (!first) first = { pos, node };
    last = { pos, node };
    return false;
  });
  const a = first as { pos: number; node: PMNode } | null;
  const b = last as { pos: number; node: PMNode } | null;
  if (!a || !b || !a.node.isTextblock || !b.node.isTextblock) return null;
  return { from: a.pos + 1, to: b.pos + 1 + b.node.content.size };
}
