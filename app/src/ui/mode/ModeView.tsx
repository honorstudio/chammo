// 참모 모드 한 칸 — 따로 창(mode.html)과 스페이스 패널이 같이 쓴다. 띠(AbovePrompt) + 칸(Pane) 탭 + 상태줄·토스트.
// Rust(modes_host)가 밀림을 window.__mode 로 넘기면 다시 그린다(폴링 없음). 창이 늦게 떠도 상태는 mode_state 로 다시 읽는다
import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { tr } from '../../i18n';
import { cellsOf, modeNote, normalize, staleParts, type Act, type HostState, type TNode } from '../../domain/modeTree';
import { openTarget } from '../../data/tauri';
import { Node, type Drafts } from './ModeTree';
import { ModeCtx } from './ModeClient';
import { MODE_EVENT, type ModeMsg } from './modeBus';
import './mode.css';

const EMPTY: HostState = { alive: false, ready: false, unsupported: false, error: null };
type Toast = { id: number; text: string };

export function ModeView({ name, compact }: { name: string; /** 패널 — 머리줄 없이 좁게 */ compact?: boolean }) {
  const [st, setSt] = useState<HostState>(EMPTY);
  const [band, setBand] = useState<TNode | null>(null);
  const [pane, setPane] = useState<TNode | null>(null);
  // Client 칸의 모듈 해시(ui_render client_modules) — 바뀌면 방을 새로 띄운다
  const [hashes, setHashes] = useState<{ band: Record<string, string>; pane: Record<string, string> }>({ band: {}, pane: {} });
  const [tab, setTab] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const cells = useRef({ columns: 60, rows: 20 });
  const drafts = useRef<Drafts>(new Map()).current;
  const tabRef = useRef(tab);
  const paneId = useRef<string | null>(null);
  tabRef.current = tab;

  const readState = useCallback(() => invoke<HostState>('mode_state', { name }).then(setSt, () => {}), [name]);

  // 띠를 그리는 훅이 없다고 답했으면(hooked:false) 다음 전체 밀림까지 안 묻는다 — 밀림마다 빈 요청이 한 번씩 돌았다
  const bandOff = useRef(false);
  const draw = useCallback(async (want: { band: boolean; pane: boolean }) => {
    const { columns, rows } = cells.current;
    const s = await invoke<HostState>('mode_state', { name }).catch(() => EMPTY);
    setSt(s);
    if (!s.ready) return;
    const id = tabRef.current ?? s.shown ?? s.panes?.[0]?.id ?? null;
    type Drawn = { node: TNode; hashes: Record<string, string> };
    const one = (component: string, instance: string) =>
      invoke<{ tree?: unknown; client_modules?: Record<string, string>; hooked?: boolean }>('mode_render', { name, component, instance, columns, rows })
        .then((r): Drawn => {
          if (component === 'AbovePrompt' && r?.hooked === false) bandOff.current = true;
          return { node: normalize(r?.tree), hashes: r?.client_modules ?? {} };
        });
    // 칸 id 가 바뀌었으면(탭·모드가 연 칸) 칸은 꼭 다시
    const doPane = want.pane || id !== paneId.current;
    const doBand = want.band && !bandOff.current;
    try {
      const [b, p] = await Promise.all([doBand ? one('AbovePrompt', 'above-prompt').catch(() => null) : Promise.resolve(undefined), doPane ? (id ? one('Pane', id) : Promise.resolve(null)) : Promise.resolve(undefined)]);
      if (b !== undefined) setBand(bandOff.current ? null : b?.node ?? null);
      if (p !== undefined) setPane(p?.node ?? null);
      setHashes((h) => ({ band: b === undefined ? h.band : b?.hashes ?? {}, pane: p === undefined ? h.pane : p?.hashes ?? {} }));
      paneId.current = id;
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }, [name]);

  // 밀림이 몰려도 한 번만 그린다 — 몰린 동안 다시 그릴 칸은 합친다
  const pending = useRef<number | undefined>(undefined);
  const want = useRef({ band: false, pane: false });
  const redraw = useCallback((parts: { band: boolean; pane: boolean } = { band: true, pane: true }) => {
    want.current = { band: want.current.band || parts.band, pane: want.current.pane || parts.pane };
    window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => { const w = want.current; want.current = { band: false, pane: false }; void draw(w); }, 30);
  }, [draw]);

  useEffect(() => {
    const on = (e: Event) => {
      const m = (e as CustomEvent<ModeMsg>).detail;
      if (m?.name !== name) return;
      const k = m.ev?.subtype;
      if (k === 'ui_toast' && m.ev.text) {
        const id = Date.now() + Math.random();
        setToasts((t) => [...t.slice(-2), { id, text: m.ev.text! }]);
        window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), Math.min(Math.max(m.ev.timeout_ms ?? 4000, 1500), 15000));
      } else if (k === 'ui_status' || k === 'exit' || k === 'closed' || k === 'asleep') {
        void readState();
      } else if (k === 'ui_invalidate') {
        // instances 가 있으면 그 칸만(상태 쓰기·Client 고장), 없으면 다 — 그땐 띠 훅이 새로 생겼을 수도 있어 다시 묻는다
        if (!Array.isArray(m.ev.instances)) bandOff.current = false;
        redraw(staleParts(m.ev, { band: true, pane: paneId.current }));
      } else {
        redraw(); // ready·place·ui_panes
      }
    };
    window.addEventListener(MODE_EVENT, on);
    redraw();
    return () => window.removeEventListener(MODE_EVENT, on);
  }, [name, redraw, readState]);

  // 이 칸이 보이나 — 재워도 되는 모드(keepAlive:false)는 보는 칸이 다 사라진 지 5분이면 앱이 재우고, 다시 보이면 깨운다(modes_host sweep)
  useEffect(() => {
    let counted = false;
    const set = (on: boolean) => {
      if (on === counted) return;
      counted = on;
      void invoke('mode_seen', { name, on }).catch(() => {});
    };
    const vis = () => set(document.visibilityState === 'visible');
    vis();
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); set(false); };
  }, [name]);

  // 칸 크기 → 글자 칸. 바뀌면 모드가 크기에 맞춰 다시 그리게
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(([x]) => {
      if (!x) return;
      const c = cellsOf(x.contentRect.width, x.contentRect.height);
      if (c.columns !== cells.current.columns || c.rows !== cells.current.rows) {
        cells.current = c;
        redraw();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [redraw]);

  useEffect(() => { redraw({ band: false, pane: true }); }, [tab, redraw]);

  const act = (a: Act) => {
    // 다시 그리기는 모드의 밀림(ui_invalidate)이 부른다 — 손잡이가 낡아 안 닿았을 때(handled:false)만 여기서 다시(규약: 그 트리는 낡았다)
    void invoke<{ handled?: boolean }>('mode_act', { name, act: a }).then((r) => { if (!r?.handled) redraw(); }, (e) => setErr(String(e)));
  };

  const note = modeNote(st);
  const panes = st.panes ?? [];
  const shown = tab ?? st.shown ?? panes[0]?.id ?? null;
  return (
    <div className={`mdv ${compact ? 'compact' : ''}`} ref={root}>
      {note === 'unsupported' && <div className="mdv-note">{tr('이 Claude Code 판에선 모드를 못 그려요', "This Claude Code version can't draw modes")}</div>}
      {note === 'stopped' && (
        <div className="mdv-note">
          <span>{tr('모드가 멈췄어', 'The mode stopped')}</span>
          <button className="btn" onClick={() => void invoke('mode_restart', { name }).catch(() => {})}>{tr('다시 켜기', 'Restart')}</button>
          {st.log && <button className="mdv-plain mdv-log" onClick={() => void openTarget('file', st.log!).catch(() => {})} title={st.log}>{tr('로그', 'Log')}</button>}
        </div>
      )}
      {note === 'starting' && <div className="mdv-note quiet"><span className="spin" /> {tr('모드 켜는 중', 'Starting the mode')}</div>}
      {note === 'ok' && (
        <>
          {panes.length > 1 && (
            <div className="mdv-tabs" role="tablist">
              {panes.map((p) => <button key={p.id} role="tab" aria-selected={p.id === shown} className={p.id === shown ? 'on' : ''} onClick={() => setTab(p.id)}>{p.title || p.id}</button>)}
            </div>
          )}
          <div className="mdv-body">
            {pane && <ModeCtx.Provider value={{ name, component: 'Pane', instance: paneId.current ?? '', hashes: hashes.pane }}><Node n={pane} onAct={act} drafts={drafts} /></ModeCtx.Provider>}
            {!pane && !band && <div className="mdv-note quiet">{tr('이 모드는 그릴 칸이 없어요', 'This mode has nothing to draw')}</div>}
          </div>
          {band && <div className="mdv-band"><ModeCtx.Provider value={{ name, component: 'AbovePrompt', instance: 'above-prompt', hashes: hashes.band }}><Node n={band} onAct={act} drafts={drafts} /></ModeCtx.Provider></div>}
          {err && <div className="mdv-note quiet" title={err}>{tr('못 그림', "Can't draw")} · {err.slice(0, 120)}</div>}
        </>
      )}
      {st.status && <div className="mdv-status">{st.status}</div>}
      {toasts.length > 0 && <div className="mdv-toasts">{toasts.map((t) => <div key={t.id} className="mdv-toast" role="status">{t.text}</div>)}</div>}
    </div>
  );
}
