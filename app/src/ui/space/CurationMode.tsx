import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { docUrl } from '../../domain/reader';
import { tr } from '../../i18n';
import { IconClose, IconSend } from '../Icons';
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
  store?: { marks: Record<string, string>; notes: Record<string, string>; decks: Record<string, string> };
};

const emptyStore = (d?: CurState['store']) => !d || (!Object.keys(d.marks ?? {}).length && !Object.keys(d.notes ?? {}).length && !Object.keys(d.decks ?? {}).length);

const KIND = (): Record<string, string> => ({ design: tr('디자인', 'Design'), flow: tr('흐름', 'Flow'), copy: tr('문구', 'Copy'), media: tr('영상·이미지', 'Media') });

/**
 * 시안 검토 모드 — 스페이스 전체(왼쪽 메뉴 자리까지, 채팅 열은 그대로)를 검토에 쓴다(2026-09-30 사용자 v12).
 * 위: 제목·종류·진행 게이지·닫기 / 왼쪽: 시안 목차(덱마다 진행 칸) / 가운데: 시안(블록 오른쪽 칸에서 ○△✕·메모, J·K·1·2·3·M) /
 * 오른쪽 아래: 참모에게 보내기(우리 핵심 — 꾸물거리고, 다 표시하면 살아난다). 표시는 시안이 기억하고, 결과는 앱이 curation/ 에 적어 둔다
 */
