import { invoke } from '@tauri-apps/api/core';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { modKey } from '../../domain/keys';
import { docUrl, IS_WIN, isDocUrl, dropIndex, inStrip, kindOf, titleOf, type DocKind, type Surface } from '../../domain/reader';
import { FIT, IMAGE_STEPS, parseZoom, stepZoom, withZoom, zoomable, zoomLabel, zoomOf, type ZoomMap } from '../../domain/readerZoom';
import { IconZoomIn, IconZoomOut } from '../Icons';
import { selectAllHere } from '../selectAll';
import { assistant, tr } from '../../i18n';
import { getAppEnv, projectScan } from '../../data/tauri';
import { cleanPathText, pathCandidates, projectOrder } from '../../domain/links';
import { followLink } from '../followLink';
import { addComment, setBaseline } from '../space/pending';
import { SendFab } from '../space/SendFab';
import { lastSaved, saveSoon } from '../space/docSave';
import type { BlockNoteEditor } from '@blocknote/core';

// 스페이스 편집기(BlockNote)는 고칠 때만 불러온다 — 보기만 할 땐 무게를 안 싣는다
const SpaceEditor = lazy(() => import('../space/SpaceEditor'));

/** 열린 편집기(문서마다) — "이 줄에 코멘트"가 커서 있는 줄을 읽는다 */
const editors = new Map<string, BlockNoteEditor>();
const blockText = (content: unknown): string =>
  Array.isArray(content) ? content.map((c: { text?: string; content?: unknown }) => c.text ?? blockText(c.content)).join('') : '';
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
    else if (isDocUrl(url)) followLink({ kind: 'file', target: decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, '$1') });
    return;
  }
  if (!modKey(ev, IS_WIN)) return;
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
export function MdDoc({ path, md, zoom = 100 }: { path: string; md: string; zoom?: number }) {
  const dir = path.replace(/\/[^/]*$/, '');
  const html = DOMPurify.sanitize(marked.parse(md, { async: false }) as string, { FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form'] });
  // 그림의 상대 경로는 문서 폴더 기준 hodoc:// 로(리더가 홈 안 파일만 내준다)
  const withImgs = html.replace(/(<img\b[^>]*\bsrc=")(?![a-z][a-z0-9+.-]*:|\/\/)([^"]+)"/gi, (_m, pre: string, src: string) => `${pre}${new URL(src, docUrl(dir + '/')).href}"`);
  // ⌘ 를 누르고 있는 동안 경로(코드 글자)에 밑줄·손가락 — 누를 수 있다는 표시(터미널과 같게, 사용자 2026-09-28)
  const [cmd, setCmd] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => setCmd(modKey(e, IS_WIN));
    const off = () => setCmd(false);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('blur', off);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', off); };
  }, []);
  return <div className={`rd-md ${cmd ? 'cmd' : ''}`} onMouseMove={(e) => { if (modKey(e, IS_WIN) !== cmd) setCmd(modKey(e, IS_WIN)); }} onClick={(e) => onDocClick(e, path)}><main style={zoom === 100 ? undefined : { zoom: zoom / 100 }} dangerouslySetInnerHTML={{ __html: withImgs }} /></div>;
}

/**
 * 확대는 종류마다 다르게(사용자 2026-09-29) — 마크다운·HTML = 브라우저 확대처럼 글자·레이아웃이 같이 커지고 창 폭에 다시 맞춤,
 * 글 = 글자 크기, 그림 = 맞춤(가로·세로 다 창 안)·그 밖은 실제 픽셀 기준 %, PDF = 틀 폭(웹킷 PDF 보기는 자기 폭에 맞춰 그려서 틀을 넓힌다)
 */
export function frameStyle(kind: DocKind, z: number): React.CSSProperties | undefined {
  if (z === 100) return undefined;
  const f = z / 100;
  // HTML 은 프레임 안에서 확대한다(HtmlFrame) — 예전처럼 transform: scale 로 늘리면 그림을 늘린 것이라 흐려졌다(2026-09-30 사용자)
  if (kind === 'html') return undefined;
  return { width: `${z}%`, height: '100%', flex: 'none', margin: '0 auto' };
}

/**
 * HTML 시안 프레임 — 확대는 hodoc 이 HTML 에 심은 한 줄이 받아 문서 자체를 zoom 한다(글자를 다시 그려 선명).
 * 다른 출처라 직접은 못 건드려 postMessage 로 넘긴다. 처음 뜰 때도 한 번
 */
/** point = 짚어 보여 줄 곳(슬라이드 번호·찾을 글) — 페이지가 다 뜬 뒤에 페이지 안 다리에 넘긴다(시간을 정해 두고 보내면 늦게 뜨는 문서에서 사라졌다) */
export function HtmlFrame({ src, zoom, className, sandbox, point, pointKey }: { src: string; zoom: number; className?: string; sandbox: string; point?: { page?: number; find?: string }; pointKey?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const loaded = useRef(false);
  const post = () => ref.current?.contentWindow?.postMessage({ hodocZoom: zoom / 100 }, '*');
  const aim = () => { if (point && (point.page || point.find)) ref.current?.contentWindow?.postMessage({ hodocPage: point.page, hodocFind: point.find }, '*'); };
  useEffect(post, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (loaded.current) aim(); }, [pointKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loaded.current = false; }, [src]);
  return <iframe ref={ref} className={className} src={src} sandbox={sandbox} onLoad={() => { loaded.current = true; post(); window.setTimeout(aim, 150); }} />;
}

/**
 * 소리·워드·그 밖의 파일(2026-09-30 사용자 "더 많은 확장자") — 소리는 재생, 워드·RTF 는 textutil 로 바꾼 글,
 * 엑셀·키노트·PSD 등은 QuickLook 이 그린 첫 장 그림. 어느 쪽이든 "기본 앱으로 열기"
 */
export function ExtraDoc({ path, kind }: { path: string; kind: 'audio' | 'office' | 'other' }) {
  const [html, setHtml] = useState<string | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setHtml(null); setThumb(null); setErr('');
    if (kind === 'office') invoke<string>('office_html', { path }).then(setHtml, (e) => setErr(String(e)));
    if (kind === 'other') invoke<string>('ql_thumb', { path }).then(setThumb, (e) => setErr(String(e) || tr('미리보기를 못 만들었어', "Couldn't make a preview")));
  }, [path, kind]);
  const open = <button className="mini" onClick={() => void invoke('open_target', { kind: 'file', target: path }).catch(() => {})}>{tr('기본 앱으로 열기', 'Open in default app')}</button>;
  return (
    <div className="rd-extra">
      {kind === 'audio' ? <audio src={docUrl(path)} controls autoPlay />
        : kind === 'office' ? (html == null ? <div className="rd-empty">{err || tr('바꾸는 중', 'Converting')}</div> : <iframe className="rd-frame" srcDoc={html} sandbox="" title={titleOf(path)} />)
        : thumb ? <img src={docUrl(thumb)} alt={titleOf(path)} /> : <div className="rd-empty">{err || tr('미리보기 만드는 중', 'Making a preview')}</div>}
      <div className="rd-extra-bar"><span>{titleOf(path)}</span>{open}</div>
    </div>
  );
}

function Doc({ path, nonce, zoom, editing }: { path: string; nonce: number; zoom: number; editing?: boolean }) {
  const kind = kindOf(path);
  const [natural, setNatural] = useState(0); // 그림 원래 폭(화면 픽셀) — % 기준
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setText(null); setErr(null);
    if (kind === 'md' || kind === 'text') invoke<string>('read_doc_text', { path }).then(setText, (e) => setErr(String(e)));
  }, [path, kind, nonce]);
  if (err) return <div className="rd-empty">{tr('못 읽었어', "Couldn't read it")} — {err}</div>;
  // HTML 시안: 스크립트·저장소는 되지만 앱 기능(invoke)엔 못 닿는 다른 출처(hodoc://)에서 돈다(2026-09-28 실측)
  if (kind === 'html') return <div className="rd-zoombox"><HtmlFrame key={nonce} className="rd-frame" zoom={zoom} src={docUrl(path)} sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads" /></div>;
  if (kind === 'pdf') return <div className="rd-zoombox scroll"><iframe key={nonce} className="rd-frame" style={frameStyle(kind, zoom)} src={docUrl(path)} /></div>;
  if (kind === 'image') {
    // 맞춤 = 창 안에 통째로(작은 그림은 원래 크기), 그 밖 = 실제 픽셀(레티나 2배 캡처는 절반 폭이 100%) × %
    const sized = zoom !== FIT && natural > 0;
    return <div className={`rd-image ${sized ? '' : 'fit'}`}><img key={nonce} src={docUrl(path)} alt={titleOf(path)}
      onLoad={(e) => setNatural(e.currentTarget.naturalWidth / (window.devicePixelRatio || 1))}
      style={sized ? { maxWidth: 'none', maxHeight: 'none', width: `${natural * zoom / 100}px` } : undefined} /></div>;
  }
  if (kind === 'audio' || kind === 'office' || kind === 'other') return <ExtraDoc key={nonce} path={path} kind={kind} />;
  if (kind === 'video') return <div className="rd-video"><video key={nonce} src={docUrl(path)} controls playsInline /></div>;
  if (text == null) return <div className="rd-empty">{tr('읽는 중', 'Reading')}</div>;
  if (kind === 'md' && editing) {
    return (
      <Suspense fallback={<div className="rd-empty">{tr('편집기 여는 중', 'Opening the editor')}</div>}>
        <SpaceEditor key={`${path}:${nonce}`} md={text} docPath={path} onEditor={(ed) => { if (ed) editors.set(path, ed); else editors.delete(path); }}
          onReady={(n) => { lastSaved.set(path, n); setBaseline(path, n); }} onChange={(m) => saveSoon(path, m)} />
      </Suspense>
    );
  }
  if (kind === 'md') return <MdDoc key={nonce} path={path} md={text} zoom={zoom} />;
  return <pre className="rd-text" style={zoom === 100 ? undefined : { fontSize: `${12.5 * zoom / 100}px` }}>{text}</pre>;
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
  // 보고 있는 탭은 늘 탭 줄 안에 보이게 — 탭이 많으면 줄 밖(스크롤 쪽)에 가려져 있었다(2026-09-30 사용자)
  useEffect(() => {
    const on = strip.current?.querySelector<HTMLElement>('.rd-tab.on');
    on?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [s.active, s.tabs.length]);
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
export const ZOOM_KEY = 'readerZoom.v2'; // v1 의 그림 % 는 창 폭 기준이라 뜻이 달라 버린다(v2 = 맞춤·실제 픽셀)
export const loadZoom = (): ZoomMap => { try { return parseZoom(localStorage.getItem(ZOOM_KEY)); } catch { return {}; } };

/** send = 스페이스에서 고친 것을 참모에게(리더 패널만 — 떼어 낸 창엔 없음), sendTo = 받는 참모 이름 */
export function ReaderView({ surface, actions, send, sendTo }: { surface: string; actions?: React.ReactNode; send?: (text: string) => Promise<void>; sendTo?: string }) {
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  // 줄 코멘트 — 편집 중 커서 있는 줄을 인용해 한 줄 달기(보내기 칩에 모인다)
  const [cdraft, setCdraft] = useState<{ path: string; quote: string; text: string } | null>(null);
  const startComment = () => {
    const p = s.active;
    const ed = p ? editors.get(p) : undefined;
    if (!p || !ed) return;
    const quote = blockText(ed.getTextCursorPosition().block.content).trim() || tr('(빈 줄)', '(empty line)');
    setCdraft({ path: p, quote, text: '' });
  };
  const [s, setS] = useState<Surface>({ tabs: [], active: null });
  const [nonce, setNonce] = useState(0);
  // 확대 — 종류별로 기억(localStorage, 떼어 낸 창과도 나눈다)
  const [zooms, setZooms] = useState<ZoomMap>(loadZoom);
  const kind = s.active ? kindOf(s.active) : null;
  const zoom = kind ? zoomOf(zooms, kind) : 100;
  const zoomBy = useRef<(dir: 1 | -1 | 0) => void>(() => {});
  const body = useRef<HTMLDivElement>(null);
  zoomBy.current = (dir) => {
    if (!kind || !zoomable(kind)) return;
    let z: number;
    if (kind === 'image') {
      // 맞춤에서 누르면 지금 보이는 실제 비율에서 한 단계 — 맞춤이 37% 면 ⌘- 는 33%, ⌘+ 는 50%
      const img = body.current?.querySelector('img');
      const now = zoom !== FIT ? zoom : img?.naturalWidth ? Math.round(img.getBoundingClientRect().width / (img.naturalWidth / (window.devicePixelRatio || 1)) * 100) : 100;
      z = dir === 0 ? FIT : stepZoom(now, dir, IMAGE_STEPS);
    } else z = dir === 0 ? 100 : stepZoom(zoom, dir);
    const next = withZoom(zooms, kind, z);
    setZooms(next);
    try { localStorage.setItem(ZOOM_KEY, JSON.stringify(next)); } catch { /* 저장 못 해도 이번엔 된다 */ }
  };
  useEffect(() => {
    const w = window as unknown as { __readerZoom?: (dir: 1 | -1 | 0) => void };
    w.__readerZoom = (dir) => zoomBy.current(dir); // 메뉴 ⌘+ ⌘- ⌘0 — 리더를 보고 있을 때 App·떼어 낸 창이 부른다
    const sync = (e: StorageEvent) => { if (e.key === ZOOM_KEY) setZooms(loadZoom()); };
    window.addEventListener('storage', sync);
    return () => { delete w.__readerZoom; window.removeEventListener('storage', sync); };
  }, []);
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
          {kind && zoomable(kind) && (
            <div className="rd-zoom">
              <button onClick={() => zoomBy.current(-1)} title={tr('축소 (⌘-)', 'Zoom out (⌘-)')} aria-label={tr('축소', 'Zoom out')}><IconZoomOut /></button>
              <button className="rd-zoom-pct" onClick={() => zoomBy.current(0)} title={kind === 'image' ? tr('창에 맞춤 (⌘0)', 'Fit to window (⌘0)') : tr('원래 크기 (⌘0)', 'Actual size (⌘0)')}>{kind === 'image' && zoom === FIT ? tr('맞춤', 'Fit') : zoomLabel(zoom)}</button>
              <button onClick={() => zoomBy.current(1)} title={tr('확대 (⌘+)', 'Zoom in (⌘+)')} aria-label={tr('확대', 'Zoom in')}><IconZoomIn /></button>
            </div>
          )}
          {kind === 'md' && s.active && (
            <button className={editing[s.active] ? 'on' : ''} onClick={() => { const p = s.active!; setEditing((e) => ({ ...e, [p]: !e[p] })); if (editing[p]) setNonce((n) => n + 1); }}
              title={editing[s.active] ? tr('보기로 — 고친 건 저장돼 있어', 'Back to view — edits are saved') : tr('노션처럼 고치기 — 저장은 저절로, 고친 건 모아서 참모에게', 'Edit like Notion — saves automatically; send edits to the assistant together')}>
              {editing[s.active] ? tr('다 고침', 'Done') : tr('고치기', 'Edit')}
            </button>
          )}
          {kind === 'md' && s.active && editing[s.active] && (
            <button onMouseDown={(e) => e.preventDefault()} onClick={startComment} title={tr('커서 있는 줄에 코멘트 — 보낼 때 같이 가요', 'Comment on the line under the cursor — sent together')}>{tr('이 줄에 코멘트', 'Comment line')}</button>
          )}
          {/* 스페이스(보내기가 있는 리더 패널)에선 다시 읽기·기본 앱으로 열기를 뺀다 — 고치는 곳이 됐다(2026-09-30 사용자) */}
          {!send && <button onClick={() => setNonce((n) => n + 1)}>{tr('다시 읽기', 'Reload')}</button>}
          {!send && <button onClick={() => void invoke('open_target', { kind: 'file', target: s.active })}>{tr('기본 앱으로 열기', 'Open in default app')}</button>}
        </div>
      )}
      {cdraft && (
        <div className="sp-cdraft">
          <span className="q">{cdraft.quote}</span>
          <input autoFocus value={cdraft.text} placeholder={tr('이 줄에 한마디', 'Say something about this line')} onChange={(e) => setCdraft({ ...cdraft, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && cdraft.text.trim()) { addComment({ path: cdraft.path, quote: cdraft.quote, text: cdraft.text.trim() }); setCdraft(null); }
              if (e.key === 'Escape') setCdraft(null);
            }} />
          <button className="mini" disabled={!cdraft.text.trim()} onClick={() => { addComment({ path: cdraft.path, quote: cdraft.quote, text: cdraft.text.trim() }); setCdraft(null); }}>{tr('달기', 'Add')}</button>
          <button className="mini" onClick={() => setCdraft(null)}>{tr('취소', 'Cancel')}</button>
        </div>
      )}
      <div className="rd-body" ref={body} data-path={s.active ?? undefined}>
        {send && <SendFab send={send} sendTo={sendTo} />}
        {s.active ? <Doc path={s.active} nonce={nonce} zoom={zoom} editing={!!editing[s.active]} /> : <div className="rd-empty">{tr(`파일을 여기에 끌어다 놓거나, ${assistant()}한테 "띄워줘"라고 해 — HTML 시안·PDF·마크다운·그림·영상`, `Drop a file here, or ask ${assistant()} to show one — HTML designs, PDFs, Markdown, images, videos`)}</div>}
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
      else if (id === 'select_all') selectAllHere(true, document);
      else if (id === 'font_up' || id === 'font_down' || id === 'font_reset') (window as unknown as { __readerZoom?: (d: 1 | -1 | 0) => void }).__readerZoom?.(id === 'font_up' ? 1 : id === 'font_down' ? -1 : 0);
      else void invoke<Surface>('reader_state', { surface }).then((st) => st.active && invoke('reader_close', { surface, path: st.active }));
    };
  }, [surface]);
  return <ReaderView surface={surface} />;
}
