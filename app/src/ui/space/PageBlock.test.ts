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
    expect(out[0]).toEqual({ type: 'page', props: { href: '%EC%83%88/%EC%83%88.md', label: '' }, children: [] });
    expect(out[1]!.type).toBe('paragraph');
    expect(out[2]!.type).toBe('paragraph');
  });
});

describe('toPageBlocks — 줄마다 하나씩 쓴 페이지 링크(md 에선 한 문단) 도 페이지 블록으로', () => {
  const link = (href: string) => ({ type: 'link', href, content: [{ type: 'text', text: href }] });
  it('줄바꿈으로만 나뉜 .md 링크들 → 페이지 블록 여러 개', () => {
    const out = toPageBlocks([{ type: 'paragraph', content: [link('b.md'), { type: 'text', text: '\n' }, link('c.md')] }]);
    expect(out).toEqual([
      { type: 'page', props: { href: 'b.md', label: 'b.md' }, children: [] },
      { type: 'page', props: { href: 'c.md', label: 'c.md' }, children: [] },
    ]);
  });
  it('BlockNote 가 실제로 주는 모양 — 줄바꿈이 앞 링크 글 끝에 붙고 사이는 빈칸(2026-10-04 실측)', () => {
    const real = { type: 'paragraph', content: [
      { type: 'link', href: 'b.md', content: [{ type: 'text', text: '줄 1 페이지\n' }] },
      { type: 'text', text: ' ' },
      { type: 'link', href: 'c.md', content: [{ type: 'text', text: '줄 2 페이지' }] },
    ] };
    expect(toPageBlocks([real]).map((b) => (b as { props?: { href?: string } }).props?.href)).toEqual(['b.md', 'c.md']);
  });
  it('같은 줄에 띄어 쓴 링크 둘·글이 섞인 줄은 그대로(문장 속 링크)', () => {
    const same = { type: 'paragraph', content: [link('b.md'), { type: 'text', text: ' ' }, link('c.md')] };
    const mixed = { type: 'paragraph', content: [link('b.md'), { type: 'text', text: '\n설명' }] };
    expect(toPageBlocks([same, mixed])).toEqual([same, mixed]);
  });
  it('하나라도 웹 주소·.md 아닌 링크면 그 문단은 그대로', () => {
    const p = { type: 'paragraph', content: [link('b.md'), { type: 'text', text: '\n' }, link('https://x.com')] };
    expect(toPageBlocks([p])).toEqual([p]);
  });
  it('목록 속 링크는 목록 그대로 — 쓴 사람의 목록 구조를 바꾸지 않는다', () => {
    const li = { type: 'bulletListItem', content: [link('a.md')], children: [] };
    expect(toPageBlocks([li])).toEqual([li]);
  });
});

describe('toPageBlocks — 카드는 md 에 쓰여 있던 링크 글자를 지킨다(저장할 때 파일 이름으로 바뀌었다, 2026-10-04)', () => {
  it('label = 링크 글자(줄바꿈 뗌)', () => {
    const out = toPageBlocks([{ type: 'paragraph', content: [{ type: 'link', href: '한글이름.md', content: [{ type: 'text', text: '한글\n' }] }] }]);
    expect(out).toEqual([{ type: 'page', props: { href: '한글이름.md', label: '한글' }, children: [] }]);
  });
  it('띄어쓰기·% 든 주소도 카드로(풀 수 없는 % 에 예외 없이)', () => {
    const out = toPageBlocks([
      { type: 'paragraph', content: [{ type: 'link', href: '하위 페이지.md', content: [{ type: 'text', text: '하위' }] }] },
      { type: 'paragraph', content: [{ type: 'link', href: '100% 계획.md', content: [{ type: 'text', text: '계획' }] }] },
    ]);
    expect(out.map((b) => b.type)).toEqual(['page', 'page']);
  });
});
