// 하위 페이지 블록 — 노션처럼 아이콘 + 제목, 누르면 그 페이지로(2026-09-30 사용자 "파랑 링크 말고 블록으로").
// md 로는 한 줄 링크 [제목](상대경로.md) 로 저장된다(파일로 남아 참모도 읽는다). 불러올 때 그런 줄을 다시 이 블록으로 바꾼다
import { invoke } from '@tauri-apps/api/core';
import { createReactBlockSpec } from '@blocknote/react';
import { createContext, useContext, useEffect, useState } from 'react';

/** 지금 문서 폴더 — 상대 경로를 풀 때 */
export const DocDirContext = createContext('');
/** 페이지 블록을 누르면(스페이스가 받아 연다) */
export const OPEN_PAGE = 'cv-open-page';
/** 어떤 페이지 제목이 바뀌면(첫 줄 # 제목) — 블록 이름을 따라 바꾼다 */
export const PAGE_TITLE = 'cv-page-title';

const absOf = (dir: string, href: string) => (href.startsWith('/') ? decodeURI(href) : decodeURI(new URL(href, `file://${encodeURI(dir)}/`).pathname));

function PageLink({ href }: { href: string }) {
  const dir = useContext(DocDirContext);
  const abs = absOf(dir, href);
  const [title, setTitle] = useState(() => decodeURI(href).split('/').pop()?.replace(/\.md$/i, '') ?? '');
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
  { type: 'page', content: 'none', propSchema: { href: { default: '' } } },
  {
    render: ({ block }) => <PageLink href={block.props.href} />,
    // md 로 내보낼 땐 한 줄 링크
    toExternalHTML: ({ block }) => <p><a href={block.props.href}>{decodeURI(block.props.href).split('/').pop()?.replace(/\.md$/i, '') ?? ''}</a></p>,
  },
);

/** 불러온 블록 중 "링크 하나뿐인 문단 → 상대 경로 .md" 를 페이지 블록으로 */
export function toPageBlocks<B extends { type: string; content?: unknown; props?: unknown; children?: B[] }>(blocks: B[]): B[] {
  return blocks.map((b) => {
    if (b.type === 'paragraph' && Array.isArray(b.content)) {
      const parts = (b.content as { type: string; href?: string; text?: string }[]).filter((c) => !(c.type === 'text' && !(c.text ?? '').trim()));
      const only = parts.length === 1 ? parts[0] : undefined;
      if (only?.type === 'link' && only.href && !/^[a-z][a-z0-9+.-]*:/i.test(only.href) && /\.md$/i.test(decodeURI(only.href))) {
        return { type: 'page', props: { href: only.href }, children: [] } as unknown as B;
      }
    }
    return b.children?.length ? { ...b, children: toPageBlocks(b.children) } : b;
  });
}
