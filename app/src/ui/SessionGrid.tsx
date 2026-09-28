import { useEffect, useRef, useState, type ReactNode } from 'react';
import { gridShape } from '../domain/adopt';
import { resizeTracks, tracksFor } from '../domain/gridSizing';
import { paneToFocus, visiblePanes, type LayoutAction, type PaneLayout } from '../domain/paneLayout';
import type { Session } from '../domain/session';
import { pasteSequence } from '../domain/memo';
import { AdoptCard } from './AdoptCard';
import { statusKind } from '../domain/statusMark';
import { IconExpand, IconMaximize } from './Icons';
import { StatusMark } from './StatusMark';
import { PaneControls } from './PaneControls';
import { TerminalPane, type PaneApi } from './TerminalPane';
import { tr } from '../i18n';

type Props = {
  sessions: Session[];
  claudeBin: string;
  layout: PaneLayout;
  dispatch: (a: LayoutAction) => void;
  onMessage: (m: string | null) => void;
  fontSize: number;
  home?: string;
  onFocusSession?: (id: string) => void;
  /** 이 화면에서 마지막으로 누른 창 — ⌘1·⌘2 로 돌아오면 그 창이 바로 입력을 받는다 */
  initialFocus?: string;
  /** "그 세션으로 가기" — n 이 바뀌면 그 창에 포커스(창이 앞으로 오는 사이 한 번 더 준다) */
  focusRequest?: { id: string; n: number };
  /** 격자 이름(App 의 레이아웃 키) — ⌘Enter 가 지금 보이는 창을 DOM 에서 찾는다 */
  gridId?: string;
  /** 끄기 — App 이 화면에서 먼저 치우고 뒤에서 끈다 */
  onStop: (s: Session) => void;
  /** 창 제목. 기본은 프로젝트(/ worktree), 비서 화면은 세션 이름 */
  titleOf?: (s: Session) => string;
  memo?: MemoHooks;
  /** 한 열로 세로 쌓기 — 사무실 모드 오른쪽 대화 세션 열 */
  column?: boolean;
};

/** 창마다 메모: 머리줄 최근 한 줄 + 열린 창(openId) 위에 메모판. send 는 그 창 입력칸에 붙여넣기 */
export type MemoHooks = {
  note: (s: Session) => string | undefined;
  openId: string | null;
  onToggle: (id: string) => void;
  panel: (s: Session, send: (text: string) => void) => ReactNode;
};

export const paneTitle = (s: Session) => (s.workspace ? `${s.project} / ${s.workspace}` : s.project);

const DRAG_MIME = 'text/x-orch-pane';
const cumulative = (fr: number[]) => {
  const total = fr.reduce((a, b) => a + b, 0);
  let acc = 0;
  return fr.slice(0, -1).map((f) => (acc += f) / total);
};

/**
 * 세션 여러 개를 격자로 + 접은 창은 아래 띠. 띠의 창은 attach 를 떼어 둔다(메모리).
 * 경계선을 끌면 열·줄 비율이 바뀌고, 머리줄을 끌어 다른 창에 놓으면 자리가 바뀐다
 */
