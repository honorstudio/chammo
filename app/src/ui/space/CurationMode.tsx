import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { orchVars } from '../../domain/orchTheme';
import { docUrl } from '../../domain/reader';
import { tr } from '../../i18n';
import { IconClose, IconSend, IconZoomIn, IconZoomOut } from '../Icons';
import { stepZoom, zoomLabel } from '../../domain/readerZoom';
import { HtmlFrame } from '../reader/Reader';

export type CurState = {
  title: string;
  kind?: string;
  total: number;
  done: number;
  counts: Record<string, number>;
  labels: { v: string; title: string; label?: string }[];
  decks: { name: string; marks: string[] }[];
  text: string;
  /** 블록마다 이름·덱·표시·메모 — 앱이 오른쪽 목록에 그린다 */
  blocks: { k: string; deck: number; v: string; note: string }[];
  /** 시안에서 지금 고른 블록 */
  sel: string;
  /** 표시·메모·덱 메모 그대로 — 앱이 파일로도 적어 둔다 */
  /** 시안은 marks·notes·decks, 흐름은 marks·notes·picks·flows — 앱은 통째로 파일에 적고 되돌릴 뿐이다 */
  store?: Record<string, Record<string, unknown> | undefined>;
  /** 껍데기가 받은 확대 — 이 칸이 없으면 옛 껍데기라 앱이 문서째 확대한다 */
  zoom?: number;
};


const CUR_ZOOM_KEY = 'curZoom';
const KIND = (): Record<string, string> => ({ design: tr('디자인', 'Design'), flow: tr('흐름', 'Flow'), copy: tr('문구', 'Copy'), media: tr('영상·이미지', 'Media') });

/**
 * 시안 검토 모드 — 스페이스 전체(왼쪽 메뉴 자리까지, 채팅 열은 그대로)를 검토에 쓴다(2026-09-30 사용자 v12).
 * 위: 제목·종류·진행 게이지·닫기 / 왼쪽: 시안 목차(덱마다 진행 칸) / 가운데: 시안(블록 오른쪽 칸에서 ○△✕·메모, J·K·1·2·3·M) /
 * 오른쪽 아래: 참모에게 보내기(우리 핵심 — 꾸물거리고, 다 표시하면 살아난다). 표시는 시안이 기억하고, 결과는 앱이 curation/ 에 적어 둔다(HtmlFrame record)
 */
