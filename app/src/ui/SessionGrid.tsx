import { useEffect, useRef, useState, type ReactNode } from 'react';
import { gridShape } from '../domain/adopt';
import { resizeTracks, tracksFor } from '../domain/gridSizing';
import { paneToFocus, visiblePanes, type LayoutAction, type PaneLayout } from '../domain/paneLayout';
import type { Session } from '../domain/session';
import { pasteSequence } from '../domain/memo';
import { enterDelay, typedChunks } from '../domain/chat';
import { escPlan, typeQueue } from '../domain/chatQueue';
import { AdoptCard } from './AdoptCard';
import { statusKind } from '../domain/statusMark';
import { IconChat, IconClose, IconExpand, IconMaximize, IconPlus, IconTerminal } from './Icons';
import { OrchName, useOrchActions } from './orchActions';
import { StatusMark } from './StatusMark';
import { PaneControls } from './PaneControls';
import { TerminalPane, type PaneApi } from './TerminalPane';
import { ChatView } from './chat/ChatView';
import { assistant, tr } from '../i18n';
import { attachCommand } from '../domain/termCommand';
import { keyLabel } from '../domain/keys';
import { IS_WIN } from '../domain/reader';
import { runModelPick } from './chat/modelPickRun';
import { claudeDefaults, pickLog } from '../data/tauri';
import { OrchAvatar, avatarState, orchColor, useAvatars } from './avatar';
import { bodyColor } from '../domain/avatar';
import { useSpeaking } from './speakGlow';
import { ChatTabStrip } from './ChatTabStrip';
import { orchVars } from '../domain/orchTheme';

