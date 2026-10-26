import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { gridShape } from '../domain/adopt';
import { resizeTracks, tracksFor } from '../domain/gridSizing';
import { chatHeadPane, paneToFocus, visiblePanes, type LayoutAction, type PaneLayout } from '../domain/paneLayout';
import type { Session } from '../domain/session';
import { pasteSequence } from '../domain/memo';
import { enterDelay, typedChunks } from '../domain/chat';
import { enterTask, escPlan, typeQueue } from '../domain/chatQueue';
import { LINK_WAIT, paneLinks } from '../domain/paneLinks';
import type { LinkState } from '../domain/attachExit';
import { AdoptCard } from './AdoptCard';
import { statusKind } from '../domain/statusMark';
import { sessionStatus, type ActivityStatus } from '../domain/status';
import { IconChat, IconExpand, IconMaximize, IconTerminal } from './Icons';
import { StatusMark } from './StatusMark';
import { PaneControls } from './PaneControls';
import { NoteButton, TerminalPane, type PaneApi } from './TerminalPane';
import { ChatView } from './chat/ChatView';
import { tr } from '../i18n';
import { attachCommand } from '../domain/termCommand';
import { IS_WIN } from '../domain/reader';
import { runModelPick, type PickResult, type PickWant } from './chat/modelPickRun';
import { claudeDefaults, pickLog } from '../data/tauri';
import { orchColor, useAvatars } from './avatar';
import { bodyColor } from '../domain/avatar';
import { orchVars } from '../domain/orchTheme';

