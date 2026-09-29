import { invoke } from '@tauri-apps/api/core';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useEffect, useRef, useState } from 'react';
import { docUrl, dropIndex, inStrip, kindOf, titleOf, type Surface } from '../../domain/reader';
import { assistant, tr } from '../../i18n';
import { getAppEnv, projectScan } from '../../data/tauri';
import { cleanPathText, pathCandidates, projectOrder } from '../../domain/links';
import { followLink } from '../followLink';

let envP: Promise<{ home: string; devRoot: string; projects: string[] }> | null = null;
/** 홈·프로젝트 폴더·프로젝트 이름들 — 한 번 읽어 둔다 */
const env = () => (envP ??= getAppEnv().then(
  async (e) => ({ home: e.home, devRoot: e.devRoot, projects: (await projectScan(e.devRoot).catch(() => [])).map((p) => p.name) }),
  () => ({ home: '', devRoot: '', projects: [] }),
));

/** 두 칸 사이(공백)까지를 한 덩어리로 — ⌘클릭한 자리의 경로 글자 */
function wordAt(doc: Document, x: number, y: number): string {
  const r = doc.caretRangeFromPoint?.(x, y);
  const node = r?.startContainer;
  if (!r || !node || node.nodeType !== Node.TEXT_NODE) return '';
  const t = node.textContent ?? '';
  let a = r.startOffset, b = r.startOffset;
  while (a > 0 && !/\s/.test(t[a - 1]!)) a--;
  while (b < t.length && !/\s/.test(t[b]!)) b++;
  return t.slice(a, b);
}

/**
 * 마크다운 문서 안의 클릭 — 링크: 웹은 기본 브라우저, 문서는 리더, 나머지는 기본 앱. ⌘클릭한 경로 글자는
 * 문서 폴더부터 위로 올라가며 찾아 연다(사용자 2026-09-28: 리더에서 링크·경로 ⌘클릭이 안 됐다)
 */
function onDocClick(ev: React.MouseEvent<HTMLElement>, path: string) {
  const dir = path.replace(/\/[^/]*$/, '');
  const target = ev.target as Element | null;
  const a = target?.closest?.('a[href]');
  if (a) {
    const href = a.getAttribute('href') ?? '';
    ev.preventDefault();
    if (href.startsWith('#')) { document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView(); return; }
    let url: URL;
    try { url = new URL(href, docUrl(dir + '/')); } catch { return; }
    if (url.protocol === 'http:' || url.protocol === 'https:') followLink({ kind: 'url', target: url.href });
    else if (url.protocol === 'hodoc:') followLink({ kind: 'file', target: decodeURIComponent(url.pathname) });
    return;
  }
  if (!ev.metaKey) return;
  const text = target?.closest?.('code')?.textContent ?? wordAt(document, ev.clientX, ev.clientY);
  // 같은 문단에 나온 프로젝트 이름 — 경로가 다른 프로젝트 기준일 때 그 프로젝트부터 본다
  const context = target?.closest?.('p, li, td, blockquote, h1, h2, h3, h4')?.textContent ?? '';
  void env().then(async (e) => {
    const rel = cleanPathText(text);
    // 문서 폴더부터 위로 → 그래도 없으면 프로젝트 폴더 안 프로젝트들(같은 문단에 나온 것 먼저)
    const cands = pathCandidates(text, dir, e.home);
    if (rel && !rel.startsWith('/') && !rel.startsWith('~') && e.devRoot) cands.push(...projectOrder(e.projects, context).map((p) => `${e.devRoot}/${p}/${rel}`));
    if (!cands.length) return;
    const f = await invoke<string | null>('first_existing', { paths: cands });
    if (f) followLink({ kind: 'file', target: f });
  });
}

/**
 * 마크다운 → 정리(DOMPurify: 스크립트·on* 속성·javascript: 링크 제거) → 앱 화면에 바로 그린다.
 * 예전엔 스크립트를 끈 프레임에 넣었는데, 그러면 링크 클릭을 받을 수 없었다(WebKit 은 스크립트 꺼진 문서에서 부모가 단 클릭 처리도 안 돌린다)
 */