type Props = {
  /** 고정한 참모 창 id(고정 순서) — 채팅 탭이 끌어 둔 순서보다 앞 */
  pinnedIds?: string[];
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
  /** focusRequest 를 처리했으면 — 부르는 쪽이 비운다(한 번만, 다시 그려질 때 또 돌지 않게) */
  onFocusRequestDone?: (n: number) => void;
  /** 격자 이름(App 의 레이아웃 키) — ⌘₩ 가 지금 보이는 창을 DOM 에서 찾는다 */
  gridId?: string;
  /** 끄기 — App 이 화면에서 먼저 치우고 뒤에서 끈다 */
  /** why = 누른 길(actions.log) */
  onStop: (s: Session, why: string) => void;
  /** 창 제목. 기본은 프로젝트(/ worktree), 비서 화면은 세션 이름 */
  titleOf?: (s: Session) => string;
  /** 칸 머리 이름 옆 회색 한 줄(참모 맡은 일) — 없으면 진짜 이름(titleOf 를 안 줄 때만) */
  subOf?: (s: Session) => string | undefined;
  /** 채팅 대화 사이에 끼울 것(직접 답하기 카드) — 참모 채팅만 */
  extraOf?: (s: Session) => { ts: string; key: string; pin?: boolean; clip?: boolean; node: ReactNode }[];
  memo?: MemoHooks;
  /** 채팅 탭 줄 끝의 + — 참모 하나 더(⌘T) */
  onAdd?: () => void;
  /** 한 열로 세로 쌓기 — 사무실 모드 오른쪽 대화 세션 열 */
  column?: boolean;
  /** 스페이스 모드 — 창마다 터미널 위에 채팅 판(터미널은 뒤에 붙어 있다). tabs 면 탭 줄 + 한 번에 한 창 */
  chat?: 'stack' | 'tabs';
  /** 세션마다 컨텍스트 쓴 % — 채팅 입력칸 위 고리 */
  ctxOf?: (s: Session) => number | undefined;
  /** 채팅 머리줄 칩용 모델·에포트 */
  modelOf?: (s: Session) => { model?: string; modelId?: string; effort?: string } | undefined;
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

/** 세션별 앱 치기 줄(domain/chatQueue typeQueue)과 마지막 Esc 시각 — 치는 중엔 다음 글·Esc 가 끼어들지 않게(2026-10-06 보내는 중 유령).
 *  실제 치기는 Rust pty_type 이 TYPE_LOCK 을 잡고 한다 — 스페이스·카드 답장·폰이 같은 순간 쳐도 한 입력칸에 안 섞인다 */
const typing = typeQueue();
const escAt = new Map<string, number>();

/** 채팅 보내기 — 사람이 치듯 조각으로 넣고 0.4초 쉬었다가 Enter(붙여넣기로 감싸면 긴 글이 "붙여넣은 글"로 간다, domain/chat typedChunks).
 *  앞 글을 아직 치는 중이면 그 Enter 뒤에 친다 — 0.4초 안에 두 번 보내면 두 글이 한 입력칸에 붙어 한 말로 갔다.
 *  enter=false 면 입력칸에 넣기만(빼고 남은 말 되돌려 놓기) */
function typeAndSend(id: string, api: PaneApi | undefined, text: string, enter = true) {
  if (!api) return;
  void typing.push(id, () => api.type(typedChunks(text), enter ? enterDelay(text.length, IS_WIN) : undefined));
}

/** 입력칸 지우기(백스페이스 n개) — 앞 글을 치는 중이면 그 뒤에. 지운 뒤 칠 글은 typeAndSend 가 다시 이 뒤에 줄 선다 */
function clearInput(id: string, api: PaneApi | undefined, n: number) {
  if (!api) return;
  void typing.push(id, () => api.type(['\x7f'.repeat(n)]));
}

/** 세션에 Esc 한 번 — Claude 는 쉴 때 Esc 두 번을 '입력칸 지우기'로 받아 걸린 말이 흔적 없이 지워졌다. 거른 건 false(domain/chatQueue escPlan) */
function escOnce(id: string, api: PaneApi | undefined): boolean {
  const now = Date.now();
  if (!api || !escPlan(now, escAt.get(id) ?? 0, typing.busyUntil(id))) return false;
  escAt.set(id, now);
  void typing.push(id, () => api.type(['\x1b']));
  return true;
}
const cumulative = (fr: number[]) => {
  const total = fr.reduce((a, b) => a + b, 0);
  let acc = 0;
  return fr.slice(0, -1).map((f) => (acc += f) / total);
};

/**
 * 세션 여러 개를 격자로 + 접은 창은 아래 띠. 띠의 창은 attach 를 떼어 둔다(메모리).
 * 경계선을 끌면 열·줄 비율이 바뀌고, 머리줄을 끌어 다른 창에 놓으면 자리가 바뀐다
 */
export function SessionGrid({ extraOf, sessions, claudeBin, layout, dispatch, onMessage, fontSize, home, onFocusSession, initialFocus, focusRequest, onFocusRequestDone, gridId, onStop, titleOf = paneTitle, subOf, memo, column, chat, ctxOf, modelOf, onAdd, pinnedIds = [] }: Props) {
  const speaking = useSpeaking(); // 음성 모드에서 지금 소리 내는 참모 — 그 채팅 탭 둘레만 빛난다(칸·프사·왼쪽 목록은 뺐다, 2026-10-03 사용자)
  const panes = useRef(new Map<string, PaneApi>());
  // 모델 칩 — 바꾸는 동안 지금 모델·에포트(상태줄)를 새로 읽게(일하는 중엔 화면 글로는 끝을 못 알아본다)
  const modelOfRef = useRef(modelOf);
  modelOfRef.current = modelOf;
  // 개발판에서만 — 시험 도구가 창 화면을 읽고 키를 넣게(모델 칩 실측, 2026-10-01)
  if (import.meta.env.DEV) (window as unknown as { __panes?: unknown }).__panes = panes.current;
  // 채팅 판: 터미널로 돌려 본 창들, 창마다 채팅 입력칸 포커스
  const [termView, setTermView] = useState<Set<string>>(() => new Set());
  const chatOn = (id: string) => !!chat && !termView.has(id);
  const chatFocus = useRef(new Map<string, () => void>());
  // 채팅 판이면 입력칸, 아니면 터미널. `f?.() ?? 터미널` 로 쓰면 입력칸 focus() 가 undefined 를 돌려줘 뒤에 숨은 터미널이
  // 포커스를 다시 가져갔다 — 탭을 바꿔도 입력칸에 커서가 안 갔다(2026-09-30 사용자)
  const focusPane = (id: string) => {
    const f = chatOn(id) ? chatFocus.current.get(id) : undefined;
    if (f) f();
    else panes.current.get(id)?.focus();
  };
  // 처음엔 이 격자에서 마지막으로 누른 창(App focusedBy) — 화면을 떠났다 돌아와 다시 그려질 때 첫 탭으로 떨어져 스페이스까지 끌려갔다(2026-10-06)
  const [tab, setTab] = useState<string | null>(initialFocus ?? null);
  // 지구본 키 말하기가 끝난 창 — 채팅 판이 4초 뒤에도 받아 적은 글이 남아 있으면 대신 Enter(autoSubmit 이 가끔 안 보냈다)
  const [voiceStops, setVoiceStops] = useState<Record<string, number>>({});
  const showTerm = (id: string, on: boolean) => setTermView((v) => { const n = new Set(v); if (on) n.add(id); else n.delete(id); return n; });
  // 메모판이 닫히면(⌘M·X·Esc·보내기 무엇이든) 그 창 터미널로 포커스를 돌려준다 — 안 그러면 창을 다시 눌러야 입력된다
  const memoWas = useRef<string | null>(null);
  const memoNow = memo?.openId ?? null;
  useEffect(() => {
    const was = memoWas.current;
    memoWas.current = memoNow;
    if (was && was !== memoNow) focusPane(was);
  }, [memoNow]);
  // 키 입력을 받을 창: 마지막으로 누른 창을 들고 있다가 크게·되돌리기·화면 복귀 때 다시 준다(버튼을 누르면 포커스가 버튼으로 가 버린다)
  const last = useRef<string | null>(initialFocus ?? null);
  const want = useRef<string | null>(initialFocus ?? null);
  const focusNow = (id: string | null) => {
    want.current = id;
    const api = id ? panes.current.get(id) : undefined;
    if (api && id) requestAnimationFrame(() => { focusPane(id); want.current = null; });
  };
  const wasMax = useRef<string | null>(layout.maximized ?? null);
  useEffect(() => {
    const prev = wasMax.current;
    wasMax.current = layout.maximized ?? null;
    if (prev === wasMax.current) return;
    focusNow(paneToFocus({ maximized: layout.maximized ?? null, wasMaximized: prev, last: last.current }));
  }, [layout.maximized]); // eslint-disable-line react-hooks/exhaustive-deps
  // 두 번째 포커스 시계는 요청이 비워져도(아래 onFocusRequestDone) 살아 있어야 한다 — 격자가 사라질 때만 끈다
  const again = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(again.current), []);
  useEffect(() => {
    if (!focusRequest) return;
    const { id, n } = focusRequest;
    last.current = id;
    setTab(id); // 탭 보기면 그 탭으로(⌘1~9·세션으로 가기)
    if (chat === 'tabs') window.dispatchEvent(new CustomEvent('chat-tab-pick', { detail: id })); // 스페이스도 그 참모 대시보드로
    focusNow(id);
    window.clearTimeout(again.current);
    again.current = window.setTimeout(() => focusPane(id), 250); // 알림을 눌러 창이 앞으로 오는 중이면 첫 포커스가 씹힌다
    onFocusRequestDone?.(n);
  }, [focusRequest?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(sessions.map((s) => [s.id, s]));
  // 채팅 뷰 참모 탭: 끄기·이름 바꾸기(탭 보기일 때만)
  const actions = useOrchActions();
  const orch = chat === 'tabs' ? actions : null;
  const { saved: avatars } = useAvatars();
  /** 참모 색 — 프사에서 고른 색, 없으면 순서 색(사이드바와 같은 순서) */
  const colorOfOrch = (x: Session) => bodyColor(avatars, x.name || '', orchColor(x.name || ''));
  // 고정한 참모 탭은 끌어 둔 순서보다 앞 — 들어온 sessions 가 이미 고정 순서라 그 순서대로(App pinFirst)
  const vis = visiblePanes(sessions.map((s) => s.id), layout, pinnedIds);
  // 탭 보기: 펼친 창 중 고른 하나만 보인다. 나머지도 같은 칸 뒤에 붙여 둔 채 숨긴다 — 떼었다 다시 붙이면
  // 탭을 바꿀 때마다 attach·대화 다시 읽기로 한 박자 늦었다(2026-09-30 사용자 "채팅 1,2 로 갈 때 딜레이")
  const active = vis.shown.includes(tab ?? '') ? tab! : vis.shown[0] ?? null;
  const tabbed = chat === 'tabs' && !!active;
  // 켜진 탭을 위에도 알린다 — 누르기 전(앱을 막 켰을 때)엔 스페이스가 첫 참모를 따라가서, 보이는 탭과 스페이스 참모가 어긋났다(2026-09-30)
  const told = useRef<string | null>(null);
  useEffect(() => { if (tabbed && active && told.current !== active) { told.current = active; onFocusSession?.(active); } }, [tabbed, active]); // eslint-disable-line react-hooks/exhaustive-deps
  const { shown, strip } = tabbed ? { shown: [active!], strip: vis.strip } : vis;
  const drawn = tabbed ? vis.shown : shown;
  const { cols, rows } = column ? { cols: shown.length ? 1 : 0, rows: shown.length } : gridShape(shown.length);
  const colFr = tracksFor(layout.cols, cols);
  const rowFr = tracksFor(layout.rows, rows);
  const box = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const stop = async (s: Session) => {
    dispatch({ type: 'forget', id: s.id });
    onStop(s, 'pane-button');
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

  const body = (
    <>
      {chat === 'tabs' && vis.shown.length > 0 && ( /* 하나여도 늘 — 둘이 되는 순간 생기며 화면을 밀었다 */
        <ChatTabStrip active={active} count={vis.shown.length} add={onAdd && (
          <button className="tab-add" onClick={onAdd} title={tr(`${assistant()} 하나 더 (⌘T)`, `One more ${assistant()} (⌘T)`)} aria-label={tr(`${assistant()} 하나 더`, `One more ${assistant()}`)}><IconPlus /></button>
        )}>
          {vis.shown.map((id, i) => {
            const s = byId.get(id)!;
            return (
              <button key={id} role="tab" aria-selected={id === active} className={`${id === active ? 'on' : ''}${speaking === id ? ' st-speak' : ''}`} style={orch ? orchVars(colorOfOrch(s)) as React.CSSProperties : undefined} title={[subOf?.(s), i < 9 ? `${keyLabel(`⌘${i + 1}`, IS_WIN)} · ${tr('두 번 눌러 이름 바꾸기', 'double-click to rename')}` : undefined].filter(Boolean).join('\n') || undefined}
                onClick={() => { setTab(id); last.current = id; onFocusSession?.(id); window.dispatchEvent(new CustomEvent('chat-tab-pick', { detail: id })); requestAnimationFrame(() => focusPane(id)); window.setTimeout(() => focusPane(id), 180); /* 스페이스가 바뀌며 포커스를 뺏을 수 있어 한 번 더 — 탭을 바꾸면 입력칸에 바로(2026-09-30 사용자) */ }}
                onDoubleClick={() => orch?.askRename(s)} onContextMenu={orch ? (e) => orch.menu(e, s, orchColor(s.name || '')) : undefined}>
                {orch ? <OrchAvatar name={s.name || ''} size={18} state={avatarState(s)} color={orchColor(s.name || '')} label={orch.nameOf(s)} /> : <StatusMark kind={statusKind(s.state)} />}{orch ? <OrchName s={s} className="ct-nm" /> : <span className="ct-nm">{titleOf(s)}</span>}
                {orch && s.kind === 'background' && (
                  <span className="tab-x" role="button" aria-label={tr('세션 끄기', 'Stop session')} title={tr('세션 끄기(⌘W)', 'Stop session (⌘W)')}
                    onClick={(e) => { e.stopPropagation(); orch.askStop(s, undefined, 'pane-x'); }}><IconClose /></span>
                )}
              </button>
            );
          })}
        </ChatTabStrip>
      )}
      {shown.length > 0 ? (
        <div className="gridbox" ref={box} data-grid={gridId}>
          <div
            className="grid"
            style={{
              gridTemplateColumns: colFr.map((f) => `minmax(0, ${f}fr)`).join(' '),
              gridTemplateRows: rowFr.map((f) => `minmax(0, ${f}fr)`).join(' '),
            }}
          >
            {drawn.map((id) => {
              const s = byId.get(id)!;
              const behind = tabbed && id !== active;
              const controls = (
                <PaneControls
                  maximized={layout.maximized === id}
                  onMaximize={() => dispatch({ type: 'maximize', id })}
                  onRestore={() => dispatch({ type: 'restore' })}
                  onCollapse={() => dispatch({ type: 'collapse', id })}
                  onStop={s.kind === 'background' && !chat ? () => stop(s) : undefined}
                  compact={!!chat}
                />
              );
              const withChat = chat && s.kind === 'background' ? (
                <>
                  <button className="ib" aria-label={chatOn(id) ? tr('터미널 화면으로', 'Show the terminal') : tr('채팅 화면으로', 'Show the chat')} title={chatOn(id) ? tr('터미널 화면으로', 'Show the terminal') : tr('채팅 화면으로', 'Show the chat')}
                    onClick={() => { showTerm(id, chatOn(id)); requestAnimationFrame(() => focusPane(id)); }}>
                    {chatOn(id) ? <IconTerminal /> : <IconChat />}
                  </button>
                  {controls}
                </>
              ) : controls;
              return (
                <div key={id} data-session={id} className={`cell ${over === id ? 'over' : ''} ${dragging === id ? 'dragging' : ''} ${behind ? 'behind' : ''}`} {...cellDrop(id)}
                  style={{ ...(tabbed ? { gridArea: '1 / 1 / 2 / 2' } : {}), ...(chat ? orchVars(colorOfOrch(s)) : {}) } as React.CSSProperties} aria-hidden={behind || undefined}>
                  {s.kind === 'background' ? (
                    <TerminalPane
                      command={attachCommand(claudeBin, id)}
                      title={titleOf(s)}
                      subPlain={!!subOf}
                      subtitle={subOf ? subOf(s) : titleOf === paneTitle ? s.name : undefined} /* 이름을 따로 주는 칸(참모 등)은 그 이름만 — 진짜 이름엔 번호가 있다(2026-10-02). 참모는 맡은 일 */
                      controls={withChat}
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
                      onVoiceStop={chat ? () => setVoiceStops((v) => ({ ...v, [id]: (v[id] ?? 0) + 1 })) : undefined}
                      overlay={!chatOn(id) && memo?.openId !== id ? null : <>{/* 메모판은 채팅 위에 덮는다 — 예전엔 메모를 열면 채팅을 빼서 뒤 터미널이 드러났다(2026-10-01 사용자) */}{chatOn(id) ? (
                        <ChatView
                          extra={extraOf?.(s)}
                          fontSize={fontSize}
                          sessionId={s.sessionId}
                          ctx={ctxOf?.(s)}
                          modelInfo={modelOf?.(s)}
                          cwd={s.cwd}
                          pickModel={async (want) => {
                            const api = panes.current.get(id);
                            if (!api) return { ok: false as const, why: tr('터미널이 아직 안 붙었어요', 'Terminal not attached yet') };
                            const r = await runModelPick(api, want, { id, defaults: claudeDefaults, current: () => modelOfRef.current?.(s) });
                            // 못 바꿨으면 그때 화면을 로그로 남기고 칩 옆에 이유만 — 터미널로 넘기지 않는다(2026-10-01 사용자 "완벽하게 UI 로만")
                            if (!r.ok) void pickLog(`--- ${new Date().toISOString()} ${s.name} want=${JSON.stringify(want)} why=${r.why}\n${(r.screen ?? []).join('\n')}`).catch(() => {});
                            return r;
                          }}
                          state={s.state}
                          send={(text) => {
                            typeAndSend(id, panes.current.get(id), text);
                            last.current = id;
                            onFocusSession?.(id);
                          }}
                          interrupt={() => escOnce(id, panes.current.get(id))}
                          rawKeys={async (seq) => { for (const k of seq) { panes.current.get(id)?.raw(k); await new Promise((r) => setTimeout(r, 120)); } }}
                          onTerminal={() => showTerm(id, true)}
                          onInputFocus={() => panes.current.get(id)?.claimPtt()}
                          screen={() => panes.current.get(id)?.screen()}
                          submitTerminal={() => panes.current.get(id)?.raw('\r')}
                          pasteImage={() => panes.current.get(id)?.raw('\x16')}
                          voiceStop={voiceStops[id] ?? 0}
                          paneId={id}
                          clearTerminal={(n) => clearInput(id, panes.current.get(id), n)}
                          sendQueuedNow={() => escOnce(id, panes.current.get(id))} // 멈추면 Claude 가 줄 선 말을 곧바로 보낸다(2026-09-30 시험 세션 실측)
                          typeOnly={(text) => typeAndSend(id, panes.current.get(id), text, false)}
                          focusRef={(fn) => { if (fn) chatFocus.current.set(id, fn); else chatFocus.current.delete(id); }}
                        />
                      ) : null}{memo?.openId === id && memo.panel(s, (text) => panes.current.get(id)?.write(pasteSequence(text)))}</>}
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
  // 탭 보기 — 탭 줄과 창을 한 덩어리로 묶어, 고른 창 테두리가 탭까지 이어지게(2026-09-30 사용자)
  return chat === 'tabs' ? <div className="tabbed">{body}</div> : body;
}
