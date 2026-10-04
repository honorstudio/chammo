// 하위 페이지 블록 — 노션처럼 아이콘 + 제목, 누르면 그 페이지로(2026-09-30 사용자 "파랑 링크 말고 블록으로").
// md 로는 한 줄 링크 [제목](상대경로.md) 로 저장된다(파일로 남아 참모도 읽는다). 불러올 때 그런 줄을 다시 이 블록으로 바꾼다
import { invoke } from '@tauri-apps/api/core';
import { createReactBlockSpec } from '@blocknote/react';
import { createContext, useContext, useEffect, useState } from 'react';
import { safeDecode } from '../../domain/mdLinks';

/** 지금 문서 폴더 — 상대 경로를 풀 때 */
export const DocDirContext = createContext('');
/** 페이지 블록을 누르면(스페이스가 받아 연다) */
export const OPEN_PAGE = 'cv-open-page';
/** 어떤 페이지 제목이 바뀌면(첫 줄 # 제목) — 블록 이름을 따라 바꾼다 */
export const PAGE_TITLE = 'cv-page-title';

const absOf = (dir: string, href: string) => (href.startsWith('/') ? safeDecode(href) : safeDecode(new URL(href, `file://${encodeURI(dir)}/`).pathname));

function PageLink({ href }: { href: string }) {
  const dir = useContext(DocDirContext);
  const abs = absOf(dir, href);
  const [title, setTitle] = useState(() => safeDecode(href).split('/').pop()?.replace(/\.md$/i, '') ?? '');
  useEffect(() => {
    let alive = true;
    void invoke<string>('read_doc_text', { path: abs }).then((md) => { const t = md.match(/^#\s+(.+)$/m)?.[1]?.trim(); if (alive && t) setTitle(t); }, () => {});
    const on = (e: Event) => { const d = (e as CustomEvent<{ path: string; title: string }>).detail; if (d?.path === abs) setTitle(d.title); };
    window.addEventListener(PAGE_TITLE, on);
    return () => { alive = false; window.removeEventListener(PAGE_TITLE, on); };
  }, [abs]);
  return (
    <div className="cv-pageblock" contentEditable={false}>
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PAGE, { detail: abs }))}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 1.8h5.2L12.5 5v9.2H4Z M9.2 1.8V5h3.3 M6 8.3h4.5 M6 10.8h3.2" /></svg>
        <span>{title || '제목 없음'}</span>
      </button>
    </div>
  );
}

export const PageBlock = createReactBlockSpec(
  // label = md 에 쓰여 있던 링크 글자 — 카드엔 그 페이지 제목을 보이지만, 저장할 땐 원래 글자를 지킨다(파일 이름으로 바뀌었다, 2026-10-04)
  { type: 'page', content: 'none', propSchema: { href: { default: '' }, label: { default: '' } } },
  {
    render: ({ block }) => <PageLink href={block.props.href} />,
    // md 로 내보낼 땐 한 줄 링크
    toExternalHTML: ({ block }) => <p><a href={block.props.href}>{block.props.label || (safeDecode(block.props.href).split('/').pop()?.replace(/\.md$/i, '') ?? '')}</a></p>,
  },
);

const isPageHref = (href?: string) => !!href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && /\.md$/i.test(safeDecode(href));

/** 불러온 블록 중 "링크만 있는 문단 → 상대 경로 .md" 를 페이지 블록으로. 줄마다 하나씩 쓴 링크(md 에선 한 문단)는 블록 여러 개로.
 *  같은 줄에 띄어 쓴 링크·글이 섞인 문단·목록 속 링크는 그대로 — 문장·목록 구조를 바꾸지 않는다 */
export function toPageBlocks<B extends { type: string; content?: unknown; props?: unknown; children?: B[] }>(blocks: B[]): B[] {
  return blocks.flatMap((b) => {
    if (b.type === 'paragraph' && Array.isArray(b.content)) {
      type Part = { type: string; href?: string; text?: string; content?: { text?: string }[] };
      const all = b.content as Part[];
      const links = all.filter((c) => c.type === 'link');
      const gaps = all.filter((c) => c.type !== 'link');
      const onlyBlank = gaps.every((c) => c.type === 'text' && !(c.text ?? '').trim());
      // 링크끼리는 줄로 나뉘어야 한다 — 줄바꿈이 사이 빈칸에 오거나 앞 링크 글 끝에 붙어 온다(BlockNote 실측). 같은 줄에 띄어 쓴 건 문장
      const endsLine = (l: Part) => /\n\s*$/.test(l.content?.map((t) => t.text ?? '').join('') ?? '');
      const lines = links.every((l, i) => {
        if (i === links.length - 1) return true;
        const gap = all.slice(all.indexOf(l) + 1, all.indexOf(links[i + 1]!));
        return endsLine(l) || gap.some((g) => (g.text ?? '').includes('\n'));
      });
      if (links.length && onlyBlank && lines && links.every((l) => isPageHref(l.href))) {
        const label = (l: Part) => (l.content ?? []).map((t) => t.text ?? '').join('').trim();
        return links.map((l) => ({ type: 'page', props: { href: l.href, label: label(l) }, children: [] }) as unknown as B);
      }
    }
    return [b.children?.length ? { ...b, children: toPageBlocks(b.children) } : b];
  });
}
