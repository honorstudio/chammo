// 참모 프사 띠(접힌 참모 패널) — 채팅 칸 위 참모 탭 줄을 대신한다(2026-10-11 사용자 "참모 바꾸기는 왼쪽 프사 띠가").
// 탭 줄에만 있던 것: 누르면 그 참모(채팅 탭도 같이), 끌어 순서 바꾸기(고정한 참모와 안 고정한 참모는 서로 못 넘는다 · 띠 밖으로 끌어 입력칸에 놓으면 @멘션), 두 번 눌러 이름·맡은 일,
// 오른쪽 눌러 메뉴(고정·이름·프로필·끄기·지우기), 말하는 참모 빛, ⌘1~9 안내
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { keyLabel } from '../../domain/keys';
import { IS_WIN } from '../../domain/reader';
import { dragStarted, dropIndex, railOut, tabShift } from '../../domain/tabDrag';
import { dragGhost, insertToChat } from './dragPath';
import { lostRelease } from './dragEnd';
import { railMoved } from '../../domain/railRows';
import { wakeOnce } from '../../domain/railWake';
import { orchVars } from '../../domain/orchTheme';
import { assistant, tr } from '../../i18n';
import { IconCalendarClock, IconChevron, IconHome, IconMore, IconPeople, IconPlus } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { speakGlowRef, useSpeaking } from '../speakGlow';
import { Grip } from '../TaskPanel';
import { motionOn } from '../calm';

/** 띠 프사 — pip: 그 참모나 맡긴 세션이 사람을 기다림(ask)·새로 띄운 파일(new)·일하는 중(run)·쉼(rest, 빈 고리) */
/** 카드 점 — 상태는 점 모양 규칙(domain/dot): 일함 채움+숨쉬기·기다림 노랑·쉼 빈 고리·꺼짐 점선 */
const dotOfPip = (p: RailAvatar['pip']) => (p === 'ask' ? 'ask' : p === 'run' ? 'run' : p === 'rest' || p === 'new' ? 'rest' : 'off');

/** phase = 켜는 중(깨우는 쉬는 참모·새 참모)·끄는 중 — 그 칸은 누르기·끌기·메뉴가 없고 둘째 줄이 phaseText(2026-10-12 사용자 "뿅 나왔다 뿅 사라진다").
 *  flip = 자리 옮김 열쇠(대화 id — 쉬는 참모 줄과 같은 열쇠면 그 자리에서 미끄러져 온다), flipAlt = 새 참모 '켜는 중' 칸(new:<이름>) 자리를 이어받을 때 */
export type RailAvatar = { id: string; label: string; role?: string; node: React.ReactNode; on: boolean; color: string; pinned: boolean; pip?: 'ask' | 'new' | 'run' | 'rest' | null;
  phase?: 'starting' | 'stopping'; phaseText?: string; flip?: string; flipAlt?: string };

/** 쉬는(꺼진) 참모 — 띠 아래쪽 흐린 프사, 누르면 깨움(이어서 켜기). key 는 위 줄 flip 과 같은 대화 id */
export type RailResting = { key: string; label: string; node: React.ReactNode; onWake: () => void; onMenu?: (e: React.MouseEvent) => void };

/** 자리 옮김(FLIP) — 줄이 바뀌기 직전 자리(가운데)를 재 둔다. 그리는 중에 읽어야 바뀌기 전 DOM 이다 */
const centers = (nav: HTMLElement | null) => new Map([...(nav?.querySelectorAll<HTMLElement>('[data-flip]') ?? [])].map((el) => {
  const r = el.getBoundingClientRect();
  return [el.dataset.flip!, { x: r.left + r.width / 2, y: r.top + r.height / 2 }] as const;
}));
const still = () => !motionOn(); // 애니메이션 줄이기·끄기·OS 동작 줄이기(ui/calm)

