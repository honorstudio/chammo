import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { assistant, tr } from '../../i18n';
import { IconPage, IconPlus } from '../Icons';
import { dragPath } from './dragPath';

/** 페이지 앞부분 몇 줄 — 첫 줄 # 제목은 빼고 */
function useSnippet(path: string) {
  const [t, setT] = useState('');
  useEffect(() => {
    void invoke<string>('read_doc_text', { path }).then((s) => setT(s.replace(/^#\s+.*$/m, '').replace(/[#>*`_|-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)), () => {});
  }, [path]);
  return t;
}

function Card({ path, title, onOpen }: { path: string; title: string; onOpen: () => void }) {
  const snippet = useSnippet(path);
  return (
    <button className="cv-page-card" onClick={onOpen} {...dragPath(path)} title={path}>
      <span className="cv-page-ic"><IconPage /></span>
      <b>{title}</b>
      <span>{snippet || tr('(비어 있음)', '(empty)')}</span>
    </button>
  );
}

/** 내 페이지 첫 화면 — 사용자 개인 공간의 페이지들을 카드로(2026-09-30 사용자 "대시보드처럼 첫 페이지") */
export function PagesHome({ pages, titleOf, onOpen, onNew }: { pages: string[]; titleOf: (p: string) => string; onOpen: (p: string) => void; onNew: () => void }) {
  return (
    <div className="cv-dash">
      <header className="cv-page-head">
        <span className="cv-avatar lg mine"><IconPage /></span>
        <div className="cv-titles"><h1>{tr('내 페이지', 'My pages')}</h1><p>{tr(`페이지 ${pages.length} · 개인 공간(${assistant()}도 같이 씀)`, `${pages.length} pages · your space`)}</p></div>
        <button className="cv-btn solid head-act" onClick={onNew}><IconPlus />{tr('새 페이지', 'New page')}</button>
      </header>
      <section className="cv-files">
        {pages.length === 0 ? <div className="cv-blank">{tr('아직 페이지가 없어요 — "새 페이지"로 시작해', 'No pages yet — start with "New page"')}</div> : (
          <div className="cv-pages">{pages.map((p) => <Card key={p} path={p} title={titleOf(p)} onOpen={() => onOpen(p)} />)}</div>
        )}
      </section>
    </div>
  );
}
