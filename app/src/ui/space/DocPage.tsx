import { invoke } from '@tauri-apps/api/core';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { BlockNoteEditor } from '@blocknote/core';
import { docTitle } from '../../domain/spaceTree';
import { tr } from '../../i18n';
import { IconChevron, IconPin } from '../Icons';
import { lastSaved, saveSoon } from './docSave';
import { setBaseline } from './pending';
import { SendFab } from './SendFab';
import { FindBar } from './FindBar';
import type { ShowAt } from '../../domain/showAt';
import { flashWhenReady } from '../flash';

// 편집기(BlockNote)는 문서를 열 때 불러온다
const SpaceEditor = lazy(() => import('./SpaceEditor'));

/**
 * 문서 페이지 — 노션처럼 바로 고친다(리더 아님, 2026-09-30 사용자). 저장은 저절로, 고친 줄은 모아 두었다가
 * 오른쪽 아래 "보낼 것"으로 참모에게. 위 줄 = 어디 문서인지(주인 / 이름) + 고정
 */
export function DocPage({ path, title, owner, pinned, onPin, send, sendTo, onTitle, onAttach, onBack, onNewSubpage, onOpenPath, at, atKey }: {
  /** 짚어 보여 줄 곳(scripts/show --line/--find) — atKey 가 바뀔 때마다 다시 반짝 */
  at?: ShowAt;
  atKey?: string;
  /** "/페이지" 하위 페이지 만들기(내 페이지) */
  onNewSubpage?: () => Promise<string>;
  /** 문서 속 링크(다른 페이지·파일)를 누르면 */
  onOpenPath?: (abs: string) => void;
  /** 뒤로(앞 화면, 없으면 주인 대시보드) */
  onBack?: () => void;
  onAttach?: () => void;
  path: string;
  owner: string;
  /** 보일 이름(페이지 첫 줄 제목) — 없으면 파일 이름 */
  title?: string;
  pinned?: boolean;
  onPin?: () => void;
  send: (text: string) => Promise<void>;
  sendTo?: string;
  /** 첫 줄 제목이 바뀌면(내 페이지 메뉴 이름) */
  onTitle?: (title: string) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setText(null); setErr('');
    void invoke<string>('read_doc_text', { path }).then(setText, (e) => setErr(String(e)));
  }, [path]);
  const editorRef = useRef<BlockNoteEditor | null>(null);
  // ⌘F 찾기 — 앱 단축키가 문서가 열려 있으면 여기로 보낸다(window.__docFind)
  const [finding, setFinding] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const w = window as unknown as { __docFind?: () => void };
    w.__docFind = () => setFinding(true);
    return () => { delete w.__docFind; };
  }, []);
  useEffect(() => (at && text != null ? flashWhenReady(() => bodyRef.current?.querySelector<HTMLElement>('.bn-editor') ?? null, at, text, false, 25) : undefined), [atKey, text == null]); // eslint-disable-line react-hooks/exhaustive-deps
  const h1 = (md: string) => md.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return (
    <div className="cv-doc">
      <div className="cv-doc-bar">
        <span className="cv-crumb">{onBack ? <button className="cv-back" onClick={onBack} title={tr('뒤로', 'Back')}><IconChevron />{owner}</button> : <span>{owner}</span>}<i>/</i><b>{title ?? docTitle(path)}</b></span>
        <span className="cv-sp" />
        {onAttach && <button className="cv-btn ghost" onClick={onAttach} title={tr('채팅 입력칸에 이 문서를 붙인다', 'Attach this document to the chat input')}>{tr('채팅에 붙이기', 'Attach to chat')}</button>}
        {onPin && (
          <button className={`cv-btn ghost ${pinned ? 'on' : ''}`} onClick={onPin} title={pinned ? tr('고정 풀기', 'Unpin') : tr('고정 — 새 세션에서도 메뉴에 남는다', 'Pin — stays in the menu for new sessions')}>
            <IconPin />{pinned ? tr('고정됨', 'Pinned') : tr('고정', 'Pin')}
          </button>
        )}
      </div>
      {finding && <FindBar root={() => bodyRef.current} onClose={() => setFinding(false)} />}
      <div className="cv-doc-scroll" onMouseDown={(e) => {
        // 글 아래 빈 곳을 누르면 노션처럼 맨 끝에 캐럿 — 마지막 줄이 비어 있지 않으면 빈 줄을 하나 더(2026-09-30 사용자)
        const t = e.target as HTMLElement;
        const ed = editorRef.current;
        if (!ed || t.closest('.bn-editor, .bn-side-menu, .bn-formatting-toolbar, button, a, input')) return;
        e.preventDefault();
        const blocks = ed.document;
        const last = blocks[blocks.length - 1];
        const empty = last && last.type === 'paragraph' && Array.isArray(last.content) && last.content.length === 0;
        if (last && !empty) ed.insertBlocks([{ type: 'paragraph' }], last, 'after');
        const end = ed.document[ed.document.length - 1];
        if (end) ed.setTextCursorPosition(end, 'end');
        ed.focus();
      }}>
        <div className="cv-doc-body" ref={bodyRef} onClickCapture={(e) => {
          // 문서 속 링크 — 다른 페이지·파일(상대 경로)이면 스페이스에서 연다, 웹 주소는 그대로
          // 파일 블록(끌어다 놓은 PDF·PPT 등)은 이름을 누르면 같은 길로 — 편집기 기본 동작은 앱 창에서 아무 일도 안 했다(2026-10-01 사용자)
          const t = e.target as HTMLElement;
          const fileUrl = t.closest('.bn-file-name-with-icon') ? t.closest<HTMLElement>('[data-content-type="file"]')?.getAttribute('data-url') : null;
          const a = t.closest('a');
          const href = fileUrl ?? a?.getAttribute('href') ?? '';
          if ((!a && !fileUrl) || !href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || !onOpenPath) return;
          e.preventDefault(); e.stopPropagation();
          const dir = path.replace(/\/[^/]*$/, '');
          const abs = href.startsWith('/') ? decodeURI(href) : new URL(href, `file://${encodeURI(dir)}/`).pathname;
          onOpenPath(decodeURI(abs));
        }}>
          {err ? <div className="cv-blank">{tr('못 읽었어', "Couldn't read it")} — {err}</div>
            : text == null ? <div className="cv-blank">{tr('여는 중', 'Opening')}</div>
            : (
              <Suspense fallback={<div className="cv-blank">{tr('편집기 여는 중', 'Opening the editor')}</div>}>
                <SpaceEditor key={path} md={text} docPath={path} onNewSubpage={onNewSubpage} onEditor={(ed) => { editorRef.current = ed; }}
                  onReady={(n) => { lastSaved.set(path, n); setBaseline(path, n); }}
                  onChange={(m) => { saveSoon(path, m); const t = h1(m); if (t) onTitle?.(t); }} />
              </Suspense>
            )}
        </div>
      </div>
      <SendFab send={send} sendTo={sendTo} />
    </div>
  );
}