export function OrchRail({ home, onTeam, moreDot = false, popFns, top, avatars, onPick, onMenu, onRename, onMove, onNew, onExpand, expandLabel, fns, group, resting = [], sched, wide = false, groupNames, width = 240, onWidth, joined = false, extra }: {
  /** 띠 맨 위 홈 칸(띠 RA, 2026-10-24 사용자) — 참모 채팅 없는 전체 한눈에(오케스트레이터 홈). on = 지금 홈을 보는 중 */
  home?: { on: boolean; onOpen: () => void };
  /** + 메뉴의 둘째 줄 — 팀 만들기·초대(팀 칸의 + 를 여기로, + 하나). at = + 단추 오른쪽 위 */
  /** room = 팀이 있을 때 단톡방 만들기 줄 */
  onTeam?: { label: string; open: () => void; room?: { label: string; open: () => void } };
  /** 접힌 띠 더보기에 점 — 그 안에 볼 것이 있다(리뷰 수 등) */
  moreDot?: boolean;
  /** 더보기 펼침 안 기능 단추 — 기본 title 이 있는 판(띠 호버 카드가 안 닿는 자리). 없으면 fns */
  popFns?: React.ReactNode;
  avatars: RailAvatar[];
  onPick: (id: string) => void;
  onMenu?: (e: React.MouseEvent, id: string) => void;
  onRename?: (id: string) => void;
  /** 끌어 놓은 자리 — from 을 to 자리로 */
  onMove?: (from: string, to: string) => void;
  /** 프사 바로 아래 + — 새 참모(⌘⇧T 와 같은 창·이름·맡은 일 흐름) */
  onNew?: () => void;
  /** 띠 맨 아래 — 펼친 패널로 */
  onExpand: () => void;
  expandLabel?: string;
  /** 띠 맨 아래(빈 자리 밑, 펼치기 위) — 기능 아이콘(위 막대에서 옮겨 옴, 180·183.png) */
  fns?: React.ReactNode;
  /** 도우미 묶음(2026-10-12 P3) — 프사 하나에 숫자, 누르면 목록(메뉴) */
  group?: { count: number; label: string; onOpen: (e: React.MouseEvent) => void };
  /** 쉬는 참모(P2) — 빈 자리 아래 흐린 프사 */
  resting?: RailResting[];
  /** 예약(P4) — 기능 줄 시계, on = 예약 화면이 떠 있음 */
  sched?: { on: boolean; onToggle: () => void };
  /** 펼친 패널(⌘B, 2026-10-12 P1 A) — 같은 띠를 넓게: 프사 + 이름 + 맡은 일, 도우미 한 줄, 기능 줄은 맨 아래 가로 */
  wide?: boolean;
  /** 도우미 묶음 줄에 붙는 이름들(넓을 때) */
  groupNames?: string;
  /** 펼친 띠 폭(191.png — 내용 폭으로 늘어나지 않게 고정) · 오른쪽 손잡이로 바꾸기(앱 전체 한 값) */
  width?: number;
  onWidth?: (w: number) => void;
  /** 띠 맨 위 — 다른 기기 단추(짝지은 기기가 있을 때만, peer-panel) */
  top?: React.ReactNode;
  /** 채팅 칸이 바로 옆(띠 | 채팅 | 스페이스) — 띠 경계선을 안쪽 그림자로(이음 면은 2026-10-29 사용자가 걷었다 — 고른 표시는 그림 둘레 테두리 하나) */
  joined?: boolean;
  /** 참모 아래 칸(메신저 팀 표·DM, ui/team/TeamRail) — 띠 바로 아래 형제로 그려 고른 표시·호버 카드를 같이 쓴다 */
  extra?: React.ReactNode;
}) {
  const speaking = useSpeaking();
  const grab = useRef<{ id: string; from: number; y: number; x: number; rects: { left: number; width: number }[]; lo: number; hi: number; on: boolean; to: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; dy: number; from: number; to: number; step: number } | null>(null);
  const dragged = useRef(false);
  // 끌기 — 띠 안에선 순서 바꾸기, 띠 밖으로 나가면 '입력칸에 넣기'(놓은 채팅 입력칸에 @이름 멘션, 2026-10-12 사용자).
  // 끝내는 길은 finish 하나 — 놓기·웹뷰가 가져감(pointercancel)·Esc·창 포커스 잃음·버튼 안 눌린 움직임(교훈: pointerup 하나에 기대지 않기)
  const down = (id: string, i: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || e.ctrlKey || avatars[i]!.phase) return; // 켜는 중·끄는 중 칸은 끌기·넣기 없음
    // 참모 프사만 — 도우미 묶음·메신저 칸(.lk-av 를 같이 쓰는 형제)은 순서 바꾸기 자리에서 뺀다
    const btns = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>(':scope > .lk-av:not(.grp):not(.tmx):not(.rail-home):not(.rest-fold)') ?? [])];
    // 세로 띠 — 위·높이를 tabDrag 셈의 left·width 자리에 넣는다
    const rects = btns.map((b) => { const r = b.getBoundingClientRect(); return { left: r.top, width: r.height }; });
    const nPinned = avatars.filter((a) => a.pinned).length;
    const [lo, hi] = avatars[i]!.pinned ? [0, nPinned - 1] : [nPinned, avatars.length - 1];
    const canMove = !!onMove && rects.length >= 2 && rects.length === avatars.length && lo < hi;
    const navEl = navRef.current;
    if (!navEl) return;
    const nav = navEl.getBoundingClientRect();
    const ghost = dragGhost(`@${avatars[i]!.label}`, false);
    grab.current = { id, from: i, y: e.clientY, x: e.clientX, rects, lo, hi, on: false, to: i };
    let out = false;
    const lost = lostRelease(() => finish(null));
    const move = (ev: PointerEvent) => {
      const g = grab.current;
      if (!g) return;
      lost.move(ev.buttons); // 버튼 0 = 뗀 뒤에 처리된 끌기 사건이거나 놓음 신호를 놓친 것 — 이어 가며 pointerup 을 잠깐 기다린다(dragEnd)
      const dy = ev.clientY - g.y;
      if (!g.on && !dragStarted(ev.clientX - g.x, dy)) return;
      g.on = true;
      out = railOut(ev.clientX, ev.clientY, nav);
      if (out) { setDrag(null); ghost.move(ev.clientX, ev.clientY); return; }
      ghost.hide();
      if (!canMove) return;
      const me = g.rects[g.from]!;
      const min = g.rects[g.lo]!.left - me.left;
      const max = g.rects[g.hi]!.left + g.rects[g.hi]!.width - (me.left + me.width);
      const cdy = Math.max(min, Math.min(max, dy));
      g.to = dropIndex(g.rects, g.from, cdy, g.lo, g.hi);
      const gap = g.rects[1]!.left - (g.rects[0]!.left + g.rects[0]!.width);
      setDrag({ id: g.id, dy: cdy, from: g.from, to: g.to, step: me.width + gap });
    };
    const finish = (at: PointerEvent | null) => {
      lost.stop();
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', cancel);
      removeEventListener('keydown', key);
      removeEventListener('blur', cancel);
      const g = grab.current;
      grab.current = null;
      setDrag(null);
      ghost.hide();
      if (!g?.on) return;
      dragged.current = true;
      window.setTimeout(() => { dragged.current = false; }, 0);
      if (!at) return; // 취소
      if (out) { const chat = ghost.chatAt(at.clientX, at.clientY); if (chat) insertToChat(chat, `@${avatars[g.from]!.label}`); return; }
      if (canMove && g.to !== g.from && !avatars[g.to]!.phase) onMove!(g.id, avatars[g.to]!.id);
    };
    const up = (ev: PointerEvent) => finish(ev);
    const cancel = () => finish(null);
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') finish(null); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', cancel);
    addEventListener('keydown', key);
    addEventListener('blur', cancel);
  };
  const navRef = useRef<HTMLElement>(null);
  // 자리 옮김 — 끄기가 끝나 쉬는 참모 줄로 내려가거나, 깨우는 참모가 위 줄로 올라오거나, 한 칸이 빠져 아래 칸들이 당겨질 때 미끄러지게.
  // 줄 모양(열쇠:상태)이 바뀐 그리기에서만 — 폭 바꾸기·끌기·평소 갱신엔 안 움직인다. 처음 보이는 칸(새 참모 켜는 중)은 작게서 커지며 나타난다
  const sig = [...avatars.map((a) => `${a.flip ?? a.id}:${a.phase ?? 'live'}`), ...resting.map((r) => `r:${r.key}`)];
  const sigPrev = useRef<string[] | null>(null);
  const before = useRef<Map<string, { x: number; y: number }> | null>(null);
  if (sigPrev.current && railMoved(sigPrev.current, sig) && !before.current) before.current = centers(navRef.current);
  useLayoutEffect(() => {
    const first = !sigPrev.current;
    const prev = before.current;
    sigPrev.current = sig;
    before.current = null;
    const nav = navRef.current;
    if (first || !prev || !nav || drag || still()) return;
    for (const el of nav.querySelectorAll<HTMLElement>('[data-flip]')) {
      const r = el.getBoundingClientRect();
      const was = prev.get(el.dataset.flip!) ?? (el.dataset.flipAlt ? prev.get(el.dataset.flipAlt) : undefined);
      if (!was) { el.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.3, 1.4, .5, 1)' }); continue; }
      const dx = was.x - (r.left + r.width / 2);
      const dy = was.y - (r.top + r.height / 2);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 460, easing: 'cubic-bezier(.3, .9, .3, 1)' });
    }
  });
  // 호버 카드(2026-10-12 사용자 — 기본 title 은 1초 넘게 걸렸다): 띠 하나가 [data-tip] 항목 위로 카드 하나를 바로 옮긴다.
  // 처음 뜰 땐 옆에서 살짝 밀려 나오며 페이드, 옮길 땐 위아래로 미끄러지고, 띠를 벗어나면 짧게 사라진다
  const [tip, setTip] = useState<{ x: number; y: number; name: string; sub?: string; key?: string; dot?: string; color?: string; jump: boolean } | null>(null);
  const hideT = useRef(0);
  // 이벤트 하나(pointerleave)에 기대면 안 사라진다 — 접기 단추를 누르면 띠가 접히며 항목이 다시 그려지거나 마우스가 띠 밖에 남는데
  // 없어진 요소엔 leave 가 안 가고 가만히 있는 마우스엔 새 이벤트도 없다(198.png). 그래서 띄운 항목·마우스 자리를 기억해 두고 매번 다시 본다
  const anchor = useRef<HTMLElement | null>(null);
  const pt = useRef<{ x: number; y: number } | null>(null);
  const readTip = (el: HTMLElement, jump: boolean) => {
    const r = el.getBoundingClientRect();
    const nav = navRef.current!.getBoundingClientRect();
    const d = el.dataset;
    return { x: nav.right + 8, y: r.top + r.height / 2, name: d.tip ?? '', sub: d.tipSub || undefined, key: d.tipKey || undefined, dot: d.tipDot || undefined, color: d.tipColor || undefined, jump };
  };
  const over = (e: React.PointerEvent<HTMLElement>) => {
    pt.current = { x: e.clientX, y: e.clientY };
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (!el || !e.currentTarget.contains(el)) return;
    window.clearTimeout(hideT.current);
    anchor.current = el;
    if (!tip) setTipDone(false);
    setTip((t) => readTip(el, !t));
  };
  const leave = () => { window.clearTimeout(hideT.current); hideT.current = window.setTimeout(() => setTip(null), 80); };
  const hideTip = () => { window.clearTimeout(hideT.current); anchor.current = null; setTip(null); };
  // 세로 가운데 = 잰 높이로 정수 top(그리기 전) — translateY(-50%) 는 홀수 높이에서 반 픽셀에 놓여 글자가 흐렸다(195.png)
  const tipEl = useRef<HTMLDivElement>(null);
  // 들어오는 움직임이 끝나면 애니메이션을 뗀다 — 합성층이 남으면 글자가 흐렸다(195.png 의심 둘째)
  const [tipDone, setTipDone] = useState(false);
  useLayoutEffect(() => {
    const el = tipEl.current;
    if (el && tip) el.style.top = `${Math.round(tip.y - el.offsetHeight / 2)}px`;
  }, [tip]);
  // 그릴 때마다(접힘·단계 바뀜·항목 교체) 마우스 밑을 다시 본다 — 띠 밖이거나 띄운 항목이 사라졌으면 바로 닫고,
  // 항목이 남았으면 글·자리를 새로 읽는다(켜는 중 → 켜짐 처럼 단계 글이 바뀌어도 옛 글이 안 남게)
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!tip || !nav) return;
    const p = pt.current;
    const under = p ? document.elementFromPoint(p.x, p.y) : null;
    let el = under && nav.contains(under) ? under.closest<HTMLElement>('[data-tip]') : null;
    if (!el) {
      const r = nav.getBoundingClientRect();
      const inNav = !!p && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
      if (inNav && anchor.current?.isConnected) el = anchor.current; // 항목 사이 틈 — 카드는 그대로
      else { hideTip(); return; }
    }
    anchor.current = el;
    const next = readTip(el, false);
    const same = (Object.keys(next) as (keyof typeof next)[]).every((k) => next[k] === tip[k] || k === 'jump');
    if (!same) setTip(next);
  });
  // 카드가 떠 있는 동안 창 전체에서 받는 무조건 닫기 신호 — 띠 밖으로 나간 마우스·누름(접기 단추 포함)·키(⌘B)·창 포커스 잃음·화면 숨김
  const tipOpen = !!tip;
  useEffect(() => {
    if (!tipOpen) return;
    const move = (e: PointerEvent) => {
      pt.current = { x: e.clientX, y: e.clientY };
      if (!navRef.current?.contains(e.target as Node)) leave();
    };
    const vis = () => { if (document.hidden) hideTip(); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerdown', hideTip, true);
    document.addEventListener('keydown', hideTip, true);
    window.addEventListener('blur', hideTip);
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerdown', hideTip, true);
      document.removeEventListener('keydown', hideTip, true);
      window.removeEventListener('blur', hideTip);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [tipOpen]);
  // 쉬는 참모 깨우기 — click 하나에만 기대지 않는다(윈도우에서 호버 카드가 막 뜬 첫 누름은 click 이 안 왔다, 2026-10-15). 눌렀다 뗌(pointerup)도 깨우고 둘이 겹치면 한 번만
  const pressed = useRef<string | null>(null);
  const woke = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const wake = (r: RailResting) => {
    const w = wakeOnce(woke.current.key === r.key ? woke.current.at : 0, Date.now()); // 다른 칸은 따로 — 연달아 둘을 깨울 수 있게
    woke.current = { key: r.key, at: w.at };
    if (w.wake) r.onWake();
  };
  // 펼침 창(띠 RA) — 잠든 참모·더보기·+ 메뉴. 누른 칸 옆에, 칸 아래 끝(+ 는 위 끝)에 맞춘다
  const [pop, setPop] = useState<{ kind: 'rest' | 'more' | 'new'; at: DOMRect; from: HTMLElement } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const openPop = (kind: 'rest' | 'more' | 'new') => (e: React.MouseEvent<HTMLElement>) => {
    const from = e.currentTarget;
    hideTip();
    setPop((p) => (p?.kind === kind ? null : { kind, at: from.getBoundingClientRect(), from }));
  };
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!el || !pop) return;
    const nav = navRef.current?.getBoundingClientRect();
    const h = el.offsetHeight;
    const top = pop.kind === 'new' || pop.at.top + h <= window.innerHeight - 8 ? pop.at.top : pop.at.bottom - h;
    el.style.left = `${Math.round((nav?.right ?? pop.at.right) + 8)}px`;
    el.style.top = `${Math.round(Math.max(8, Math.min(top, window.innerHeight - h - 8)))}px`;
  }, [pop]);
  // 펼침 창 닫기 — 바깥 누름(여는 칸은 빼고: 그 칸 click 이 토글한다)·Esc·창 포커스 잃음
  useEffect(() => {
    if (!pop) return;
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!popRef.current?.contains(t) && !pop.from.contains(t)) setPop(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setPop(null); };
    const blur = () => setPop(null);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', blur);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key); window.removeEventListener('blur', blur); };
  }, [pop]);
  const schedPop = sched && (
    <button className={`rail-fn ${sched.on ? 'on' : ''}`} aria-pressed={sched.on} onClick={sched.onToggle} aria-label={tr('예약', 'Scheduled')} title={tr('예약', 'Scheduled')}><IconCalendarClock /></button>
  );
  const schedBtn = sched && (
    <button className={`rail-fn ${sched.on ? 'on' : ''}`} aria-pressed={sched.on} onClick={sched.onToggle} aria-label={tr('예약', 'Scheduled')} data-tip={sched.on ? tr('예약 닫기', 'Close scheduled') : tr('예약', 'Scheduled')}><IconCalendarClock /></button>
  );
  const fold = <IconButton className="rail-fold" label={expandLabel ?? (wide ? tr('패널 접기', 'Collapse panel') : tr('패널 펼치기', 'Expand panel'))} title="" data-tip={wide ? tr('패널 접기', 'Collapse panel') : tr('패널 펼치기', 'Expand panel')} data-tip-key={keyLabel('⌘B', IS_WIN)} onClick={onExpand}><IconChevron /></IconButton>;
  return (
    <nav ref={navRef} className={`lk-strip ${wide ? 'wide' : ''} ${joined ? 'joined' : ''}`} style={wide ? { width, flexBasis: width } : undefined} aria-label={tr('참모', 'Assistants')} data-dragging={drag ? true : undefined}
      onPointerOver={over} onPointerLeave={leave}>
      {wide && onWidth && <Grip side="right" width={width} onWidth={onWidth} min={200} max={360} />}
      {/* 접기·펼치기는 기능 줄과 따로 띠 맨 위(207.png — 기능 아이콘 사이에 끼어 이상했다) — 펼침은 오른쪽 끝, 접힘은 가운데. 창 모서리와도 멀다(206.png) */}
      {home && (
        <button className={`lk-av rail-home ${home.on ? 'on' : ''}`} onClick={home.onOpen} aria-current={home.on || undefined}
          aria-label={tr('홈', 'Home')} data-tip={tr('홈', 'Home')} data-tip-sub={tr('전체 한눈에', 'Everything at a glance')}>
          <span className="lk-av-pic"><IconHome /></span>
        </button>
      )}
      {top}
      {(top || home) && <i className="far-sep" aria-hidden="true" />}
      <div className="rail-top">{fold}</div>
      {avatars.map((a, i) => {
        const shift = !drag ? 0 : a.id === drag.id ? drag.dy : tabShift(i, drag.from, drag.to, drag.step);
        return (
          <button key={a.flip ?? a.id} ref={speaking === a.id ? speakGlowRef : undefined} className={`lk-av ${a.on ? 'on' : ''}${speaking === a.id ? ' st-speak' : ''}${drag?.id === a.id ? ' rail-drag' : ''}${a.phase ? ` lk-ph ph-${a.phase}` : ''}`}
            style={{ ...orchVars(a.color), ...(shift ? { transform: `translateY(${shift}px)` } : {}) } as React.CSSProperties}
            onPointerDown={down(a.id, i)} onClick={() => { if (!dragged.current && !a.phase) onPick(a.id); }}
            onDoubleClick={onRename && !a.phase ? () => onRename(a.id) : undefined} onContextMenu={onMenu && !a.phase ? (e) => onMenu(e, a.id) : (e) => e.preventDefault()}
            aria-label={a.phaseText ? `${a.label} · ${a.phaseText}` : a.label} aria-current={a.on || undefined} aria-busy={a.phase ? true : undefined} data-flip={a.flip ?? a.id} data-flip-alt={a.flipAlt} data-orch-drop={a.phase ? undefined : a.id}
            data-tip={a.label} data-tip-sub={a.phaseText ?? a.role} data-tip-dot={a.phase === 'stopping' ? 'off' : a.phase ? 'rest' : dotOfPip(a.pip)} data-tip-color={a.color} data-tip-key={i < 9 && !a.phase ? keyLabel(`⌘${i + 1}`, IS_WIN) : undefined}>
            <span className="lk-av-pic">{a.node}{a.pip && !a.phase && <i className={`lk-pip p-${a.pip}`} aria-hidden="true" />}{a.phase && <i className={`lk-ph-dot ph-${a.phase}`} aria-hidden="true" />}</span>
            {wide && <span className="lk-av-tx"><b>{a.label}</b>{(a.phaseText ?? a.role) && <span className={a.phaseText ? 'lk-ph-tx' : undefined}>{a.phaseText ?? a.role}</span>}</span>}
          </button>
        );
      })}
      {group && group.count > 0 && (
        <button className="lk-av grp" onClick={group.onOpen} aria-label={group.label} data-tip={group.label} data-tip-sub={groupNames}>
          <span className="lk-av-pic"><IconPeople /><b className="lk-grp-n">{group.count}</b></span>
          {wide && <span className="lk-av-tx"><b>{tr('도우미', 'Helpers')}</b>{groupNames && <span>{groupNames}</span>}</span>}
        </button>
      )}
      {/* 새 참모 + — 넓어도 아이콘만(익숙한 동작, 아이콘+글자 줄 금지) */}
      {onNew && <IconButton size="l" className="rail-new" label={tr(`${assistant()} 하나 더`, `One more ${assistant()}`)} title="" data-tip={tr(`${assistant()} 하나 더`, `One more ${assistant()}`)} data-tip-key={keyLabel('⌘⇧T', IS_WIN)} onClick={onTeam ? openPop('new') : onNew}><IconPlus /></IconButton>}
      {extra}
      <span className="lk-sp" />
      {wide && resting.length > 0 && <span className="lk-cap">{tr(`쉬는 ${assistant()} ${resting.length}`, `Resting ${resting.length}`)}</span>}
      {wide && resting.length > 0 && <div className="lk-rests">
        {resting.map((r) => (
          <button key={r.key} data-flip={r.key} className="lk-av rest" onPointerDown={(e) => { if (e.button === 0) pressed.current = r.key; }}
            onPointerUp={(e) => { if (e.button === 0 && !e.ctrlKey && pressed.current === r.key) wake(r); pressed.current = null; }}
            onClick={() => wake(r)} onContextMenu={r.onMenu} aria-label={tr(`${r.label} 깨우기`, `Resume ${r.label}`)}
            data-tip={r.label} data-tip-sub={tr('쉬는 중 — 누르면 깨움', 'Resting — click to resume')} data-tip-dot="off">{r.node}</button>
        ))}
      </div>}
      {wide ? <div className="lk-foot">{schedBtn}{fns}</div> : (
        <>
          {/* 띠 RA(2026-10-24 사용자) — 잠든 참모는 얼굴 겹친 칸 하나, 예약·기능은 더보기 하나. 참모 10·잠든 5 에서도 안 넘친다 */}
          {resting.length > 0 && (
            <button className={`lk-av rest-fold ${pop?.kind === 'rest' ? 'open' : ''}`} onClick={openPop('rest')} aria-expanded={pop?.kind === 'rest'}
              aria-label={tr(`쉬는 ${assistant()} ${resting.length}`, `Resting ${resting.length}`)} data-tip={tr(`쉬는 ${assistant()} ${resting.length}`, `Resting ${resting.length}`)} data-tip-sub={tr('누르면 목록', 'Click for the list')} data-tip-dot="off">
              <span className="rest-faces" aria-hidden="true">{resting.slice(0, 3).map((r) => <span key={r.key}>{r.node}</span>)}</span>
              <b className="rest-n">{resting.length}</b>
            </button>
          )}
          {(schedBtn || fns) && (
            <button className={`rail-fn rail-more ${pop?.kind === 'more' ? 'on' : ''}`} onClick={openPop('more')} aria-expanded={pop?.kind === 'more'}
              aria-label={tr('더보기', 'More')} data-tip={tr('더보기', 'More')} data-tip-sub={tr('예약·리플레이·도구·하니터·리뷰', 'Scheduled, replay, tools, Harnitor, review')}>
              <IconMore />{moreDot && <i className="rail-dot" aria-hidden="true" />}
            </button>
          )}
        </>
      )}
      {pop && createPortal(
        <div ref={popRef} className={`rail-pop k-${pop.kind}`} role="dialog" aria-label={pop.kind === 'rest' ? tr(`쉬는 ${assistant()}`, 'Resting') : pop.kind === 'more' ? tr('더보기', 'More') : tr('새로', 'New')}>
          {pop?.kind === 'rest' && (
            <>
              <div className="rail-pop-h"><b>{tr(`쉬는 ${assistant()} ${resting.length}`, `Resting ${resting.length}`)}</b><span>{tr('누르면 깨움', 'Click to resume')}</span></div>
              {resting.map((r) => (
                <button key={r.key} className="lk-av rest" onPointerDown={(e) => { if (e.button === 0) pressed.current = r.key; }}
                  onPointerUp={(e) => { if (e.button === 0 && !e.ctrlKey && pressed.current === r.key) { wake(r); setPop(null); } pressed.current = null; }}
                  onClick={() => { wake(r); setPop(null); }} onContextMenu={r.onMenu} aria-label={tr(`${r.label} 깨우기`, `Resume ${r.label}`)}>
                  <span className="lk-av-pic">{r.node}</span><span className="lk-av-tx"><b>{r.label}</b></span>
                </button>
              ))}
            </>
          )}
          {pop?.kind === 'more' && <div className="rail-pop-fns" onClick={() => setPop(null)}>{schedPop}{popFns ?? fns}</div>}
          {pop?.kind === 'new' && onTeam && (
            <>
              <button className="rail-pop-row" onClick={() => { setPop(null); onNew?.(); }}>
                <span>{tr(`${assistant()} 하나 더`, `One more ${assistant()}`)}</span><kbd>{keyLabel('⌘⇧T', IS_WIN)}</kbd>
              </button>
              <button className="rail-pop-row" onClick={() => { setPop(null); onTeam.open(); }}>
                <span>{onTeam.label}</span>
              </button>
              {onTeam.room && (
                <button className="rail-pop-row" onClick={() => { setPop(null); onTeam.room!.open(); }}>
                  <span>{onTeam.room.label}</span>
                </button>
              )}
            </>
          )}
        </div>,
        document.body,
      )}
      {tip && !drag && createPortal(
        <div ref={tipEl} className={`rail-tip ${tip.jump ? 'jump' : ''}`} style={{ left: Math.round(tip.x) }} role="tooltip">
          <div className={`rail-tip-in ${tipDone ? 'done' : ''}`} key={tip.jump ? tip.name : 'slide'} onAnimationEnd={() => setTipDone(true)}>
            <span className="rail-tip-head">
              {tip.dot && <i className={`lk-dot d-${tip.dot}`} style={tip.color ? ({ '--working': tip.color, '--text-3': tip.color } as React.CSSProperties) : undefined} aria-hidden="true" />}
              <b>{tip.name}</b>{tip.key && <kbd>{tip.key}</kbd>}
            </span>
            {tip.sub && <span className="rail-tip-sub">{tip.sub}</span>}
          </div>
        </div>,
        document.body,
      )}
    </nav>
  );
}
