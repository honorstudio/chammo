// 바탕 배지 창(bubble.html, Rust orch_bubble — 앱을 내려도 배지만 바탕 위에. 10-28 사용자).
// 배지 = 앱 안 배지와 같은 v3 N 모양(BubbleFan — 얼굴 하나·테두리 상태 색·숫자 알약, 올리면 부채: 창이 부채만큼 커진다, 창은 투명).
// 누르면 이 창이 그 자리 대화창으로 커진다(본창을 안 끌어옴) — 배지 자리에서 톡 자라 나오고 접으면 배지로 줄어든다(domain/orchBubble popSteps, 10-28 사용자) —
// 대화창은 원격 채팅(RemoteChat)처럼 터미널 없는 ChatView: 읽기는 대화 기록, 보내기는 Rust bubble_send(폰 보내기와 같은 길).
// 자리는 모니터별 화면 + 비율로 기억(domain/orchBubble screenSave·screenPlace), 대화창은 배지가 있는 모니터 안에서만(deskPop)
import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { listSessionsRaw, readCtx } from '../../data/tauri';
import { promptInput } from '../../domain/chat';
import { parseCtx, type Ctx } from '../../domain/ctx';
import { keepSame } from '../../domain/keepSame';
import { agentState } from '../../domain/session';
import { DESK_PAD, POP_MS, deskFrame, deskView, type DeskMode, openKeep, fanKeep, fanPlan, farEdges, fitPopSize, resizedPop, type Far, isDrag, popSteps, readSpot, screenPlace, screenSave, stageBox, type PopAnim, type Pt, type Rect, type Screen } from '../../domain/orchBubble';
import { BadgeCore, BubbleFan, useHoverFan, type FanOrch } from './BubbleFan';
import { shownName } from '../../domain/orchLabel';
import { orchVars } from '../../domain/orchTheme';
import { motionOn } from '../calm';
import { tr } from '../../i18n';
import { OrchAvatar } from '../avatar';
import { ChatView } from '../chat/ChatView';
import { ChatVoice } from '../chat/chatVoice';
import type { PickWant } from '../chat/modelPickRun';
import { attachToChat, DROP_EVENT, type DropEvent } from '../fileDrop';
import { CHAT_INSERT } from './dragPath';
import { IconDockIn, IconMaximize, IconMinimize, IconRestore } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { useRoster } from '../team/teamGive';
import { useFace } from './OrchBubble';
import { imagePasteKey } from '../../domain/keys';
import { IS_WIN } from '../../domain/reader';
import './orchBubble.css';

/** 바탕 배지 상자 — 배지 52(왼쪽 18·위 10) + 아래 숫자 알약 자리. 맥 창(한 판, deskFrame)은 부채(FAN)·배너(PEEK)가 펼쳐질 자리와 그 배지에서 열릴 대화창 자리를
 *  늘 품고 네 방향 DESK_PAD 씩 넓다(물결·그림자) — 올림·뺌·배너·열기·접기엔 창을 안 바꾼다(10-28 사용자 "호버하면 깜빡", 11-05 "펼칠 때·닫힐 때 깜빡") */
const DESK = 88;
const FAN = 150;
const BX = 18, BY = 10;
const POP = { w: 360, h: 470 };
/** 묻는 참모 배너 폭 — 무대 창이 화면 가운데 쪽으로 늘 품는다 */
const PEEK = 236;
/** 무대 창이 배지 상자 밖으로 품는 자리 — 가로는 부채·배너 중 큰 쪽, 세로는 부채 */
const EXT = { w: Math.max(FAN, PEEK), h: FAN };
const SPOT_KEY = 'orchBubble.desk';
/** 사람이 끌어 바꾼 대화창 보통 크기 */
const SIZE_KEY = 'orchBubble.popSize';
type Screens = { screens: Screen[]; app: string | null; win: (Rect & { id: string }) | null };
type Frame = ReturnType<typeof deskFrame>;
const sameRect = (a: Rect | null, b: Rect) => !!a && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1;
const noop = () => {};
/** 별명 — 이름 줄의 ' · ' 뒤(없으면 그대로) */
const nick = (l: string) => shownName(l);
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 이번 실행만 */ } };
const screensNow = () => invoke<Screens>('bubble_screens');
/** 판(웹뷰) 자리·크기 + 지금 보일 칸(맥 창 = 그 칸, 판 기준 px) — 판 안 그림은 안 움직이고 창만 줄고 커진다(11-10 사용자 "늘 이 정도 영역을 차지") */
const place = (r: Rect, key: boolean, radius: number, view: Rect) => invoke('bubble_place', { x: r.x, y: r.y, w: r.w, h: r.h, key, radius, view: [view.x, view.y, view.w, view.h] });
const viewOf = (f: Frame, mode: DeskMode) => deskView(f, mode, EXT);
/** 화면이 한 번 그려질 때까지 — 창이 안 보이면 rAF 가 안 와서 80ms 에 넘어간다 */
const paint = () => new Promise<void>((ok) => { const t = window.setTimeout(ok, 80); requestAnimationFrame(() => requestAnimationFrame(() => { window.clearTimeout(t); ok(); })); });
const wait = (ms: number) => new Promise<void>((ok) => window.setTimeout(ok, ms));