export function SessionGrid({ sessions, claudeBin, layout, dispatch, onMessage, fontSize, home, onFocusSession, initialFocus, focusRequest, gridId, onStop, titleOf = paneTitle, memo, column }: Props) {
  const panes = useRef(new Map<string, PaneApi>());
  // 메모판이 닫히면(⌘M·X·Esc·보내기 무엇이든) 그 창 터미널로 포커스를 돌려준다 — 안 그러면 창을 다시 눌러야 입력된다
  const memoWas = useRef<string | null>(null);
  const memoNow = memo?.openId ?? null;
  useEffect(() => {
    const was = memoWas.current;
    memoWas.current = memoNow;
    if (was && was !== memoNow) panes.current.get(was)?.focus();
  }, [memoNow]);
  // 키 입력을 받을 창: 마지막으로 누른 창을 들고 있다가 크게·되돌리기·화면 복귀 때 다시 준다(버튼을 누르면 포커스가 버튼으로 가 버린다)
  const last = useRef<string | null>(initialFocus ?? null);
  const want = useRef<string | null>(initialFocus ?? null);
  const focusNow = (id: string | null) => {
    want.current = id;
    const api = id ? panes.current.get(id) : undefined;
    if (api) requestAnimationFrame(() => { api.focus(); want.current = null; });
  };
  const wasMax = useRef<string | null>(layout.maximized ?? null);
  useEffect(() => {
    const prev = wasMax.current;
    wasMax.current = layout.maximized ?? null;
    if (prev === wasMax.current) return;
    focusNow(paneToFocus({ maximized: layout.maximized ?? null, wasMaximized: prev, last: last.current }));
  }, [layout.maximized]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focusRequest) return;
    last.current = focusRequest.id;
    focusNow(focusRequest.id);
    const again = setTimeout(() => panes.current.get(focusRequest.id)?.focus(), 250); // 알림을 눌러 창이 앞으로 오는 중이면 첫 포커스가 씹힌다
    return () => clearTimeout(again);
  }, [focusRequest?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const { shown, strip } = visiblePanes(sessions.map((s) => s.id), layout);
  const { cols, rows } = column ? { cols: shown.length ? 1 : 0, rows: shown.length } : gridShape(shown.length);
  const colFr = tracksFor(layout.cols, cols);
  const rowFr = tracksFor(layout.rows, rows);
  const box = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const stop = async (s: Session) => {
    dispatch({ type: 'forget', id: s.id });
    onStop(s);
  };

  // 경계선 끌기: 시작 비율을 들고 있다가 움직인 거리(전체 대비)만큼 두 칸이 주고받는다
  const startResize = (axis: 'cols' | 'rows', i: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    const el = box.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const size = axis === 'cols' ? rect.width : rect.height;
    const start = axis === 'cols' ? e.clientX : e.clientY;
    const base = axis === 'cols' ? colFr : rowFr;
    document.body.classList.add(axis === 'cols' ? 'resizing-x' : 'resizing-y');
    const move = (ev: MouseEvent) => {
      const d = ((axis === 'cols' ? ev.clientX : ev.clientY) - start) / size;
      dispatch({ type: 'resize', axis, tracks: resizeTracks(base, i, d) });
    };
    const up = () => {
      document.body.classList.remove('resizing-x', 'resizing-y');
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  };

  const headDrag = (id: string) => ({
    draggable: shown.length > 1,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(DRAG_MIME, id);
      e.dataTransfer.setData('text/plain', id); // 사파리 계열은 데이터가 있어야 끌기가 시작된다
      e.dataTransfer.effectAllowed = 'move';
      setDragging(id);
    },
    onDragEnd: () => {
      setDragging(null);
      setOver(null);
    },
  });

  const cellDrop = (id: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragging || dragging === id) return;
      e.preventDefault();
      setOver(id);
    },
    onDragLeave: () => setOver((o) => (o === id ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const from = e.dataTransfer.getData(DRAG_MIME) || dragging;
      if (from && from !== id) dispatch({ type: 'reorder', ids: sessions.map((s) => s.id), from, to: id });
      setDragging(null);
      setOver(null);
    },
  });

  return (
    <>
      {shown.length > 0 ? (
        <div className="gridbox" ref={box} data-grid={gridId}>
          <div
            className="grid"
            style={{
              gridTemplateColumns: colFr.map((f) => `minmax(0, ${f}fr)`).join(' '),
              gridTemplateRows: rowFr.map((f) => `minmax(0, ${f}fr)`).join(' '),
            }}
          >
            {shown.map((id) => {
              const s = byId.get(id)!;
              const controls = (
                <PaneControls
                  maximized={layout.maximized === id}
                  onMaximize={() => dispatch({ type: 'maximize', id })}
                  onRestore={() => dispatch({ type: 'restore' })}
                  onCollapse={() => dispatch({ type: 'collapse', id })}
                  onStop={s.kind === 'background' ? () => stop(s) : undefined}
                />
              );
              return (
                <div key={id} data-session={id} className={`cell ${over === id ? 'over' : ''} ${dragging === id ? 'dragging' : ''}`} {...cellDrop(id)}>
                  {s.kind === 'background' ? (
                    <TerminalPane
                      command={`exec '${claudeBin}' attach ${id}`}
                      title={titleOf(s)}
                      subtitle={s.name}
                      controls={controls}
                      fontSize={fontSize}
                      headDrag={headDrag(id)}
                      linkBase={s.cwd}
                      home={home}
                      onFocus={() => { last.current = id; onFocusSession?.(id); }}
                      note={memo?.note(s)}
                      onNoteClick={memo ? () => memo.onToggle(id) : undefined}
                      inject={(api) => {
                        if (!api) { panes.current.delete(id); return; }
                        panes.current.set(id, api);
                        if (want.current === id) focusNow(id); // 새로 붙은 창(화면 복귀·되돌리기)이 기다리던 창이면
                      }}
                      overlay={memo?.openId === id ? memo.panel(s, (text) => panes.current.get(id)?.write(pasteSequence(text))) : null}
                    />
                  ) : (
                    <AdoptCard session={s} title={titleOf(s)} onDone={onMessage} />
                  )}
                </div>
              );
            })}
          </div>
          {cumulative(colFr).map((at, k) => (
            <div key={`c${k}`} className="gutter-x" style={{ left: `calc(6px + (100% - 12px) * ${at})` }} onMouseDown={startResize('cols', k + 1)} />
          ))}
          {cumulative(rowFr).map((at, k) => (
            <div key={`r${k}`} className="gutter-y" style={{ top: `calc(6px + (100% - 12px) * ${at})` }} onMouseDown={startResize('rows', k + 1)} />
          ))}
        </div>
      ) : (
        <div className="empty"><b>{tr('창을 전부 접어 뒀어', 'All panes are collapsed')}</b><span>{tr('아래 띠에서 펼치면 다시 붙어', 'Expand one from the strip below to reattach')}</span></div>
      )}
      {strip.length > 0 && (
        <div className="strip">
          <span className="dim">{tr('접은 창', 'Collapsed')} {strip.length}</span>
          {strip.map((id) => {
            const s = byId.get(id)!;
            return (
              <span key={id} className="chip">
                <StatusMark kind={statusKind(s.state)} />
                <b>{titleOf(s)}</b>
                <button className="ib" title={tr('펼치기', 'Expand')} aria-label={tr('펼치기', 'Expand')} onClick={() => dispatch({ type: 'expand', id })}><IconExpand /></button>
                <button className="ib" title={tr('크게', 'Maximize')} aria-label={tr('크게', 'Maximize')} onClick={() => dispatch({ type: 'maximize', id })}><IconMaximize /></button>
              </span>
            );
          })}
        </div>
      )}
    </>
  );
}
