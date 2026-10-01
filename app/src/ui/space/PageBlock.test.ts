import { describe, expect, it } from 'vitest';
import { toPageBlocks } from './PageBlock';

describe('toPageBlocks — md 의 "한 줄 링크(.md)" 를 페이지 블록으로(노션 하위 페이지)', () => {
  it('링크 하나뿐인 문단 + 상대 경로 .md 만 바꾼다', () => {
    const blocks = [
      { type: 'paragraph', content: [{ type: 'link', href: '%EC%83%88/%EC%83%88.md', content: [] }, { type: 'text', text: ' ' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '앞 글 ' }, { type: 'link', href: 'a.md', content: [] }] },
      { type: 'paragraph', content: [{ type: 'link', href: 'https://x.com/a.md', content: [] }] },
    ];
    const out = toPageBlocks(blocks);
    expect(out[0]).toEqual({ type: 'page', props: { href: '%EC%83%88/%EC%83%88.md' }, children: [] });
    expect(out[1]!.type).toBe('paragraph');
    expect(out[2]!.type).toBe('paragraph');
  });
});