export function CurationMode({ path, onClose, onSend, sendTo }: { path: string; onClose: () => void; onSend?: (text: string) => Promise<void>; sendTo: string }) {
  const [st, setSt] = useState<CurState | null>(null);
  const [sent, setSent] = useState<'idle' | 'sending' | 'sent' | 'fail'>('idle');
  const [deckAt, setDeckAt] = useState(0);
  const saveT = useRef(0);
  const checked = useRef(false);
  const notes = useRef(new Map<string, HTMLTextAreaElement>());
  const noteT = useRef(0);
  const cmd = (c: Record<string, unknown>) => frame()?.postMessage({ hodoc: 'cur-cmd', ...c }, '*');
  const frame = () => document.querySelector<HTMLIFrameElement>('.cur-mode iframe')?.contentWindow;
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const d = e.data as ({ hodoc?: string } & Partial<CurState>) | null;
      if (d?.hodoc !== 'cur-state' || typeof d.text !== 'string') return;
      setSt({ title: d.title ?? '', kind: d.kind, total: d.total ?? 0, done: d.done ?? 0, counts: d.counts ?? {}, labels: d.labels ?? [], decks: d.decks ?? [], text: d.text, blocks: d.blocks ?? [], sel: d.sel ?? '' });
      if (d.sel) { const b = (d.blocks ?? []).find((x) => x.k === d.sel); if (b && b.deck >= 0) setDeckAt(b.deck); }
      setSent((x) => (x === 'sent' ? 'idle' : x));
      // 앱 안 브라우저 저장소는 다시 켜면 비었다 — 처음 알림이 비어 있으면 파일에 적어 둔 표시를 되돌린다. 확인 전엔 안 적는다(좋은 기록을 빈 걸로 덮지 않게)
      if (!checked.current) {
        checked.current = true;
        if (emptyStore(d.store)) {
          void invoke<string>('read_curation_state', { path }).then((j) => {
            try { const data = JSON.parse(j) as CurState['store']; if (!emptyStore(data)) frame()?.postMessage({ hodoc: 'cur-cmd', cmd: 'restore', data }, '*'); } catch { /* 없거나 깨짐 */ }
          });
          return;
        }
      }
      window.clearTimeout(saveT.current);
      const text = d.text;
      const json = JSON.stringify(d.store ?? {});
      saveT.current = window.setTimeout(() => { void invoke('save_curation', { path, text }).catch(() => {}); void invoke('save_curation_state', { path, json }).catch(() => {}); }, 600);
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

  const total = st?.total ?? 0;
  const done = st?.done ?? 0;
  const full = total > 0 && done >= total;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const send = async () => {
    if (!st || !onSend) return;
    setSent('sending');
    try { await onSend(st.text); setSent('sent'); } catch { setSent('fail'); }
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
        <span className="cur-mode-saved">{tr('자동 저장', 'Autosaved')}</span>
        <button className="cur-mode-close" onClick={onClose} title={tr('닫기 (Esc) — 표시는 그대로 남아', 'Close (Esc) — marks are kept')}><IconClose />{tr('닫기', 'Close')}</button>
      </header>
      <div className="cur-mode-body">
        {/* 왼쪽 시안 목차는 뺐다 — 오른쪽 카드 목록이 시안별로 묶여 겹쳤고, 가운데 시안이 좁아졌다(2026-09-30 사용자) */}
        <div className="cur-mode-stage">
          <HtmlFrame className="rd-frame" src={docUrl(path)} zoom={100} sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads" />
        </div>
        {/* 표시 목록 — 블록 옆 칸은 블록 높이와 어긋났다. 앱이 한 줄씩 그리고, 누르면 시안이 그 블록을 짚는다(2026-09-30 사용자) */}
        <aside className="cur-mode-marks" aria-label={tr('표시', 'Marks')}>
          <div className="cur-mode-marks-keys">{tr('J·K 이동 · 1·2·3 표시 · M 메모', 'J·K move · 1·2·3 mark · M note')}</div>
          <div className="cur-mode-marks-list">
            {(st?.decks ?? []).map((d, di) => {
              const bs = (st?.blocks ?? []).filter((b) => b.deck === di);
              if (!bs.length) return null;
              return (
                <section key={di} className="cur-mark-deck">
                  <button className={`cur-mark-deck-h ${deckAt === di ? 'on' : ''}`} onClick={() => goto(di)}>
                    <b>{d.name}</b><span>{bs.filter((b) => b.v).length} / {bs.length}</span>
                  </button>
                  <ul>
                    {bs.map((b) => {
                      const open = b.k === openK;
                      const li = (st?.labels ?? []).findIndex((l) => l.v === b.v);
                      return (
                        <li key={b.k} ref={open ? openRow : undefined} className={`cur-mark ${open ? 'open' : ''} ${b.v}`}>
                          <button className="cur-mark-h" aria-expanded={open} title={b.k}
                            onClick={() => { if (open) setOpenK(null); else { setOpenK(b.k); cmd({ cmd: 'select', k: b.k }); } }}>
                            <span className={`st ${b.v || 'none'}`}>{li >= 0 ? <MarkIcon i={li} /> : null}</span>
                            <span className="nm">{b.k.replace(/^[A-Z]\d*-/, '')}</span>
                            {b.note && !open && <span className="has-note" title={b.note}>{tr('메모', 'Note')}</span>}
                            <svg className="chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 2.5 8 6l-3.5 3.5" /></svg>
                          </button>
                          {open && (
                            <div className="cur-mark-body">
                              <div className="btns">
                                {(st?.labels ?? []).map((l, i) => (
                                  <button key={l.v} className={`${l.v} ${b.v === l.v ? 'on' : ''}`} title={`${l.title} (${i + 1})`} aria-label={l.title}
                                    onClick={() => cmd({ cmd: 'mark', k: b.k, v: l.v })}><MarkIcon i={i} /><span>{l.title}</span></button>
                                ))}
                              </div>
                              <textarea ref={(el) => { if (el) notes.current.set(b.k, el); else notes.current.delete(b.k); }} rows={1} defaultValue={b.note}
                                placeholder={tr('메모 (M)', 'Note (M)')}
                                onInput={(e) => { const t = e.currentTarget.value; window.clearTimeout(noteT.current); noteT.current = window.setTimeout(() => cmd({ cmd: 'note', k: b.k, text: t }), 350); }}
                                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); e.currentTarget.blur(); } }} />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </aside>
      </div>
      {onSend && (
        <button className={`cur-send ${full ? 'full' : ''} ${sent}`} onClick={() => void send()} disabled={sent === 'sending'}
          aria-label={tr(`${sendTo}에게 결과 보내기`, `Send results to ${sendTo}`)}
          title={sent === 'sent' ? tr('보냈어', 'Sent') : sent === 'fail' ? tr('못 보냄 — 다시 누르기', 'Failed — press again') : tr(`${sendTo}에게 보내기 · ${done}/${total} 표시 — 다 안 봐도 보낼 수 있어`, `Send to ${sendTo} · ${done}/${total} marked`)}>
          {/* 글자 없이: 고리가 표시한 만큼 차고, 가운데 종이비행기, 개수는 작은 배지(2026-09-30 사용자 "텍스트 말고 아이콘") */}
          <span className="cur-send-ring" style={{ ['--p' as string]: `${pct}%` }}><span className="cur-send-plane"><IconSend /></span></span>
          <span className="cur-send-n">{sent === 'sent' ? '✓' : `${done}/${total}`}</span>
        </button>
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
