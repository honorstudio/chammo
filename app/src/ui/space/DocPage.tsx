import { invoke } from '@tauri-apps/api/core';
import { lazy, Suspense, useContext, useEffect, useRef, useState } from 'react';
import { SpaceShown } from './docKeep';
import type { BlockNoteEditor } from '@blocknote/core';
import { docTitle } from '../../domain/spaceTree';
import { isPlainDoc } from '../../domain/reader';
import { safeDecode } from '../../domain/mdLinks';
import { tr } from '../../i18n';
import { IconChevron, IconPin } from '../Icons';
import { SendToOrch, type OrchTo } from './SendToOrch';
import { IconButton } from '../kit/IconButton';
import { lastSaved } from './docSave';
import { setBaseline } from './pending';
import { SendFab } from './SendFab';
import { FindBar } from './FindBar';
import type { ShowAt } from '../../domain/showAt';
import { flashWhenReady } from '../flash';
import { DocWidthButton, useDocWide } from '../docWide';

// 편집기(BlockNote)는 문서를 열 때 불러온다
const SpaceEditor = lazy(() => import('./SpaceEditor'));
// 글 파일(.txt)은 블록 없이 글 그대로 — 편집기(BlockNote)를 불러오지 않는다
const TextEditor = lazy(() => import('./TextEditor'));

/**
 * 문서 페이지 — 노션처럼 바로 고친다(리더 아님, 2026-09-30 사용자). 저장은 저절로, 고친 줄은 모아 두었다가
 * 오른쪽 아래 "보낼 것"으로 참모에게. 위 줄 = 어디 문서인지(주인 / 이름) + 고정
 */
export function DocPage({ lead, tail, where, attachTo, path, title, owner, pinned, onPin, send, sendTo, onTitle, onAttach, onBack, onNewSubpage, onOpenPath, at, atKey, zoom = 100 }: {
  /** 탭 확대 배율(%) — 파일마다 기억(domain/tabZoom). 글 칸 전체가 CSS zoom 으로 커진다 */
  zoom?: number;
  /** 짚어 보여 줄 곳(scripts/show --line/--find) — atKey 가 바뀔 때마다 다시 반짝 */
  at?: ShowAt;
  atKey?: string;
  /** "/페이지" 하위 페이지 만들기(내 페이지) */
  onNewSubpage?: () => Promise<string>;
  /** 문서 속 링크(다른 페이지·파일)를 누르면 */
  onOpenPath?: (abs: string) => void;
  /** 뒤로(앞 화면, 없으면 주인 대시보드) */
  onBack?: () => void;
  /** 머리줄 맨 앞(채팅 뷰 스페이스 ↔ 사무실 두 칸) */
  lead?: React.ReactNode;
  /** 머리줄 맨 끝(사무실 위 창의 크게·닫기) */
  tail?: React.ReactNode;
  /** 보관함 탭으로 열었으면 — 뒤로 알약·이름 대신 작은 경로 한 줄(domain/lockerTabs pathLine) */
  where?: string;
  /** e = 누른 단추(팀 모드에선 그 자리에 참모 고르기) */
  onAttach?: (e?: React.MouseEvent<HTMLElement>) => void;
  /** 붙일 참모(이름·색) — 보내기 단추 색 */
  attachTo?: OrchTo | null;
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
  const plain = isPlainDoc(path);
  // ⌘F 는 보이는 문서로 — 살려 둔(숨은) 문서가 가로채지 않게(ui/space/docKeep)
  const shown = useContext(SpaceShown);
  useEffect(() => {
    if (plain || !shown) return; // 찾기 띠는 편집기 글을 훑는다 — 글 칸(textarea)은 못 훑으니 앱 기본 찾기에 맡긴다
    const w = window as unknown as { __docFind?: () => void };
    const mine = () => setFinding(true);
    w.__docFind = mine;
    return () => { if (w.__docFind === mine) delete w.__docFind; };
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => (at && text != null && !plain ? flashWhenReady(() => bodyRef.current?.querySelector<HTMLElement>('.bn-editor') ?? null, at, text, false, 25) : undefined), [atKey, text == null]); // eslint-disable-line react-hooks/exhaustive-deps
  const wide = useDocWide();
  const h1 = (md: string) => md.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return (
    <div className={wide ? 'cv-doc doc-wide' : 'cv-doc'}>
      <div className="cv-doc-bar">
        {lead}
        {where !== undefined ? <span className="cv-path" title={path}>{where}</span> /* 탭으로 연 것 — 이름은 탭에, 머리엔 어느 폴더인지만(2026-10-11 사용자) */
          : <span className="cv-crumb">{onBack ? <button className="cv-back" onClick={onBack} title={owner}><IconChevron />{owner}</button> : <span>{owner}</span>}<i>/</i><b>{title ?? docTitle(path)}</b></span>}
        <span className="cv-sp" />
        <DocWidthButton />
        {onAttach && <SendToOrch to={attachTo} onClick={onAttach} />}
        {onPin && (
          <IconButton pressed={!!pinned} label={pinned ? tr('고정됨', 'Pinned') : tr('고정', 'Pin')} title={pinned ? tr('고정됨 — 누르면 풀기', 'Pinned — click to unpin') : tr('고정 — 새 세션에서도 메뉴에 남는다', 'Pin — stays in the menu for new sessions')} onClick={onPin}><IconPin /></IconButton>
        )}
        {tail}
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
        <div className="cv-doc-body" ref={bodyRef} style={zoom === 100 ? undefined : { zoom: zoom / 100 }} onClickCapture={(e) => {
          // 문서 속 링크 — 다른 페이지·파일(상대 경로)이면 스페이스에서 연다, 웹 주소는 그대로
          // 파일 블록(끌어다 놓은 PDF·PPT 등)은 이름을 누르면 같은 길로 — 편집기 기본 동작은 앱 창에서 아무 일도 안 했다(2026-10-01 사용자)
          const t = e.target as HTMLElement;
          const fileUrl = t.closest('.bn-file-name-with-icon') ? t.closest<HTMLElement>('[data-content-type="file"]')?.getAttribute('data-url') : null;
          const a = t.closest('a');
          const href = fileUrl ?? a?.getAttribute('href') ?? '';
          if ((!a && !fileUrl) || !href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || !onOpenPath) return;
          e.preventDefault(); e.stopPropagation();
          const dir = path.replace(/\/[^/]*$/, '');
          const abs = href.startsWith('/') ? safeDecode(href) : new URL(href, `file://${encodeURI(dir)}/`).pathname;
          onOpenPath(safeDecode(abs));
        }}>
          {err ? <div className="cv-blank">{tr('못 읽었어', "Couldn't read it")} — {err}</div>
            : text == null ? <div className="cv-blank">{tr('여는 중', 'Opening')}</div>
            : (
              <Suspense fallback={<div className="cv-blank">{tr('편집기 여는 중', 'Opening the editor')}</div>}>
                {plain ? <TextEditor key={path} path={path} text={text} /> : <SpaceEditor key={path} md={text} docPath={path} onNewSubpage={onNewSubpage} onEditor={(ed) => { editorRef.current = ed; }}
                  onReady={(n) => { lastSaved.set(path, n); setBaseline(path, n); }}
                  onChange={(m) => { const t = h1(m); if (t) onTitle?.(t); }} />}
              </Suspense>
            )}
        </div>
      </div>
      <SendFab send={send} sendTo={sendTo} path={path} />
    </div>
  );
}
