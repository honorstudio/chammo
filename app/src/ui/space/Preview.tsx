import { invoke } from '@tauri-apps/api/core';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DashFile } from '../../domain/dashboard';
import { keepCenter, parseBox, resizeBox, type Box, type Edge } from '../../domain/previewBox';
import { docUrl, kindOf, pageDoc } from '../../domain/reader';
import { FIT, IMAGE_STEPS, stepZoom, withZoom, zoomable, zoomLabel, zoomOf, type ZoomMap } from '../../domain/readerZoom';
import { assistant, josa, tr } from '../../i18n';
import { sendPreview } from '../../domain/sendPreview';
import { IconClose, IconMaximize, IconRestore, IconSend, IconZoomIn, IconZoomOut } from '../Icons';
import { Confirm } from '../OrchDialogs';
import { ExtraDoc, frameStyle, HtmlFrame, loadZoom, MdDoc, ZOOM_KEY } from '../reader/Reader';
import { flashWhenReady } from '../flash';
import { isCurationHtml } from '../../domain/curation';
import { webTitle } from '../../domain/webUrl';
import { WebPage } from '../WebPage';

const fileName = (p: string) => (p.startsWith('data:') ? tr('붙인 그림', 'Attached image') : kindOf(p) === 'web' ? webTitle(p) : p.split('/').pop() ?? p);
const BOX_KEY = 'previewBox';
const loadBox = () => { try { return parseBox(localStorage.getItem(BOX_KEY)); } catch { return null; } };
const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/**
 * 스페이스 위 미리보기 — 페이지를 안 넘어간다. Esc·닫기·바깥 누르면 닫힘.
 * 가장자리를 끌어 크기 조절(기억, 제목 줄 두 번 누르면 꽉 채움), ⌘+ ⌘- ⌘0 은 리더처럼 확대(종류별 확대를 리더와 나눈다) — 2026-09-30 사용자
 */