type Props = {
  /** 세션 판단(domain/status activityStatus) — 칸 머리 표시. 없으면 세션 목록만으로 */
  statusOf?: (s: Session) => ActivityStatus;
  /** 고정한 참모 창 id(고정 순서) — 채팅 탭이 끌어 둔 순서보다 앞 */
  pinnedIds?: string[];
  /** 순서를 밖에서 들고 있는 격자(참모 — domain/orchOrder) — 끌어 옮기면 격자 order 대신 이걸 부른다. ids = 지금 순서(sessions 순서) */
  onReorder?: (ids: string[], from: string, to: string) => void;
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
  /** 격자 이름(App 의 레이아웃 키) — ⌘⇧₩ 가 지금 보이는 창을 DOM 에서 찾는다 */
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
  /** 채팅 입력칸 위 한 줄(참모 깨우는 중) — 이 격자의 채팅 모두에 */
  chatNotice?: ReactNode;
  /** 한 열로 세로 쌓기 — 사무실 모드 오른쪽 대화 세션 열 */
  column?: boolean;
  /** 스페이스 모드 — 창마다 터미널 위에 채팅 판(터미널은 뒤에 붙어 있다). tabs 면 탭 줄 + 한 번에 한 창 */
  chat?: 'stack' | 'tabs';
  /** 세션마다 컨텍스트 쓴 % — 채팅 입력칸 위 고리 */
  ctxOf?: (s: Session) => number | undefined;
  /** 채팅 머리줄 칩용 모델·에포트 */
  modelOf?: (s: Session) => { model?: string; modelId?: string; effort?: string } | undefined;
  /** 채팅 칸 머리 자리(App space-chat-head) — 보이는 창 이름·맡은 일을 여기 올리고, 한 창만 보이면 단추도 올리고 칸 머리 줄은 숨긴다(2026-10-12 사용자) */
  headSlot?: HTMLElement | null;
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
/** 세션별 붙어 있는 보기 — 화면이 온(live) 뒤에만 넣고 끊기면(다시 붙는 중·참모를 다시 켜는 중) 뺀다.
 *  친 말은 그때 붙어 있는 보기에 — 끊긴 동안 친 말은 다시 붙을 때까지 줄에서 기다린다. 예전엔 누른 순간의 손잡이로 죽은 보기에 쳐서 허공으로 갔다(2026-10-21) */
const links = paneLinks<PaneApi>();
/** 붙은 보기에 치는 데 쓰는 최대 — 긴 글도 몇 초면 끝난다. 넘기면 버리고 다음 말로(채팅은 입력을 되살린다, 2026-10-24 윈도우 '어떤 말도 안 감') */
const TYPE_TIMEOUT = 30_000;
/** 다 쳤으면 true, 못 쳤으면(보기가 안 붙음·치기 거절·시간 넘김) false */
function typeAndSend(id: string, text: string, enter = true): Promise<boolean> {
  return typing.push(id, async () => {
    const api = await links.wait(id, LINK_WAIT);
    await api.type(typedChunks(text), enter ? enterDelay(text.length, IS_WIN) : undefined);
  }, LINK_WAIT + TYPE_TIMEOUT).then(() => true, () => false);
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
export function SessionGrid({ extraOf, sessions, claudeBin, layout, dispatch, onMessage, fontSize, home, onFocusSession, initialFocus, focusRequest, onFocusRequestDone, gridId, onStop, titleOf = paneTitle, subOf, memo, chatNotice, column, chat, ctxOf, modelOf, pinnedIds = [], onReorder, statusOf = sessionStatus, headSlot }: Props) {
  const panes = useRef(new Map<string, PaneApi>());
  // 모델 칩 — 바꾸는 동안 지금 모델·에포트(상태줄)를 새로 읽게(일하는 중엔 화면 글로는 끝을 못 알아본다)
  const modelOfRef = useRef(modelOf);
  modelOfRef.current = modelOf;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  // 모델·에포트 바꾸기 — 채팅 칩과 폰 칩(phone-model-pick)이 같은 길: /model·/effort 를 치고 ~/.claude/settings.json 기본값은 되돌린다(runModelPick)
  const pickFor = async (id: string, s: Session, want: PickWant): Promise<PickResult> => {
    const api = panes.current.get(id);
    if (!api) return { ok: false as const, why: tr('터미널이 아직 안 붙었어요', 'Terminal not attached yet') };
    const r = await runModelPick(api, want, { id, defaults: claudeDefaults, current: () => modelOfRef.current?.(s) });
    // 못 바꿨으면 그때 화면을 로그로 남기고 칩 옆에 이유만 — 터미널로 넘기지 않는다(2026-10-01 사용자 "완벽하게 UI 로만")
    if (!r.ok) void pickLog(`--- ${new Date().toISOString()} ${s.name} want=${JSON.stringify(want)} why=${r.why}\n${(r.screen ?? []).join('\n')}`).catch(() => {});
    return r;
  };
  // 폰 입력창 모델 칩(App appctl modelPick) — 이 격자에 그 세션 창이 있을 때만
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; want: PickWant }>).detail;
      const s = sessionsRef.current.find((x) => x.id === d?.id);
      if (s && panes.current.has(s.id)) void pickFor(s.id, s, d.want);
    };
    window.addEventListener('phone-model-pick', on);
    return () => window.removeEventListener('phone-model-pick', on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
  // 창마다 세션에 붙어 있나(TerminalPane onLink) — 채팅 말풍선이 끊긴 동안 '다시 붙는 중', 끊김이 굳으면 바로 '전달 안 됨'
  const [linkOf, setLinkOf] = useState<Record<string, LinkState>>({});
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
    onFocusSession?.(id); // 고른 창을 위에도 — 쌓아 보기에서 ⌘2 로 입력칸은 옮겨 갔는데 스페이스·보낼 곳은 앞 참모에 남았다(2026-10-11 하네스)
    if (chat === 'tabs') window.dispatchEvent(new CustomEvent('chat-tab-pick', { detail: id })); // 스페이스도 그 참모 대시보드로
    focusNow(id);
    window.clearTimeout(again.current);
    again.current = window.setTimeout(() => focusPane(id), 250); // 알림을 눌러 창이 앞으로 오는 중이면 첫 포커스가 씹힌다
    onFocusRequestDone?.(n);
  }, [focusRequest?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(sessions.map((s) => [s.id, s]));
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
  const headId = chat && headSlot ? chatHeadPane({ tabbed, active, shown }) : null;
  const headS = headId ? byId.get(headId) : undefined;
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
      if (from && from !== id) {
        if (onReorder) onReorder(sessions.map((s) => s.id), from, id);
        else dispatch({ type: 'reorder', ids: sessions.map((s) => s.id), from, to: id });
      }
      setDragging(null);
      setOver(null);
    },
  });

  // 창 머리 단추(채팅 판이면 터미널·채팅 바꾸기 + 크게·접기) — 칸 머리 줄 또는 채팅 칸 머리(headSlot)에
  const buttonsOf = (s: Session) => {
    const id = s.id;
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
    return chat && s.kind === 'background' ? (
      <>
        <button className="ib" aria-label={chatOn(id) ? tr('터미널 화면으로', 'Show the terminal') : tr('채팅 화면으로', 'Show the chat')} title={chatOn(id) ? tr('터미널 화면으로', 'Show the terminal') : tr('채팅 화면으로', 'Show the chat')}
          onClick={() => { showTerm(id, chatOn(id)); requestAnimationFrame(() => focusPane(id)); }}>
          {chatOn(id) ? <IconTerminal /> : <IconChat />}
        </button>
        {controls}
      </>
    ) : controls;
  };

  const body = (
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
            {drawn.map((id) => {
              const s = byId.get(id)!;
              const behind = tabbed && id !== active;
              const withChat = buttonsOf(s);
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
                      headless={!!headS}
                      note={memo?.note(s)}
                      onNoteClick={memo ? () => memo.onToggle(id) : undefined}
                      onLink={(st) => {
                        links.set(id, st === 'live' ? panes.current.get(id) ?? null : null);
                        setLinkOf((m) => (m[id] === st ? m : { ...m, [id]: st }));
                      }}
                      inject={(api) => {
                        if (!api) { panes.current.delete(id); links.set(id, null); return; }
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
                          notice={linkOf[id] === 'reattaching' || linkOf[id] === 'gone' ? <span>{linkOf[id] === 'gone' ? tr('세션이 꺼진 것 같아 — 다시 켜지면 안 간 말을 다시 보내 줘', 'The session seems to have stopped — send again once it is back') : tr('세션 연결이 끊겨서 다시 붙는 중 — 보낸 말은 붙으면 바로 가', 'Lost the session link — reattaching; your message goes as soon as it is back')}</span> : chatNotice}
                          link={linkOf[id]}
                          pickModel={(want) => pickFor(id, s, want)}
                          state={s.state}
                          send={(text) => {
                            const sent = typeAndSend(id, text);
                            last.current = id;
                            onFocusSession?.(id);
                            return sent;
                          }}
                          interrupt={() => escOnce(id, panes.current.get(id))}
                          rawKeys={async (seq) => { for (const k of seq) { panes.current.get(id)?.raw(k); await new Promise((r) => setTimeout(r, 120)); } }}
                          onTerminal={() => showTerm(id, true)}
                          onInputFocus={() => panes.current.get(id)?.claimPtt()}
                          screen={() => panes.current.get(id)?.screen()}
                          submitTerminal={(expect) => { const api = panes.current.get(id); if (api) void typing.push(id, enterTask(api, expect)); }}
                          pasteImage={() => panes.current.get(id)?.raw('\x16')}
                          voiceStop={voiceStops[id] ?? 0}
                          paneId={id}
                          locker={chat ? { id, name: s.name || id } : undefined}
                          clearTerminal={(n) => clearInput(id, panes.current.get(id), n)}
                          sendQueuedNow={() => escOnce(id, panes.current.get(id))} // 멈추면 Claude 가 줄 선 말을 곧바로 보낸다(2026-09-30 시험 세션 실측)
                          typeOnly={(text) => void typeAndSend(id, text, false)}
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
                <StatusMark kind={statusKind(statusOf(s))} />
                <b>{titleOf(s)}</b>
                <button className="ib" title={tr('펼치기', 'Expand')} aria-label={tr('펼치기', 'Expand')} onClick={() => dispatch({ type: 'expand', id })}><IconExpand /></button>
                <button className="ib" title={tr('크게', 'Maximize')} aria-label={tr('크게', 'Maximize')} onClick={() => dispatch({ type: 'maximize', id })}><IconMaximize /></button>
              </span>
            );
          })}
        </div>
      )}
      {headSlot && headS && createPortal(
        <>
          <span className="sch-tx"><b className="sch-name">{titleOf(headS)}</b>{subOf?.(headS) && <span className="sch-role">{subOf(headS)}</span>}</span>
          {headS.kind === 'background' && (
            <span className="sch-ctl">
              {memo && <NoteButton note={memo.note(headS)} onClick={() => memo.onToggle(headS.id)} text={false} />}
              {buttonsOf(headS)}
            </span>
          )}
        </>,
        headSlot,
      )}
    </>
  );
  // 탭 보기 — 탭 줄과 창을 한 덩어리로 묶어, 고른 창 테두리가 탭까지 이어지게(2026-09-30 사용자)
  return chat === 'tabs' ? <div className="tabbed">{body}</div> : body;
}
