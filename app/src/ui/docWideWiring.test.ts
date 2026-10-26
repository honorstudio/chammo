import { describe, expect, it } from 'vitest';
import space from './space/space.css?raw';
import reader from './reader/reader.css?raw';
import doc from './space/DocPage.tsx?raw';
import rd from './reader/Reader.tsx?raw';
import btn from './docWide.tsx?raw';

// 2026-10-24 사용자: md 를 열면 글이 가운데 좁게 모이고 좌우가 비었다 — 넓게/좁게 토글, 기본은 넓게.
// 넓게여도 양옆 여백(32px)과 아주 넓은 화면의 줄 길이 한도(1200px)는 둔다. 스페이스 문서(DocPage)·리더 md(MdDoc) 두 길 모두

const rule = (css: string, sel: string) => {
  const esc = sel.replace(/[.>[\]()]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|\\n|,)\\s*${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join(' ');
};

describe('넓게 — 한도 1200px, 양옆 32px', () => {
  it('스페이스 문서: .cv-doc.doc-wide .cv-doc-body', () => {
    const r = rule(space, '.cv-doc.doc-wide .cv-doc-body');
    expect(r).toMatch(/max-width:\s*1200px/);
    expect(r).toMatch(/padding-inline:\s*32px/);
  });
  it('리더 md: .rd-md.doc-wide main', () => {
    const r = rule(reader, '.rd-md.doc-wide main');
    expect(r).toMatch(/max-width:\s*1200px/);
    expect(r).toMatch(/padding-inline:\s*32px/);
  });
  it('좁게(원래 폭)는 그대로 남는다', () => {
    expect(rule(space, '.cv-doc-body')).toMatch(/max-width:\s*760px/);
    expect(rule(reader, '.rd-md main')).toMatch(/max-width:\s*820px/);
  });
});

describe('토글 단추 — 직접 그린 아이콘 + 이름', () => {
  it('넓게일 땐 좁게 아이콘, 좁게일 땐 넓게 아이콘 — aria-label·title 이 있다', () => {
    expect(btn).toMatch(/wide \? <IconWidthNarrow \/> : <IconWidthWide \/>/);
    expect(btn).toMatch(/label=\{wide \?/);
    expect(btn).toMatch(/title=\{wide \?/);
  });
  it('스페이스 문서 머리에 단추, 문서 칸에 doc-wide', () => {
    expect(doc).toMatch(/<DocWidthButton/);
    expect(doc).toMatch(/useDocWide\(\)/);
    expect(doc).toMatch(/className=\{wide \? 'cv-doc doc-wide' : 'cv-doc'\}/);
  });
  it('리더는 md 보기일 때만 단추(고치기 땐 없음), 보기(MdDoc)에 doc-wide', () => {
    expect(rd).toMatch(/kind === 'md' && !editing\[s\.active\] && <DocWidthButton/);
    expect(rd).toMatch(/rd-md \$\{wide \? 'doc-wide' : ''\}/);
  });
});