export function Preview({ f, onClose, onAttach, onSendText, onCuration }: { f: DashFile; onClose: () => void; /** 채팅에 붙이기 — 참모가 경로로 받아 읽는다 */ onAttach?: () => void; /** 시안 속 "참모에게 보내기"(큐레이션 결과) — 지금 채팅 탭 참모에게 */ onSendText?: (text: string) => Promise<void>;
  /** 검토용 시안이면 모달 대신 스페이스 전체 검토 모드로 */ onCuration?: (path: string, by?: string) => void }) {
  const kind = f.path.startsWith('data:') ? 'image' : kindOf(f.path);
  const [md, setMd] = useState<string | null>(null);
  // Esc = 닫기. 채팅 입력칸보다 먼저 잡아 삼킨다(안 그러면 입력칸 Esc 가 참모를 멈춘다). 포커스가 시안 프레임 안이면
  // 앱까지 키가 안 온다 — hodoc 이 HTML 에 심은 한 줄이 Esc 를 postMessage 로 넘긴다(2026-09-30 사용자 "esc 아무리 눌러도 안 꺼져")
  const close = useRef(onClose);
  close.current = onClose;
  // 시안 검토(큐레이션)를 앱 기능으로 — 시안이 표시할 때마다 {hodoc:'cur-state'} 를 보내면 머리에 진행도·보내기를 그리고,
  // 결과를 앱 데이터 폴더/curation/ 에 적어 둔다(참모가 보내기 전에도 읽게). 2026-09-30 사용자 "네이티브 참모 기능으로"
  type Cur = { total: number; done: number; counts: Record<string, number>; labels: { v: string; title: string }[]; text: string };
  const [cur, setCur] = useState<Cur | null>(null);
  const [curSent, setCurSent] = useState<'idle' | 'sending' | 'sent' | 'fail'>('idle');
  const curSave = useRef(0);
  const onCurationRef = useRef(onCuration);
  onCurationRef.current = onCuration;
  // 검토용 시안이면 창을 한 번도 안 그리고 바로 검토 모드로 — 확인하는 동안(몇 ms)은 아무것도 안 그린다(깜빡임, 2026-09-30 사용자)
  const [gate, setGate] = useState<'check' | 'open'>(() => (kind === 'html' && onCuration ? 'check' : 'open'));
  useEffect(() => {
    if (gate !== 'check') return;
    void invoke<string>('read_doc_text', { path: f.path }).then((t) => { if (isCurationHtml(t) && onCurationRef.current) onCurationRef.current(f.path, f.by); else setGate('open'); }, () => setGate('open'));
  }, [f.path]); // eslint-disable-line react-hooks/exhaustive-deps
  const [askReset, setAskReset] = useState(false);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const d = e.data as ({ hodoc?: string } & Partial<Cur>) | null;
      if (d?.hodoc !== 'cur-state' || typeof d.text !== 'string') return;
      if (onCurationRef.current) { onCurationRef.current(f.path, f.by); return; }
      setCur({ total: d.total ?? 0, done: d.done ?? 0, counts: d.counts ?? {}, labels: d.labels ?? [], text: d.text });
      setCurSent((x) => (x === 'sent' ? 'idle' : x));
      window.clearTimeout(curSave.current);
      const text = d.text;
      curSave.current = window.setTimeout(() => void invoke('save_curation', { path: f.path, text }).catch(() => {}), 700);
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [f.path]);
  const curFrame = () => document.querySelector<HTMLIFrameElement>('body > .dash-preview iframe')?.contentWindow;
  const sendCur = async () => {
    if (!cur || !onSendText) return;
    setCurSent('sending');
    try { await onSendText(cur.text); setCurSent('sent'); } catch { setCurSent('fail'); }
  };

  // 큐레이션 시안의 "참모에게 보내기" — 프레임이 {hodoc:'curation', text} 를 보낸다(2026-09-30 사용자). 바로 안 보내고 미리보기로 묻는다 —
  // 시안 안 글은 웹에서 긁어 온 것일 수 있고, iframe 안 클릭이 사람 동작인지 부모는 못 본다(프롬프트 주입 막기, 2026-10-03)
  const sendText = useRef(onSendText);
  sendText.current = onSendText;
  const [askSend, setAskSend] = useState<{ text: string; reply: (ok: boolean, error?: string) => void } | null>(null);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const d = e.data as { hodoc?: string; text?: string } | null;
      if (d?.hodoc !== 'curation' || typeof d.text !== 'string') return;
      const reply = (ok: boolean, error?: string) => (e.source as Window | null)?.postMessage({ hodoc: 'curation-sent', ok, error }, '*');
      if (!sendText.current) { reply(false, tr('여기선 못 보내 — 결과 복사로', "Can't send from here — copy instead")); return; }
      setAskSend({ text: d.text, reply });
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !document.querySelector('.od-back') && !(e.target as HTMLElement | null)?.classList?.contains('wp-addr')) { e.preventDefault(); e.stopPropagation(); close.current(); } };
    const msg = (e: MessageEvent) => { if ((e.data as { hodoc?: string } | null)?.hodoc === 'esc') close.current(); };
    window.addEventListener('keydown', key, true);
    window.addEventListener('message', msg);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('message', msg); };
  }, []);
  useEffect(() => { if (kind === 'md' || kind === 'text') void invoke<string>('read_doc_text', { path: f.path }).then(setMd, () => setMd('')); }, [f.path, kind]);

  // 확대 — 메뉴 ⌘+ ⌘- ⌘0 이 모달이 떠 있으면 여기로 온다(App 이 __previewZoom 을 먼저 본다)
  const [zooms, setZooms] = useState<ZoomMap>(loadZoom);
  const zoom = zoomOf(zooms, kind);
  const content = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState(0);
  const zoomBy = useRef<(dir: 1 | -1 | 0) => void>(() => {});
  // 그림은 보던 가운데를 기준으로 확대 — 확대 전 스크롤 자리를 잡아 뒀다가 다시 그린 뒤 맞춘다(좌상단으로 커졌다, 2026-09-30 사용자)
  const imgBox = useRef<HTMLDivElement>(null);
  // 짚어 보여 주기(scripts/show --line/--find/--box) — 글·마크다운은 그 곳으로 스크롤해 반짝, 웹 페이지는 페이지 안 다리에 부탁, 그림은 네모
  const at = f.at;
  useEffect(() => {
    if (!at || md == null || (kind !== 'md' && kind !== 'text')) return;
    return flashWhenReady(() => content.current, at, md, kind === 'text');
  }, [f.ts, md == null]); // eslint-disable-line react-hooks/exhaustive-deps
  const [boxAt, setBoxAt] = useState<React.CSSProperties | null>(null);
  useEffect(() => {
    const b = at?.box;
    const img = imgBox.current?.querySelector('img');
    if (!b || !img) { setBoxAt(null); return; }
    const place = () => setBoxAt({ left: img.offsetLeft + b[0] * img.offsetWidth, top: img.offsetTop + b[1] * img.offsetHeight, width: b[2] * img.offsetWidth, height: b[3] * img.offsetHeight });
    place();
    const ro = new ResizeObserver(place);
    ro.observe(img);
    const t = window.setTimeout(() => imgBox.current?.querySelector('.pv-box')?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }), 150);
    return () => { ro.disconnect(); window.clearTimeout(t); };
  }, [f.ts, natural, zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  const center = useRef<{ view: { left: number; top: number; w: number; h: number }; before: Box } | null>(null);
  useLayoutEffect(() => {
    const el = imgBox.current;
    const c = center.current;
    center.current = null;
    if (!el || !c) return;
    const at = keepCenter(c.view, c.before, { w: el.scrollWidth, h: el.scrollHeight });
    el.scrollLeft = at.left;
    el.scrollTop = at.top;
  }, [zoom]);
  zoomBy.current = (dir) => {
    if (!zoomable(kind)) return;
    let z: number;
    if (kind === 'image') {
      const el = imgBox.current;
      if (el) center.current = { view: { left: el.scrollLeft, top: el.scrollTop, w: el.clientWidth, h: el.clientHeight }, before: { w: el.scrollWidth, h: el.scrollHeight } };
      const img = content.current?.querySelector('img');
      const now = zoom !== FIT ? zoom : img?.naturalWidth ? Math.round(img.getBoundingClientRect().width / (img.naturalWidth / (window.devicePixelRatio || 1)) * 100) : 100;
      z = dir === 0 ? FIT : stepZoom(now, dir, IMAGE_STEPS);
    } else z = dir === 0 ? 100 : stepZoom(zoom, dir);
    const next = withZoom(zooms, kind, z);
    setZooms(next);
    try { localStorage.setItem(ZOOM_KEY, JSON.stringify(next)); } catch { /* 이번엔 된다 */ }
  };
  useEffect(() => {
    const w = window as unknown as { __previewZoom?: (d: 1 | -1 | 0) => void };
    w.__previewZoom = (d) => zoomBy.current(d);
    return () => { delete w.__previewZoom; };
  }, []);

  // ⌘` = 스페이스 가득(한 번 더 누르면 원래 크기) — 메뉴 단축키가 __previewMax 를 먼저 본다(2026-09-30 사용자)
  const [max, setMax] = useState(false);
  useEffect(() => {
    const w = window as unknown as { __previewMax?: () => void };
    w.__previewMax = () => setMax((m) => !m);
    return () => { delete w.__previewMax; };
  }, []);

  // 뜨는 자리 — 평소엔 채팅 열을 안 덮고 스페이스(메뉴+가운데) 위에만, ⌘`(가득)일 때만 채팅까지 덮는다(2026-09-30 사용자)
  const [area, setArea] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  // 그리기 전에 재야 한다 — 처음 창 전체로 떴다가 스페이스 자리로 미끄러져 "점프"했다(2026-09-30 사용자). 움직임은 첫 자리 잡은 뒤부터
  const [placed, setPlaced] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setPlaced(true)); return () => cancelAnimationFrame(r); }, []);
  useLayoutEffect(() => {
    const measure = () => {
      const el = document.querySelector<HTMLElement>('.space-mode .space');
      const r = el?.getBoundingClientRect();
      setArea(r && r.width > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null);
    };
    measure();
    window.addEventListener('resize', measure);
    const el = document.querySelector<HTMLElement>('.space-mode .space');
    const ro = el ? new ResizeObserver(measure) : null;
    if (el) ro!.observe(el);
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, []);

  // 크기 — null 이면 꽉 채움. 끄는 동안은 덮개를 깔아 시안 프레임이 마우스를 빼앗지 않게
  const [box, setBox] = useState<Box | null>(loadBox);
  const [drag, setDrag] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const boxEl = useRef<HTMLDivElement>(null);
  const saveBox = (b: Box | null) => { try { if (b) localStorage.setItem(BOX_KEY, JSON.stringify(b)); else localStorage.removeItem(BOX_KEY); } catch { /* 이번엔 된다 */ } };
  const startResize = (edge: Edge) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const r = boxEl.current?.getBoundingClientRect();
    const pad = wrap.current?.getBoundingClientRect();
    if (!r || !pad) return;
    const start = { w: r.width, h: r.height };
    const room = { w: pad.width - 16, h: pad.height - 16 };
    const x0 = e.clientX;
    const y0 = e.clientY;
    let last = start;
    setDrag(true);
    const move = (ev: PointerEvent) => { last = resizeBox(start, ev.clientX - x0, ev.clientY - y0, edge, room); setBox(last); };
    const up = () => { setDrag(false); saveBox(last); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const fill = () => { setBox(null); saveBox(null); };

  const sized = kind === 'image' && zoom !== FIT && natural > 0;
  // 채팅 패널 위까지 덮는다 — 스페이스 안에만 뜨면 좁았다(2026-09-30 사용자 "오케스트레이터 패널보다 위로")
  if (gate === 'check') return null;
  return createPortal(
    <div className={`dash-preview ${max ? 'max' : ''} ${placed ? 'placed' : ''}`} ref={wrap} onClick={onClose} style={!max && area ? { inset: 'auto', left: area.left, top: area.top, width: area.width, height: area.height } : undefined}>
      <div className={`box ${box && !max ? 'sized' : ''}`} ref={boxEl} style={box && !max ? { width: box.w, height: box.h } : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="bar" onDoubleClick={fill} title={tr('가장자리를 끌어 크기 조절 · 두 번 누르면 꽉 채움', 'Drag an edge to resize · double-click to fill')}>
          <b>{fileName(f.path)}</b><span className="sp" />
          {zoomable(kind) && (
            <div className="rd-zoom">
              <button onClick={() => zoomBy.current(-1)} title={tr('축소 (⌘-)', 'Zoom out (⌘-)')} aria-label={tr('축소', 'Zoom out')}><IconZoomOut /></button>
              <button className="rd-zoom-pct" onClick={() => zoomBy.current(0)} title={kind === 'image' ? tr('창에 맞춤 (⌘0)', 'Fit (⌘0)') : tr('원래 크기 (⌘0)', 'Actual size (⌘0)')}>{kind === 'image' && zoom === FIT ? tr('맞춤', 'Fit') : zoomLabel(zoom)}</button>
              <button onClick={() => zoomBy.current(1)} title={tr('확대 (⌘+)', 'Zoom in (⌘+)')} aria-label={tr('확대', 'Zoom in')}><IconZoomIn /></button>
            </div>
          )}
          {onAttach && <button className="pv-attach" onClick={() => { onAttach(); onClose(); }} title={tr(`지금 채팅 입력칸에 이 파일을 붙인다 — 보낼 때 ${josa(assistant(), '이', '가')} 경로로 받아 본다`, 'Attach to the chat input — the assistant gets the path')}>{tr('채팅에 붙이기', 'Attach to chat')}</button>}
          <button className="pv-ic" onClick={() => setMax((m) => !m)} title={max ? tr('원래 크기 (⌘`)', 'Restore (⌘`)') : tr('가득 채우기 (⌘`)', 'Fill (⌘`)')} aria-label={max ? tr('원래 크기', 'Restore') : tr('가득 채우기', 'Fill')}>{max ? <IconRestore /> : <IconMaximize />}</button>
          <button className="pv-ic" onClick={onClose} title={tr('닫기 (Esc)', 'Close (Esc)')} aria-label={tr('닫기', 'Close')}><IconClose /></button>
        </div>
        {askSend && (() => {
          const p = sendPreview(askSend.text);
          return <Confirm title={tr(`${assistant()}에게 보낼까? (${p.chars}자)`, `Send to ${assistant()}? (${p.chars} chars)`)} body={`${p.lines.join('\n')}${p.more ? '\n…' : ''}`} ok={tr('보내기', 'Send')}
            onCancel={() => { askSend.reply(false, tr('취소했어', 'Cancelled')); setAskSend(null); }}
            onOk={() => { const a = askSend; setAskSend(null); sendText.current?.(a.text).then(() => a.reply(true), (err) => a.reply(false, String(err))); }} />;
        })()}
        {askReset && <Confirm title={tr('처음부터 할까?', 'Start over?')} body={tr('이 시안에 표시한 것과 메모를 모두 지워.', 'Clears every mark and note on this draft.')} ok={tr('지우기', 'Clear')} danger
          onCancel={() => setAskReset(false)} onOk={() => { setAskReset(false); curFrame()?.postMessage({ hodoc: 'cur-cmd', cmd: 'reset' }, '*'); }} />}
        {cur && (
          <div className="pv-cur" onDoubleClick={(e) => e.stopPropagation()}>
            <b>{tr('시안 검토', 'Review')}</b>
            <span className="pv-cur-bar"><i style={{ width: `${cur.total ? (cur.done / cur.total) * 100 : 0}%` }} /></span>
            <span className="pv-cur-n">{tr(`${cur.done} / ${cur.total} 표시함`, `${cur.done} / ${cur.total} marked`)}</span>
            {cur.labels.map((l) => <span key={l.v} className={`pv-cur-chip ${l.v}`}><i />{l.title} {cur.counts[l.v] ?? 0}</span>)}
            <span className="sp" />
            <span className="pv-cur-hint">{tr('블록에 올리고 1·2·3', 'Hover a block, press 1·2·3')}</span>
            <button className="pv-cur-reset" onClick={() => setAskReset(true)}>{tr('처음부터', 'Reset')}</button>
            {onSendText && <button className={`pv-cur-send ${curSent}`} disabled={curSent === 'sending'} onClick={() => void sendCur()}>
              <IconSend />{curSent === 'sending' ? tr('보내는 중', 'Sending') : curSent === 'sent' ? tr('보냈어 — 다시 보내기', 'Sent — send again') : curSent === 'fail' ? tr('못 보냄 — 다시', 'Failed — retry') : tr(`${assistant()}에게 보내기`, 'Send to assistant')}</button>}
          </div>
        )}
        <div className="content" ref={content}>
          {kind === 'web' ? <WebPage url={f.path} />
            : kind === 'image' ? <div className={`pv-image ${sized ? '' : 'fit'}`} ref={imgBox}><img src={f.path.startsWith('data:') ? f.path : docUrl(f.path)} alt="" onLoad={(e) => setNatural(e.currentTarget.naturalWidth / (window.devicePixelRatio || 1))}
              style={sized ? { maxWidth: 'none', maxHeight: 'none', width: `${natural * zoom / 100}px` } : undefined} />{boxAt && <span className="pv-box" style={boxAt} />}</div>
            : kind === 'html' ? <div className="rd-zoombox"><HtmlFrame className="rd-frame" src={docUrl(f.path)} zoom={zoom} point={at} pointKey={f.ts} sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads" /></div>
            : kind === 'pdf' ? <Suspense fallback={<div className="dim">{tr('여는 중', 'Opening')}</div>}><PdfView path={f.path} zoom={zoom} at={f.at} atKey={f.ts} /></Suspense>
            : (kind === 'office' || kind === 'other') && pageDoc(f.path) ? <OfficeDoc f={f} zoom={zoom} fallback={kind} />
            : kind === 'audio' || kind === 'office' || kind === 'other' ? <ExtraDoc path={f.path} kind={kind} />
            : kind === 'video' ? <video className="pv-video" src={docUrl(f.path)} controls autoPlay playsInline />
            : kind === 'md' ? (md == null ? <div className="dim">{tr('읽는 중', 'Reading')}</div> : <MdDoc path={f.path} md={md} zoom={zoom} />)
            : kind === 'text' ? <pre style={zoom === 100 ? undefined : { fontSize: `${12.5 * zoom / 100}px` }}>{md}</pre>
            : <div className="dim">{tr('미리보기가 안 되는 파일이에요', 'No preview for this file')}</div>}
        </div>
        {!max && EDGES.map((e) => <span key={e} className={`rz rz-${e}`} onPointerDown={startResize(e)} />)}
        {drag && <div className="rz-cover" />}
      </div>
    </div>,
    document.body,
  );
}

const PdfView = lazy(() => import('../reader/PdfView'));

/** 파워포인트·워드·엑셀·키노트 — macOS QuickLook 미리보기(슬라이드마다 나뉜 HTML)로 그려 슬라이드 번호·글로 짚어 보여 준다. 못 만들면 예전 미리보기 */
function OfficeDoc({ f, zoom, fallback }: { f: DashFile; zoom: number; fallback: 'office' | 'other' }) {
  const [main, setMain] = useState<string | null | false>(null);
  useEffect(() => { setMain(null); void invoke<string>('page_doc', { path: f.path }).then(setMain, () => setMain(false)); }, [f.path]);
  if (main === null) return <div className="dim">{tr('미리보기 만드는 중', 'Making a preview')}</div>;
  if (main === false) return <ExtraDoc path={f.path} kind={fallback} />;
  if (kindOf(main) === 'pdf') return <Suspense fallback={<div className="dim">{tr('여는 중', 'Opening')}</div>}><PdfView path={main} zoom={zoom} at={f.at} atKey={f.ts} /></Suspense>;
  return <div className="rd-zoombox"><HtmlFrame className="rd-frame" src={docUrl(main)} zoom={zoom} point={f.at} pointKey={f.ts} sandbox="allow-scripts allow-same-origin" /></div>;
}
