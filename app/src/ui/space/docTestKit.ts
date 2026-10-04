import { BlockNoteEditor } from '@blocknote/core';

// 테스트 전용 — 화면 없이 진짜 BlockNote 문서를 만들고, 글자 위치로 선택을 흉내 낸다(copyText·selectAllStep 테스트)
export type Doc = BlockNoteEditor['prosemirrorState']['doc'];

export function docOf(blocks: unknown[]): Doc {
  const ed = BlockNoteEditor.create();
  ed.replaceBlocks(ed.document, blocks as never);
  return ed.prosemirrorState.doc;
}

/** 문서에서 그 글이 시작하는 위치(끝이면 at='end') — 같은 글이 여럿이면 첫 번째 */
export function posOf(doc: Doc, text: string, at: 'start' | 'end' = 'start'): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text!.includes(text)) found = pos + node.text!.indexOf(text) + (at === 'end' ? text.length : 0);
    return true;
  });
  if (found < 0) throw new Error(`없는 글: ${text}`);
  return found;
}

/** from~to 글 선택(TextSelection 과 같은 모양) */
export function sel(doc: Doc, from: number, to: number) {
  return { $from: doc.resolve(from), $to: doc.resolve(to), content: () => doc.slice(from, to, true) }; // TextSelection.content() 처럼 부모 포함
}

/** 문서 전체 선택(AllSelection 과 같은 모양) */
export function selAll(doc: Doc) {
  return sel(doc, 0, doc.content.size);
}

export const table = (rows: string[][], headerRows?: number) => ({
  type: 'table',
  content: { type: 'tableContent', ...(headerRows ? { headerRows } : {}), rows: rows.map((cells) => ({ cells })) },
});
export const p = (...content: unknown[]) => ({ type: 'paragraph', content });
export const code = (text: string) => ({ type: 'text', text, styles: { code: true } });
export const bold = (text: string) => ({ type: 'text', text, styles: { bold: true } });