export function MdDoc({ path, md }: { path: string; md: string }) {
  const dir = path.replace(/\/[^/]*$/, '');
  const html = DOMPurify.sanitize(marked.parse(md, { async: false }) as string, { FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form'] });
  // 그림의 상대 경로는 문서 폴더 기준 hodoc:// 로(리더가 홈 안 파일만 내준다)
  const withImgs = html.replace(/(<img\b[^>]*\bsrc=")(?![a-z][a-z0-9+.-]*:|\/\/)([^"]+)"/gi, (_m, pre: string, src: string) => `${pre}${new URL(src, docUrl(dir + '/')).href}"`);
  // ⌘ 를 누르고 있는 동안 경로(코드 글자)에 밑줄·손가락 — 누를 수 있다는 표시(터미널과 같게, 사용자 2026-09-28)
  const [cmd, setCmd] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => setCmd(e.metaKey);
    const off = () => setCmd(false);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('blur', off);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', off); };
  }, []);
  return <div className={`rd-md ${cmd ? 'cmd' : ''}`} onMouseMove={(e) => { if (e.metaKey !== cmd) setCmd(e.metaKey); }} onClick={(e) => onDocClick(e, path)}><main dangerouslySetInnerHTML={{ __html: withImgs }} /></div>;
}

function Doc({ path, nonce }: { path: string; nonce: number }) {
  const kind = kindOf(path);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setText(null); setErr(null);
    if (kind === 'md' || kind === 'text') invoke<string>('read_doc_text', { path }).then(setText, (e) => setErr(String(e)));
  }, [path, kind, nonce]);
  if (err) return <div className="rd-empty">{tr('못 읽었어', "Couldn't read it")} — {err}</div>;
  // HTML 시안: 스크립트·저장소는 되지만 앱 기능(invoke)엔 못 닿는 다른 출처(hodoc://)에서 돈다(2026-09-28 실측)
  if (kind === 'html') return <iframe key={nonce} className="rd-frame" src={docUrl(path)} sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads" />;
  if (kind === 'pdf') return <iframe key={nonce} className="rd-frame" src={docUrl(path)} />;
  if (kind === 'image') return <div className="rd-image"><img key={nonce} src={docUrl(path)} alt={titleOf(path)} /></div>;
  if (kind === 'video') return <div className="rd-video"><video key={nonce} src={docUrl(path)} controls playsInline /></div>;
  if (text == null) return <div className="rd-empty">{tr('읽는 중', 'Reading')}</div>;
  if (kind === 'md') return <MdDoc key={nonce} path={path} md={text} />;
  return <pre className="rd-text">{text}</pre>;
}

type Ghost = { path: string; x: number; y: number; index: number | null };

/**
 * 탭 줄 — 크롬처럼 끌어서 순서 바꾸기, 줄 밖에 놓으면 Rust 가 판단(리더 패널·다른 리더 창으로 옮기거나, 빈 데면 새 창).
 * 포인터를 잡고 있으니 창 밖으로 나가도 놓는 순간을 받는다
 */
function TabStrip({ surface, s }: { surface: string; s: Surface }) {
  const strip = useRef<HTMLDivElement>(null);
  const drag = useRef<{ path: string; x0: number; y0: number; on: boolean } | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const measure = (x: number, y: number) => {
    const el = strip.current!;
    const inside = inStrip(el.getBoundingClientRect(), x, y);
    const rects = [...el.querySelectorAll<HTMLElement>('.rd-tab')].map((t) => { const r = t.getBoundingClientRect(); return [r.left, r.right] as [number, number]; });
    return { inside, index: dropIndex(rects, x) };
  };
  return (
    <div className="rd-tabs" ref={strip} onWheel={(e) => {
      // 마우스 휠(세로)로도 탭 줄을 옆으로 — 스크롤 막대를 숨겼으니
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
    }}>
      {s.tabs.map((p, i) => (
        <div key={p} className={`rd-tab ${p === s.active ? 'on' : ''} ${ghost?.path === p ? 'lifted' : ''} ${ghost?.index === i ? 'drop-before' : ''}`} title={p}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
            drag.current = { path: p, x0: e.clientX, y0: e.clientY, on: false };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || (!d.on && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5)) return;
            d.on = true;
            const m = measure(e.clientX, e.clientY);
            setGhost({ path: d.path, x: e.clientX, y: e.clientY, index: m.inside ? m.index : null });
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            setGhost(null);
            if (!d) return;
            if (!d.on) { void invoke('reader_activate', { surface, path: d.path }); return; }
            const m = measure(e.clientX, e.clientY);
            if (m.inside) void invoke('reader_move', { surface, path: d.path, index: m.index });
            else void invoke('reader_drop', { from: surface, path: d.path }); // 놓은 자리는 Rust 가 마우스에서 직접 읽는다
          }}
          onPointerCancel={() => { drag.current = null; setGhost(null); }}>
          <span>{titleOf(p)}</span>
          <button aria-label={tr('탭 닫기', 'Close tab')} onPointerDown={(e) => e.stopPropagation()} onClick={() => void invoke('reader_close', { surface, path: p })}>✕</button>
        </div>
      ))}
      <div className={`rd-tabs-end ${ghost?.index === s.tabs.length ? 'drop-before' : ''}`} />
      {ghost && (
        <div className={`rd-ghost ${ghost.index === null ? 'out' : ''}`} style={{ left: ghost.x, top: ghost.y }}>
          {titleOf(ghost.path)}
          {ghost.index === null && <small>{tr('놓으면 새 창 · 리더 패널 위면 패널로', 'Drop for a new window · over the reader panel to dock')}</small>}
        </div>
      )}
    </div>
  );
}

/** 리더 한 면 — 탭 줄 + 도구 줄 + 문서. surface = 'dock'(메인 창 리더 패널) 또는 떼어 낸 창 이름 */
/** actions = 탭 줄 오른쪽 끝(리더 패널: 크게·작게·닫기) */
export function ReaderView({ surface, actions }: { surface: string; actions?: React.ReactNode }) {
  const [s, setS] = useState<Surface>({ tabs: [], active: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const pull = () => void invoke<Surface>('reader_state', { surface }).then(setS, () => {});
    (window as unknown as { __reader?: () => void }).__reader = pull;
    pull();
  }, [surface]);
  useEffect(() => { if (surface !== 'dock') document.title = s.active ? tr(`리더 — ${titleOf(s.active)}`, `Reader — ${titleOf(s.active)}`) : tr('리더', 'Reader'); }, [surface, s.active]);

  return (
    <div className="rd">
      <div className="rd-head">
        <TabStrip surface={surface} s={s} />
        {actions && <div className="rd-actions">{actions}</div>}
      </div>
      {s.active && (
        <div className="rd-bar">
          <span className="rd-path"><bdi>{s.active}</bdi></span>
          <button onClick={() => setNonce((n) => n + 1)}>{tr('다시 읽기', 'Reload')}</button>
          <button onClick={() => void invoke('open_target', { kind: 'file', target: s.active })}>{tr('기본 앱으로 열기', 'Open in default app')}</button>
        </div>
      )}
      <div className="rd-body">
        {s.active ? <Doc path={s.active} nonce={nonce} /> : <div className="rd-empty">{tr(`파일을 여기에 끌어다 놓거나, ${assistant()}한테 "띄워줘"라고 해 — HTML 시안·PDF·마크다운·그림·영상`, `Drop a file here, or ask ${assistant()} to show one — HTML designs, PDFs, Markdown, images, videos`)}</div>}
      </div>
    </div>
  );
}

/** 떼어 낸 리더 창 — 주소 ?s=reader-N. 메뉴 키(⌘W·Ctrl+Tab)는 Rust 가 window.__readerKey 로 준다 */
export function ReaderWindow() {
  const surface = new URLSearchParams(location.search).get('s') ?? 'dock';
  useEffect(() => {
    (window as unknown as { __readerKey?: (id: string) => void }).__readerKey = (id) => {
      if (id === 'reader_next' || id === 'reader_prev') void invoke('reader_cycle', { surface, dir: id === 'reader_next' ? 1 : -1 });
      else void invoke<Surface>('reader_state', { surface }).then((st) => st.active && invoke('reader_close', { surface, path: st.active }));
    };
  }, [surface]);
  return <ReaderView surface={surface} />;
}