export function CurationMode({ path, onClose, onSend, sendTo, color }: { path: string; onClose: () => void; onSend?: (text: string) => Promise<void>; sendTo: string; color?: string }) {
  const [st, setSt] = useState<CurState | null>(null);
  const [sent, setSent] = useState<'idle' | 'sending' | 'sent' | 'fail'>('idle');
  const [deckAt, setDeckAt] = useState(0);
  const notes = useRef(new Map<string, HTMLTextAreaElement>());
  const noteT = useRef(0);
  const cmd = (c: Record<string, unknown>) => frame()?.postMessage({ hodoc: 'cur-cmd', ...c }, '*');
  const frame = () => document.querySelector<HTMLIFrameElement>('.cur-mode iframe')?.contentWindow;
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const d = e.data as ({ hodoc?: string } & Partial<CurState>) | null;
      if (d?.hodoc !== 'cur-state' || typeof d.text !== 'string') return;
      setSt({ title: d.title ?? '', kind: d.kind, total: d.total ?? 0, done: d.done ?? 0, counts: d.counts ?? {}, labels: d.labels ?? [], decks: d.decks ?? [], text: d.text, blocks: d.blocks ?? [], sel: d.sel ?? '', zoom: d.zoom });
      if (d.sel) { const b = (d.blocks ?? []).find((x) => x.k === d.sel); if (b && b.deck >= 0) setDeckAt(b.deck); }
      setSent((x) => (x === 'sent' ? 'idle' : x));
      // 파일에 적기·칸을 새로 열 때 되돌리기는 HtmlFrame(record)이 한다 — 리더·미리보기와 같은 길
    };
    window.addEventListener('message', on);
    const ping = window.setTimeout(() => frame()?.postMessage({ hodoc: 'cur-cmd', cmd: 'ping' }, '*'), 800);
    // Esc 로 닫기(시안 안에서 누른 Esc 도 hodoc 이 넘겨 준다)
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.od-back')) onClose(); };
    const esc = (e: MessageEvent) => {
      const d = e.data as { hodoc?: string; k?: string } | null;
      if (d?.hodoc === 'esc') onClose();
      if (d?.hodoc === 'cur-note' && d.k != null) { setOpenK(d.k); window.setTimeout(() => notes.current.get(d.k!)?.focus(), 60); }
    };
    window.addEventListener('keydown', key);
    window.addEventListener('message', esc);
    return () => { window.removeEventListener('message', on); window.removeEventListener('keydown', key); window.removeEventListener('message', esc); window.clearTimeout(ping); };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  // 확대 ⌘+ ⌘- ⌘0 — 눌러서 고르는 방식이라 넓은 PC 시안도 키워서 본다(2026-10-01 사용자). 껍데기가 맞춤 크기에 곱한다
  const [zoom, setZoom] = useState(() => { try { const z = Number(localStorage.getItem(CUR_ZOOM_KEY)); return z > 0 ? z : 100; } catch { return 100; } });
  const zoomBy = useRef<(d: 1 | -1 | 0) => void>(() => {});
  zoomBy.current = (d) => {
    const z = d === 0 ? 100 : stepZoom(zoom, d);
    setZoom(z);
    try { localStorage.setItem(CUR_ZOOM_KEY, String(z)); } catch { /* 이번엔 된다 */ }
  };
  // 메뉴 ⌘+ ⌘- ⌘0 은 App 이 __previewZoom 부터 본다 — 검토 모드가 떠 있으면 여기로
  useEffect(() => {
    const w = window as unknown as { __previewZoom?: (d: 1 | -1 | 0) => void };
    const mine = (d: 1 | -1 | 0) => zoomBy.current(d);
    w.__previewZoom = mine;
    return () => { if (w.__previewZoom === mine) delete w.__previewZoom; };
  }, []);
  // 껍데기가 알려 온 확대와 다르면 보낸다 — 시안을 다시 읽어도(새로 고침) 따라간다
  const shellZoom = st?.zoom;
  useEffect(() => { if (shellZoom !== undefined && Math.abs(shellZoom - zoom / 100) > 0.001) cmd({ cmd: 'zoom', z: zoom / 100 }); }, [shellZoom, zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = st?.total ?? 0;
  const done = st?.done ?? 0;
  const full = total > 0 && done >= total;
  const pct = total ? Math.round((done / total) * 100) : 0;
  // 보내기 전에 덧붙일 말 — 버튼에 올리면 펼쳐지는 칸(2026-10-01 사용자)
  const [extra, setExtra] = useState('');
  const send = async () => {
    if (!st || !onSend) return;
    setSent('sending');
    const more = extra.trim();
    try { await onSend(more ? `${st.text}\n\n${tr('덧붙이는 말', 'Additional note')}: ${more}` : st.text); setSent('sent'); setExtra(''); void invoke('space_log_append', { line: JSON.stringify({ ts: new Date().toISOString(), who: '사용자', kind: 'review', path }) }).catch(() => {}); } catch { setSent('fail'); }
  };
  const goto = (i: number) => { setDeckAt(i); cmd({ cmd: 'goto', deck: i }); };
  // 펼친 카드 — 시안에서 고른 블록을 따라간다(J·K·블록 누르기). 펼친 카드를 다시 누르면 접는다
  const [openK, setOpenK] = useState<string | null>(null);
  useEffect(() => { if (st?.sel) setOpenK(st.sel); }, [st?.sel]);
  const openRow = useRef<HTMLLIElement | null>(null);
  useEffect(() => { openRow.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [openK]);
  const seg = (v: string) => (total ? `${((st?.counts[v] ?? 0) / total) * 100}%` : '0%');

  return (
    <div className="cur-mode">
      <header className="cur-mode-top">
        <b className="cur-mode-title">{st?.title || path.split('/').pop()}</b>
        <span className="cur-mode-kind">{KIND()[st?.kind ?? 'design'] ?? tr('시안', 'Draft')}</span>
        <span className="cur-mode-gauge" title={tr(`${done} / ${total} 표시`, `${done} / ${total} marked`)}>
          <i className="pick" style={{ width: seg('pick') }} /><i className="maybe" style={{ width: seg('maybe') }} /><i className="drop" style={{ width: seg('drop') }} />
        </span>
        <span className="cur-mode-n">{tr(`${done} / ${total} 표시`, `${done} / ${total}`)}</span>
        {st?.labels.map((l) => <span key={l.v} className={`cur-mode-chip ${l.v}`}><i />{l.title} {st.counts[l.v] ?? 0}</span>)}
        <span className="cur-mode-sp" />
        {st && st.total > st.done && <button className="cur-mode-close" onClick={() => cmd({ cmd: 'next' })} title={tr('다음 안 고른 블록으로', 'Next unmarked block')}>{tr(`남은 ${st.total - st.done} · 다음`, `${st.total - st.done} left · Next`)}</button>}
        <span className="rd-zoom cur-mode-zoom">
          <button onClick={() => zoomBy.current(-1)} title={tr('축소 (⌘-)', 'Zoom out (⌘-)')} aria-label={tr('축소', 'Zoom out')}><IconZoomOut /></button>
          <button className="rd-zoom-pct" onClick={() => zoomBy.current(0)} title={tr('원래 크기 (⌘0)', 'Actual size (⌘0)')}>{zoomLabel(zoom)}</button>
          <button onClick={() => zoomBy.current(1)} title={tr('확대 (⌘+)', 'Zoom in (⌘+)')} aria-label={tr('확대', 'Zoom in')}><IconZoomIn /></button>
        </span>
        <span className="cur-mode-saved">{tr('자동 저장', 'Autosaved')}</span>
        <button className="cur-mode-close" onClick={onClose} title={tr('닫기 (Esc) — 표시는 그대로 남아', 'Close (Esc) — marks are kept')}><IconClose />{tr('닫기', 'Close')}</button>
      </header>
      <div className="cur-mode-body">
        {/* 왼쪽 시안 목차는 뺐다 — 오른쪽 카드 목록이 시안별로 묶여 겹쳤고, 가운데 시안이 좁아졌다(2026-09-30 사용자) */}
        <div className="cur-mode-stage">
          <HtmlFrame className="rd-frame" src={docUrl(path)} zoom={st && st.zoom === undefined ? zoom : 100} record={path} />
        </div>
        {/* 오른쪽 표시 목록은 뺐다 — 블록을 누르면 그 자리에 고르는 창이 떠서, 목록까지 마우스를 옮기지 않는다(2026-10-01 사용자). 시안 자리도 넓어진다 */}
      </div>
      {onSend && (
        <div className={`cur-send-wrap ${extra.trim() ? 'has' : ''}`} style={color ? orchVars(color) as React.CSSProperties : undefined}>
        <div className="cur-send-card">
          <label htmlFor="cur-extra">{tr(`${sendTo}에게 같이 보낼 말`, `Note for ${sendTo}`)}</label>
          <textarea id="cur-extra" value={extra} rows={3} placeholder={tr('선택 — 비워 둬도 돼요. ⌘Enter 보내기', 'Optional — ⌘Enter to send')}
            onChange={(e) => setExtra(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } e.stopPropagation(); }} />
        </div>
        <button className={`cur-send ${full ? 'full' : ''} ${sent}`} onClick={() => void send()} disabled={sent === 'sending'}
          aria-label={tr(`${sendTo}에게 결과 보내기`, `Send results to ${sendTo}`)}
          title={sent === 'sent' ? tr('보냈어', 'Sent') : sent === 'fail' ? tr('못 보냄 — 다시 누르기', 'Failed — press again') : tr(`${sendTo}에게 보내기 · ${done}/${total} 표시 — 다 안 봐도 보낼 수 있어`, `Send to ${sendTo} · ${done}/${total} marked`)}>
          {/* 글자 없이: 고리가 표시한 만큼 차고, 가운데 종이비행기, 개수는 작은 배지(2026-09-30 사용자 "텍스트 말고 아이콘") */}
          <span className="cur-send-ring" style={{ ['--p' as string]: `${pct}%` }}><span className="cur-send-plane"><IconSend /></span></span>
          <span className="cur-send-n">{sent === 'sent' ? '✓' : `${done}/${total}`}</span>
        </button>
        </div>
      )}
    </div>
  );
}

/** 표시 모양 — 글자(○△✕) 대신 직접 그린 도형: 쓴다 동그라미 · 애매 세모 · 뺀다 가위표 */
function MarkIcon({ i }: { i: number }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {i === 0 ? <circle cx="8" cy="8" r="5.2" /> : i === 1 ? <path d="M8 2.8 13.6 12.6H2.4Z" /> : <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />}
    </svg>
  );
}
