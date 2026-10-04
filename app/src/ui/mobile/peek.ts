// 시트가 살짝일 때 한 줄 — 말풍선과 같은 렌더(mdParse)에서 글자만 뽑는다. 꾸밈 기호를 따로 해석하지 않는다
import { stripMarks, type ChatItem } from '../../domain/chat';
import { toolLine } from '../../domain/mobile';
import { mdParse } from '../md';

const BLOCK = /<\/?(p|li|ul|ol|h[1-6]|blockquote|pre|tr|td|th|table|thead|tbody|hr|br)\b[^>]*>/gi;
const ENTITY: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

export const mdPlain = (text: string) =>
  mdParse(text)
    .replace(BLOCK, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITY[e]!)
    .replace(/\s+/g, ' ')
    .trim();

/** 마지막 답(없으면 마지막 말) */
export function lastLine(items: ChatItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === 'assistant' || it.kind === 'user') return mdPlain(stripMarks(it.text));
  }
  return '';
}

/** 참모 바꾸기 줄의 상태 한 줄 — 일하는 중이면 마지막 도구, 아니면 마지막 답(없으면 마지막 말) */
export function orchLine(items: ChatItem[], state: string): string {
  if (state === 'working') {
    const tail = items[items.length - 1];
    const t = tail?.kind === 'tools' ? tail.tools[tail.tools.length - 1] : undefined;
    return t ? `일하는 중 · ${toolLine(t)}` : '일하는 중';
  }
  return lastLine(items);
}