export function DeskBubble() {
  const face = useFace();
  const roster = useRoster();
  const [pick, setPick] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [anim, setAnim] = useState<PopAnim>('gone');
  // 맥 창 한 판(deskFrame) — 창 안 배지 상자·펼치는 쪽·열릴 대화창·자라는 점. 닫혀도 열려도 같은 판이라 열기·접기에 창이 안 바뀐다
  const [frame, setFrame] = useState<Frame>(() => ({ win: { x: 0, y: 0, w: 0, h: 0 }, box: stageBox({ x: -1, y: -1 }, EXT), side: { x: -1, y: -1 }, pop: null, origin: { x: 0, y: 0 }, badge: true }));
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const modeRef = useRef<DeskMode>('rest');
  // 대화창 보통 크기 — 사람이 끌어 바꾼 크기(없으면 POP). '크게'는 따로 모드라 여기 안 적는다
  const sizeRef = useRef<{ w: number; h: number }>((() => { try { const v = JSON.parse(read(SIZE_KEY) ?? 'null') as { w?: number; h?: number } | null; return v && v.w! > 0 && v.h! > 0 ? { w: v.w!, h: v.h! } : POP; } catch { return POP; } })());
  // 별명 툴팁(얼굴 줄은 가로 스크롤이라 그 안에 그리면 잘린다 — 창 맨 위 층에)
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [big, setBig] = useState(false);
  const bigRef = useRef(big);
  bigRef.current = big;
  const [sid, setSid] = useState<string | undefined>();
  const [state, setState] = useState('idle');
  const [err, setErr] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | undefined>();
  const [ctxs, setCtxs] = useState<Record<string, Ctx>>({});
  const openRef = useRef(open);
  const draggedRef = useRef(false);
  // 옮김 사건 뒤 0.3초 기다리는 '놓음' 처리 — 끌기를 시작하면 지운다. 부채가 펴질 때 창 크기가 바뀐 사건이 0.3초 안에 시작한 끌기를
  // '다 놓았다'로 받아 끄는 도중에 판을 다시 놓았다(11-11 실측: 배지가 커서보다 40px 어긋남)
  const movedT = useRef(0);
  const startDrag = () => { window.clearTimeout(movedT.current); draggedRef.current = true; void invoke('bubble_drag'); };
  openRef.current = open;
  const who = roster.find((o) => o.id === (open ? pick ?? face : face)) ?? null;
  // 펼치는 쪽(화면 가운데 쪽) — 판을 놓을 때 정해진다(toBadge). hide = 창 안 배지 자리가 바뀌어 창 자리와 같이 옮기는 동안
  const side = frame.side;
  const [hide, setHide] = useState(false);
  // 묻는 참모가 생기면 배지 옆 배너 — 누르면 그 참모 대화창(10-28 사용자 "배너 눌러서 대화"). 8초, 올려 두면 안 사라진다
  const askKey = who?.pip === 'ask' ? who.id : '';
  const [peek, setPeek] = useState('');
  const peekRef = useRef(false);
  peekRef.current = !!peek;
  const peekT = useRef(0);
  // 부채 둘레(창 기준 마우스 자리) — 배지 원·펼친 1/4 원 안이거나 부채 요소('+N' 목록 포함) 위면 머문다. 배지 자리가 정해진 뒤(아래) 채운다
  const zoneRef = useRef<(p: Pt | null) => boolean>(() => false);
  const hover = useHoverFan(!open && !peek && roster.length > 1, (p) => zoneRef.current(p));
  const hoverRef = useRef(hover);
  hoverRef.current = hover;
  // 배지를 끄는 동안 — 제자리 확인·올림이 끼어들면 끄는 창이 튀거나 사라졌다(10-28 사용자 "드래그할 때 자꾸 사라짐")
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const fan = hover.on && !dragging;
  // 그리기는 접히는 동안(out)까지 — 그동안도 창은 안 옮긴다
  const fanShown = hover.shown && !dragging;
  const fanRef = useRef(false);
  fanRef.current = fanShown;
  // 창 안 배지 상자 왼쪽 위(여백·펼칠 자리·대화창 자리만큼 비켜 있다) — 끈 창에서 배지 자리를 읽는다. off = 여백 안(obd-wrap) 배지 원 자리
  const boxOff = frame.box;
  const off = { x: boxOff.x - DESK_PAD + BX, y: boxOff.y - DESK_PAD + BY };
  const fp = fanPlan(roster, who?.id);
  const fanK = fp.shown.length + (fp.more.length ? 1 : 0);
  zoneRef.current = (p) => fanKeep(p, { x: DESK_PAD + off.x + 26, y: DESK_PAD + off.y + 26 }, side, fanK) || !!(p && document.elementFromPoint(p.x, p.y)?.closest('.obb-fan'));

  // 배지 자리 → 맥 창 한 판(무대 + 그 자리에서 열 대화창, 키우기면 큰 대화창)
  const frameAt = (b: Pt, screens: Screen[], isBig: boolean, size = sizeRef.current) => deskFrame({ x: b.x, y: b.y, w: DESK, h: DESK }, { x: b.x + BX, y: b.y + BY, w: 52, h: 52 }, screens, EXT, size, isBig);
  // 배지 자리 — 기억한 모니터·비율(그 모니터가 빠졌으면 앱 창 모니터), 창 배치·해상도가 바뀌어도 다시 안으로. 창은 한 판(deskFrame) 크기
  const toBadge = useCallback(async (force = false) => {
    const s = await screensNow();
    if (!force && (openRef.current || peekRef.current || fanRef.current || draggingRef.current || openingRef.current)) return; // 배너·부채·대화창·끌기 중엔 창을 안 옮긴다(놓은 뒤 한 번)
    const p = screenPlace(readSpot(read(SPOT_KEY)), s.screens, s.app, DESK);
    const f = frameAt(p, s.screens, bigRef.current);
    // 창 안 배지 자리가 바뀌면(쪽·대화창 자리가 바뀜) 창 자리와 웹뷰 안 배지 자리가 같이 바뀐다 — 둘은 같은 프레임에 못 맞추니 감춘 채 옮기고 다 그린 뒤 보인다
    const flip = f.box.x !== frameRef.current.box.x || f.box.y !== frameRef.current.box.y;
    if (sameRect(s.win, f.win) && !flip) { if (JSON.stringify(f) !== JSON.stringify(frameRef.current)) setFrame(f); return; }
    if (flip) { setHide(true); await paint(); }
    await place(f.win, false, 0, viewOf(f, modeRef.current));
    setFrame(f);
    if (flip) { await paint(); setHide(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const w = window as unknown as { __bubbleShow?: () => void; __bubbleMoved?: () => void; __bubbleHover?: (on: boolean) => void; __bubbleMouse?: (x: number, y: number) => void };
    // 올림 — Rust 가 전역 마우스로 본다(비활성 패널은 앱이 안 깨어 있으면 웹뷰에 마우스 올림이 안 와서 누를 때 부채가 떴다)
    w.__bubbleHover = (on: boolean) => { if (draggingRef.current) return; if (on) hoverRef.current.enter(); else hoverRef.current.leave(); };
    // 창 안 마우스 자리 — 그 자리 [data-hot] 에 hot(별명 툴팁·부채 이름). 비활성 패널은 :hover 가 안 올 수 있다
    let hot: Element | null = null;
    w.__bubbleMouse = (x: number, y: number) => {
      if (!draggingRef.current) hoverRef.current.move(x < 0 ? null : { x, y }); // 부채 둘레 — 밖으로 나가면 잠깐 뒤 접힘
      const el = x < 0 ? null : document.elementFromPoint(x, y)?.closest('[data-hot]') ?? null;
      if (el === hot) return;
      hot?.classList.remove('hot');
      el?.classList.add('hot');
      hot = el;
      const t = el?.getAttribute('data-tip');
      const r = el?.getBoundingClientRect();
      setTip(t && r ? { text: t, x: r.left + r.width / 2, y: r.bottom + 4 } : null);
    };
    // 다시 띄우기(앱 창 보임·bubbleDesk 켬) — 지금 모양 그대로 다시 놓고 보인다(대화창은 안 닫음, 배너면 배너 창)
    w.__bubbleShow = () => { void settle().then(() => invoke('bubble_reveal')).catch(() => {}); };
    // 끌어 옮김 — 다 놓은 뒤(사건이 잦다). 배지를 끌었든 대화창 머리를 끌었든 배지 상자 자리를 기억(열린 동안은 대화창과 같이 옮겨진 배지)
    w.__bubbleMoved = () => {
      window.clearTimeout(movedT.current);
      movedT.current = window.setTimeout(() => {
        if (!draggedRef.current) return; // 앱이 놓은 자리(bubble_place)도 옮김 사건이 온다 — 사람이 끈 것만 기억
        draggedRef.current = false;
        // 끝에 걸쳐 놓았으면 저장은 끝까지만(비율 0~1) — 배지는 놓자마자 화면 안으로 다 보이게 당긴다(대화창은 접을 때)
        void screensNow().then(async (s) => {
          if (!s.win) return;
          // 열린 대화창째 끌었으면 배지 화면 밖으로 나간 만큼 창째 당긴다(배지·대화창 사이 자리는 그대로) — 이 옮김 사건은 위에서 draggedRef 를 내려 안 센다
          const to = openRef.current ? openKeep(s.win, frameRef.current.box, s.screens, DESK) : null;
          if (to) await place({ ...s.win, ...to }, true, 0, viewOf(frameRef.current, 'open'));
          const w0 = to ? { ...s.win, ...to } : s.win;
          const b = { x: w0.x + frameRef.current.box.x, y: w0.y + frameRef.current.box.y };
          write(SPOT_KEY, JSON.stringify(screenSave({ x: b.x, y: b.y }, s.screens, DESK)));
          draggingRef.current = false;
          setDragging(false);
          if (!openRef.current) { hoverRef.current.close(); setPeek(''); void toBadge(true); }
        }).catch(() => {});
      }, 300);
    };
    void invoke<boolean>('bubble_wanted').then((on) => { if (on) w.__bubbleShow?.(); }).catch(() => {});
    // 모니터를 빼거나 해상도가 바뀌면 — 배지일 때 3초마다 제자리 확인
    const iv = window.setInterval(() => { if (!draggingRef.current && !openRef.current && !fanRef.current && !peekRef.current && !document.hidden) void toBadge().catch(() => {}); }, 3000);
    return () => { window.clearInterval(iv); window.clearTimeout(movedT.current); delete w.__bubbleShow; delete w.__bubbleMoved; delete w.__bubbleHover; delete w.__bubbleMouse; };
  }, [toBadge]);

  // 그릴 얼굴이 없으면(터미널 뷰·다른 기기 보는 중) 창을 내린다 — 빈 투명 창이 바탕 클릭을 먹는다. 생기면 다시 띄울 때면 보인다
  const has = !!who;
  useEffect(() => {
    void invoke('bubble_face', { has }).then(() => { if (has) (window as unknown as { __bubbleShow?: () => void }).__bubbleShow?.(); }).catch(() => {});
  }, [has]);

  // 배너 — 묻는 참모가 바뀔 때마다 한 번. 무대 창 안 배지 옆에 그리기만 한다(창은 그대로)
  useEffect(() => { setPeek(askKey && !openRef.current ? askKey : ''); }, [askKey]);
  useEffect(() => {
    if (!peek || open) return;
    window.clearTimeout(peekT.current);
    peekT.current = window.setTimeout(() => setPeek(''), 8000);
  }, [peek, open]);
  // 지금 모양 그대로 다시 놓기 — 대화창은 그대로, 아니면 무대 창(배지·부채·배너가 다 그 안)
  const settle = async () => {
    if (openRef.current || openingRef.current) return;
    await toBadge(true);
  };
  // (__bubbleShow 는 첫 그림의 settle 을 쥔다 — settle 은 ref·고정 함수만 써서 낡지 않는다)

  // 대화창 참모의 세션 번호·상태(3초마다 — 원격 채팅과 같은 박자)
  const chatId = open ? pick ?? face : null;
  useEffect(() => {
    if (!chatId) return;
    let alive = true;
    const tick = () => void listSessionsRaw().then(async (raw) => {
      const a = (JSON.parse(raw) as { id: string; sessionId?: string; status?: string; state?: string; cwd?: string }[]).find((x) => x.id === chatId);
      if (!alive) return;
      setSid(a?.sessionId);
      setCwd(a?.cwd);
      setState(a ? agentState(a) : 'idle');
      setErr(a ? null : tr('이 참모가 꺼졌어요', 'This assistant stopped'));
      // 모델·컨텍스트 — 메인 채팅 칩과 같은 자료(상태줄이 세션마다 남긴 파일). 이 대화 것만 읽는다(옛 세션 파일이 수천 개)
      if (a?.sessionId) {
        const next = parseCtx(await readCtx([a.sessionId]));
        if (alive) setCtxs((old) => keepSame(old, next));
      }
    }).catch(() => {});
    tick();
    const iv = window.setInterval(tick, 3000);
    return () => { alive = false; window.clearInterval(iv); };
  }, [chatId]);

  // 대화창을 여는 중 — 부채·배너를 거두는 효과가 넓힌 창을 배지 자리로 되돌리지 않게(실측: 놓은 대화창을 18ms 뒤 배지로 덮었다)
  const openingRef = useRef(false);
  // 열면 바로 칠 수 있게 글칸에 커서(창이 키 창이 된 뒤에)
  const focusIn = useRef<(() => void) | null>(null);
  const takeFocus = useCallback((fn: (() => void) | null) => { focusIn.current = fn; }, []);
  const openPop = async (to: boolean, isBig = big, id: string | null = null) => {
    if (!to) { await closePop(); return; }
    openingRef.current = true;
    try {
      const s = await screensNow();
      if (!s.win) return;
      // 배지 상자 = 창 안 그 자리(창 왼쪽 위가 아니다) — 닫혀도 열려도 같은 판이라 같은 길
      const b = { x: s.win.x + frameRef.current.box.x, y: s.win.y + frameRef.current.box.y };
      const f = frameAt(b, s.screens, isBig);
      if (!f.pop) return;
      // 배지에서 열 때만 톡 — 이미 열린 대화창의 키우기·참모 바꾸기는 자리만 바꾼다
      const grow = !openRef.current;
      // 판이 그대로면(보통) 창을 안 바꾼다 — 배지는 제자리에 보인 채 대화창만 자란다. 판이 바뀌면(화면 배치가 막 바뀜) 닫혀 있던 배지만 감춘 채 옮긴다
      const moved = !sameRect(s.win, f.win);
      const flip = grow && moved && (f.box.x !== frameRef.current.box.x || f.box.y !== frameRef.current.box.y);
      if (grow) setAnim('from');
      if (flip) setHide(true);
      setFrame(f);
      setPick(id ?? (open ? pick : face));
      setOpen(true);
      setPeek('');
      if (grow) await paint(); // 접힌(안 보이는) 대화창을 먼저 그린 뒤 펼친다
      await place(f.win, true, 0, viewOf(f, 'open')); // 대화창 = 키 창(글을 칠 수 있게) + 창을 판 전체로 — 판 안 그림은 그대로라 배지는 제자리
      if (grow && moved) await paint();
      if (flip) setHide(false);
      setAnim('in');
      requestAnimationFrame(() => focusIn.current?.());
    } finally {
      openingRef.current = false;
    }
  };
  // 접기 — 배지 쪽으로 줄어들며 사라지고(out) 배지만 남는다. 창은 같은 판 그대로 키만 내려놓는다(배지는 한 번도 안 감춘다)
  const closePop = async () => {
    if (popSteps(false, motionOn())[0] === 'out') { setAnim('out'); await wait(POP_MS.close); }
    setAnim('gone');
    setOpen(false);
    openRef.current = false;
    const s = await screensNow().catch(() => null);
    await place(s?.win ?? frameRef.current.win, false, 0, viewOf(frameRef.current, 'rest')); // 접힌 뒤에 창만 배지 칸으로
    await toBadge(true); // 대화창째 끌어 옮겼으면 그 자리 판으로(배지 자리가 바뀌면 감춘 채)
  };
  // 부채 — 올리면 창 안 화면 가운데 쪽으로 펼치기만 한다(창 크기·자리는 그대로 — 바꾸면 창과 웹뷰가 한 프레임 어긋나 배지가 튀었다, 10-28 사용자)
  const press = useRef<{ x: number; y: number; dragged: boolean } | null>(null);
  // 배지 누르기 — 닫힌 배지·열린 배지 같은 길: 5px 넘게 움직이면 창 끌기(열린 동안은 대화창째 옮겨진다), 아니면 click 이 열기·접기
  const grab = (e: React.PointerEvent) => { if (e.button === 0) press.current = { x: e.screenX, y: e.screenY, dragged: false }; };
  const drag = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || p.dragged || !(e.buttons & 1) || !isDrag(e.screenX - p.x, e.screenY - p.y)) return;
    p.dragged = true;
    draggingRef.current = true;
    setDragging(true); // 부채·배너는 접고 창은 배지 칸으로 — 맥 끌기(Rust follow)는 판 기준이라 칸이 바뀌어도 배지가 커서와 같이 간다
    startDrag(); // 맥·윈도우 창 끌기 — 놓으면 __bubbleMoved
  };
  // 열기·접기는 click 으로 — 창 끌기(bubble_drag)를 하면 놓음이 맥·윈도우 끌기에 먹혀 click 이 안 온다. 접근성 누르기(AXPress)도 click 만 보낸다. 끈 뒤 click 이면 true
  const pressed = () => { const p = press.current; press.current = null; return !!p?.dragged; };
  // 크기 손잡이 — 끄는 동안 맥 창을 그 크기로 다시 놓고(자리는 배지 쪽 모서리 그대로), 놓으면 보통 크기로 기억
  const grip = useRef<{ x: number; y: number; size: { w: number; h: number }; far: Far; axis: 'x' | 'y' | 'xy'; b: Rect; screens: Screen[]; busy: boolean } | null>(null);
  const startGrip = async (e: React.PointerEvent, axis: 'x' | 'y' | 'xy') => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const pop = frame.pop ?? { x: 0, y: 0, ...POP };
    const start = { x: e.screenX, y: e.screenY, size: { w: pop.w, h: pop.h }, far: farEdges(frame.origin, pop), axis };
    setBig(false); // 손으로 끌면 '크게' 모드는 풀린다 — 크게는 화면 높이 꽉 찬 따로 모드
    const s = await screensNow();
    const win = s.win ?? frameRef.current.win;
    const b = { x: win.x + frameRef.current.box.x, y: win.y + frameRef.current.box.y, w: DESK, h: DESK };
    grip.current = { ...start, b, screens: s.screens, busy: false };
  };
  const moveGrip = (e: React.PointerEvent) => {
    const d = grip.current;
    if (!d || d.busy) return;
    const next = resizedPop(d.size, e.screenX - d.x, e.screenY - d.y, d.far, d.axis);
    const f = frameAt(d.b, d.screens, false, next);
    if (!f.pop) return;
    sizeRef.current = { w: f.pop.w, h: f.pop.h };
    d.busy = true;
    setFrame(f);
    void place(f.win, true, 0, viewOf(f, 'open')).finally(() => { d.busy = false; });
  };
  const endGrip = () => {
    const d = grip.current;
    grip.current = null;
    if (!d) return;
    const sc = d.screens.find((x) => x.id === screenSave({ x: d.b.x, y: d.b.y }, d.screens, DESK).screen);
    if (sc) sizeRef.current = fitPopSize(sizeRef.current, sc);
    write(SIZE_KEY, JSON.stringify(sizeRef.current));
  };

  // 메인 참모 채팅 칸이 터미널에 하는 일을 그 세션에 직접 — 키(Esc 멈춤·Ctrl+V 그림·선택지 키)는 잠깐 붙어 넣고,
  // 터미널 입력칸은 작은 버퍼로 흉내(끌어 놓은 경로·typeOnly 를 쌓았다가 보낼 때 앞에 붙인다 — 메인은 입력칸에 쌓인 뒤 Enter)
  const term = useRef('');
  const keys = async (seq: string[]) => { if (chatId) await invoke('bubble_keys', { id: chatId, keys: seq }).catch((e: unknown) => setErr(String(e))); };
  const lastSent = useRef('');
  // 실패면 false — ChatView 가 친 글을 입력칸에 되살린다. 앞에 붙였던 끌어 놓은 경로도 되돌린다(2026-11-01 ux-daily M12)
  const send = (body: string): Promise<boolean> => {
    if (!chatId) return Promise.resolve(false);
    const text = term.current + body;
    term.current = '';
    lastSent.current = text;
    return invoke('bubble_send', { id: chatId, text }).then(() => { setErr(null); return true; }, (e: unknown) => { term.current = text.slice(0, text.length - body.length) + term.current; setErr(tr(`못 보냈어요 — ${String(e)}`, `Not sent — ${String(e)}`)); return false; });
  };
  // 멈춤 — 막 보낸 말을 Esc 로 끊으면 Claude 가 그 말을 세션 입력칸에 되돌려 놓는다. 메인 칸은 화면을 읽어 다루지만
  // 대화창은 안 읽으니 다음 말 앞에 붙었다 — 한 번 읽어 보낸 말이 남았으면 세션 입력칸을 비우고(Ctrl+C) 대화창 입력칸으로 돌려 놓는다
  const stop = async () => {
    await keys(['\x1b']);
    if (!chatId) return;
    await wait(700);
    const t = await invoke<string>('bubble_screen', { id: chatId }).catch(() => '');
    const left = promptInput(t.split('\n'), [0, 0]);
    if (!left || !lastSent.current.includes(left.slice(0, 24))) return;
    await keys(['\x03']);
    window.dispatchEvent(new CustomEvent(CHAT_INSERT, { detail: { id: `bubble:${chatId}`, text: left } }));
  };
  const submitTerminal = () => { if (term.current) send(''); else void keys(['\r']); };
  // 선택지 창 — 물을 때만 그 세션 화면을 읽는다(1.5초마다, 잠깐 붙어 읽고 뗀다)
  const scr = useRef<{ lines: string[]; cursor: [number, number] } | undefined>(undefined);
  useEffect(() => {
    scr.current = undefined;
    if (!chatId || state !== 'blocked') return;
    let alive = true;
    const read = () => void invoke<string>('bubble_screen', { id: chatId }).then((t) => { if (alive) scr.current = { lines: t.split('\n'), cursor: [0, 0] }; }).catch(() => {});
    read();
    const iv = window.setInterval(read, 1500);
    return () => { alive = false; window.clearInterval(iv); };
  }, [chatId, state]);
  // 끌어 놓은 경로가 칸에 쳐지는 사건(메인은 xterm 이 받는다) → 버퍼로
  const paneRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const onType = (e: Event) => { term.current += (e as CustomEvent<string>).detail ?? ''; };
    pane.addEventListener(DROP_EVENT, onType);
    return () => pane.removeEventListener(DROP_EVENT, onType);
  }, [open, chatId]);
  useEffect(() => { term.current = ''; }, [chatId]);
  // 파일 끌어 놓기 — Rust 가 이 창으로 넘긴다(drop.rs). 대화창이면 그 참모 입력에 붙인다(메인 attachToChat 그대로)
  useEffect(() => {
    const w = window as unknown as { __drop?: (e: DropEvent) => void };
    w.__drop = (e) => {
      paneRef.current?.closest('.obd-pop')?.classList.toggle('drop-over', e.type === 'over');
      if (e.type === 'drop' && e.paths?.length && chatId) attachToChat(chatId, e.paths);
    };
    return () => { delete w.__drop; };
  }, [chatId]);
  // 모델 칩 — 메인 창이 그 세션 칸에서 /model·/effort 를 친다(폰 칩과 같은 길)
  const pickModel = async (want: PickWant) => {
    await invoke('bubble_appctl', { action: 'model-pick', arg: { id: chatId, model: want.model ?? null, effort: want.effort ?? null } });
    return { ok: true as const };
  };
  // 음성 모드 단추 — 앱 스위치(localStorage voiceMode)와 같은 값, 누르면 앱이 바꾼다
  const readVoice = () => { try { return JSON.parse(localStorage.getItem('voiceMode') ?? 'false') === true; } catch { return false; } };
  const [voiceOn, setVoiceOn] = useState(readVoice);
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === 'voiceMode' || e.key === null) setVoiceOn(readVoice()); };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
  const voiceCtl = { on: voiceOn, toggle: () => { const next = !voiceOn; setVoiceOn(next); void invoke('bubble_appctl', { action: 'voice', arg: next ? 'on' : 'off' }).catch(() => setVoiceOn(!next)); } };

  // 받는 자리(클릭) · 올림 자리(부채) — Rust 가 마우스 자리로 투명 여백 클릭을 바탕으로 넘기고 올림을 알린다(창 기준 px)
  const P = DESK_PAD;
  // 배너 왼쪽(여백 안) — 화면 가운데 쪽, 배지 옆. 부채 자리 = 배지 상자에서 가운데 쪽으로 FAN 만큼(여백 포함)
  const peekX = side.x < 0 ? off.x - BX - PEEK + 6 : off.x + 52 + 12;
  const fanAt: [number, number, number, number] = [boxOff.x - P - (side.x < 0 ? FAN : 0), boxOff.y - P - (side.y < 0 ? FAN : 0), DESK + FAN + P * 2, DESK + FAN + P * 2];
  const badgeAt: [number, number, number, number] = [P + off.x, P + off.y, 52, 52];
  const pop = frame.pop;
  const hits = open
    ? { hot: [...(pop ? [[pop.x, pop.y, pop.w, pop.h]] : []), ...(frame.badge ? [badgeAt] : [])], hover: [] }
    : fan ? { hot: [fanAt], hover: [badgeAt] } // 펴진 동안 머물기는 마우스 자리로(부채 둘레) — 네모 올림 칸이면 비스듬히 빼도 빈 모서리에서 안 접혔다
    : { hot: [badgeAt, ...(peek ? [[P + peekX, P + off.y, PEEK - 14, 52] as [number, number, number, number]] : [])], hover: [badgeAt] };
  const hitKey = JSON.stringify(hits);
  useEffect(() => { void invoke('bubble_hot', hits).catch(() => {}); }, [hitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // 맥 창 = 판의 보일 칸 — 배지만이면 배지 칸(108), 부채·배너는 무대, 대화창은 판 전체. 부채·배너는 펴질 때 창부터 키우고(첫 그림은 투명) 다 접힌 뒤 줄인다.
  // 열린 동안(열기·키우기·크기 손잡이·끌어 당김)은 place 가 판과 칸을 같이 놓는다 — 여기서 옛 판에 새 칸을 대면 한 박자 잘못 줄었다
  const mode: DeskMode = open ? 'open' : (fanShown || peek) && !dragging ? 'stage' : 'rest';
  modeRef.current = mode;
  const view = viewOf(frame, mode);
  const viewKey = `${view.x},${view.y},${view.w},${view.h}`;
  useLayoutEffect(() => { if (frame.win.w > 0 && !open && !openingRef.current) void invoke('bubble_view', { view: [view.x, view.y, view.w, view.h] }).catch(() => {}); }, [viewKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!who) return <div className="obd-empty" />;
  const avatar = (o: typeof who, size: number) => <OrchAvatar name={o.owner} size={size} state={o.pip === 'ask' ? 'ask' : o.busy ? 'work' : 'rest'} color={o.color} label={o.label} />;
  const fanOrchs: FanOrch[] = roster.map((o) => ({ id: o.id, label: o.label, color: o.color, pip: o.pip ?? (o.busy ? 'run' : null), small: avatar(o, 28) }));
  const me = fanOrchs.find((o) => o.id === who.id)!;
  const still = !motionOn();
  // 배지는 닫혀도 열려도 같은 요소·같은 자리(판이 같아서) — 열기·접기에 다시 붙지도 감춰지지도 않는다. 대화창은 그 위에 자라 나온다
  return (
    <div className="obd-desk">
      {open && tip && <span className="obd-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</span>}
      <div className={`obd-wrap${hide ? ' hide' : ''}`} style={{ inset: DESK_PAD }} onPointerMove={(e) => { if (!open && !draggingRef.current) hover.move({ x: e.clientX, y: e.clientY }); }} onPointerLeave={() => { if (!open) hover.move(null); }}>
      <button type="button" className={`obb-badge obd-badge${dragging ? ' obb-drag' : ''}`} style={{ left: off.x, top: off.y, ...orchVars(who.color) } as React.CSSProperties}
        aria-label={open ? tr(`${who.label} 대화창 접기`, `Collapse ${who.label} chat`) : tr(`${who.label} 대화창 열기`, `Open ${who.label} chat`)}
        title={open ? tr(`${who.label} — 누르면 접기, 끌면 대화창째 옮기기`, `${who.label} — click to collapse, drag to move with the chat`) : tr(`${who.label} — 누르면 대화, 끌면 옮기기`, `${who.label} — click to chat, drag to move`)}
        onPointerEnter={open ? undefined : hover.enter} onPointerLeave={open ? undefined : hover.leave}
        onPointerDown={grab} onPointerMove={drag}
        onClick={() => { if (!pressed()) void openPop(!open); }}
        onKeyDown={(e) => { if (!open && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); void openPop(true); } }}>
        <BadgeCore face={me} node={avatar(who, 44)} orchs={fanOrchs} />
      </button>
      {!open && fanShown && <span className={`obd-name ${side.y < 0 ? 'up' : 'down'}${hover.out ? ' out' : ''}`} style={{ left: off.x + 26, top: side.y < 0 ? off.y - 10 : off.y + 52 + 30 }}>{nick(who.label)}</span>}
      {!open && peek && !dragging && (
        <button type="button" className="obd-peek" style={{ left: peekX, top: off.y, width: PEEK - 14 }}
          aria-label={tr(`${who.label} 대화하기 — 답을 기다려요`, `Chat with ${who.label} — waiting for your answer`)}
          onPointerEnter={() => window.clearTimeout(peekT.current)} onPointerLeave={() => { peekT.current = window.setTimeout(() => setPeek(''), 3000); }}
          onClick={() => { window.clearTimeout(peekT.current); void openPop(true, big, askKey); }}>
          <b>{who.label}</b><span>{tr('답을 기다려요', 'Waiting for your answer')}</span><em>{tr('대화하기', 'Chat')}</em>
        </button>
      )}
      {!open && fanShown && <BubbleFan orchs={fanOrchs} front={who.id} cx={off.x + 26} cy={off.y + 26} side={side} out={hover.out} onEnter={hover.enter} onLeave={hover.leave}
        onPick={(id) => { hover.close(); setPick(id); void openPop(true, big, id); }} />}
      </div>
    {open && pop && (
    <div className={`obd-pop a-${anim}${still ? ' still' : ''}`} style={{ left: pop.x, top: pop.y, width: pop.w, height: pop.h, transformOrigin: `${frame.origin.x}px ${frame.origin.y}px` }} role="dialog" aria-label={tr(`${who.label} 대화창`, `${who.label} chat`)}>
      {!big && (() => {
        const far = farEdges(frame.origin, pop);
        return (['x', 'y', 'xy'] as const).map((g) => (
          <span key={g} className={`obd-grip g-${g} ${far.x} ${far.y}`} aria-hidden="true"
            onPointerDown={(e) => void startGrip(e, g)} onPointerMove={moveGrip} onPointerUp={endGrip} onPointerCancel={endGrip} />
        ));
      })()}
      <div className="obb-head obd-head" onPointerDown={(e) => { if (e.button === 0 && !(e.target as Element).closest('button')) { startDrag(); } }}>
        <div className="obb-faces" role="tablist" aria-label={tr('참모 고르기', 'Pick an assistant')}>
          {roster.map((o) => (
            <button key={o.id} type="button" role="tab" aria-selected={o.id === who.id} className={`obb-face${o.id === who.id ? ' on' : ''}`} data-hot data-tip={nick(o.label)}
              style={orchVars(o.color) as React.CSSProperties} aria-label={nick(o.label)} onClick={() => setPick(o.id)}>
              <span className="obb-clip">{avatar(o, 28)}</span>{(o.pip === 'ask' || o.pip === 'new' || o.busy) && <i className={`obb-pip p-${o.pip === 'ask' || o.pip === 'new' ? o.pip : 'run'}`} aria-hidden="true" />}
            </button>
          ))}
        </div>
        <b className="obd-who">{nick(who.label)}</b>
        <span className="obb-tools">
          <IconButton size="s" label={big ? tr('작게', 'Smaller') : tr('키우기', 'Bigger')} onClick={() => { const b = !big; setBig(b); void openPop(true, b); }}>{big ? <IconRestore /> : <IconMaximize />}</IconButton>
          <IconButton size="s" label={tr('앱에서 열기', 'Open in the app')} onClick={() => void invoke('orch_bubble_main', { orch: who.id }).catch(() => {})}><IconDockIn /></IconButton>
          <IconButton size="s" label={tr('접기', 'Collapse')} onClick={() => void openPop(false)}><IconMinimize /></IconButton>
        </span>
      </div>
      <div className="obd-body tabbed">
        <div className="gridbox">
          <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)' }}>
            <div className="cell" data-session={chatId ?? undefined}>
              <div className="pane headless" data-drop ref={paneRef}>
                <ChatVoice.Provider value={voiceCtl}>
                <ChatView key={who.id} sessionId={sid} state={state} send={send} cwd={cwd} ctx={sid ? ctxs[sid]?.used : undefined} modelInfo={sid ? ctxs[sid] : undefined} pickModel={pickModel}
                  interrupt={() => void stop()} rawKeys={(seq) => keys(seq)} pasteImage={() => void keys([imagePasteKey(IS_WIN)])}
                  onTerminal={() => void invoke('orch_bubble_main', { orch: who.id }).catch(() => {})}
                  screen={state === 'blocked' ? () => scr.current : undefined}
                  submitTerminal={submitTerminal} clearTerminal={() => { term.current = ''; }} sendQueuedNow={() => void stop()} typeOnly={(t) => { term.current += t; }}
                  focusRef={takeFocus} paneId={`bubble:${who.id}`} notice={err ? <span>{err}</span> : undefined} />
                </ChatVoice.Provider>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    )}
    </div>
  );
}
