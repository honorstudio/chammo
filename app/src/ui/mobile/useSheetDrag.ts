// 폰 시트 끌기 — 채팅 시트·아래 시트·메뉴 카드가 같이 쓴다(2026-10-11 시트 공용화). 판단(속도·자리·박힘)은 domain/sheetGuard.
// 손잡이 줄은 pointer(5px 넘게 움직이면 끌기, 아니면 누르기 = onTap), 목록·시트 몸은 터치(맨 위에서 아래로일 때만 — 목록 스크롤과 안 싸우게).
// 박힘 풀기(2026-10-11 사용자 "이렇게 박히는 경우가 있음") — 끌다가 앱 전환·알림으로 손 떼는 사건을 잃으면 끌던 자리에 그대로 남았다.
// 가려지거나·돌아오거나·손 없이 1.5초 멈추면 끈 자리에서 가장 가까운 자리로 놓아 주고, 그때 값을 맥에 한 줄(phone-layout.jsonl)
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { dragStale, flickV, pullStep, SLOP, stuckLine, type SheetModel, type TrailPt } from '../../domain/sheetGuard';
import { RESUME_EVENT } from '../../domain/poller';
import { phoneDiag } from '../../data/web';

type Opts<S extends string> = {
  /** 진단 줄의 시트 종류 */
  kind: 'chat' | 'pick' | 'card';
  /** 터치로 끌 수 있는 판(콜백 ref 로 받은 요소 — 포털로 옮겨 그려져도 새 요소에 다시 붙는다) */
  el: HTMLElement | null;
  /** 이 자리에서 시작한 터치가 시트를 끌 수 있나 — 끌 수 있으면 맨 위인지 볼 스크롤 칸(없으면 { scrollTop: 0 }), 아니면 null */
  pullFrom: (target: Element) => { scrollTop: number } | null;
  model: SheetModel<S>;
  go: (s: S) => void;
  /** 진단 줄 — 보이는 화면 높이·떠난 자리 */
  vh: number;
  from?: string;
  /** 손잡이를 움직이지 않고 눌렀다 뗐을 때 */
  onTap?: () => void;
};
type Drag = { y: number; at: number; trail: TrailPt[] };

export function useSheetDrag<S extends string>(o: Opts<S>) {
  const [drag, setDrag] = useState<number | null>(null);
  // 리스너가 마지막 값을 읽게
  const live = useRef({ ...o, drawn: drag ?? o.model.rest });
  live.current = { ...o, drawn: drag ?? o.model.rest };
  const cur = useRef<Drag | null>(null);
  const press = useRef<{ y: number; t: number } | null>(null);
  const lastMove = useRef(0);

  const begin = (y: number, t: number) => { cur.current = { y, at: live.current.model.rest, trail: [{ t, y }] }; lastMove.current = Date.now(); };
  const move = (y: number, t: number) => {
    const s = cur.current;
    if (!s) return;
    lastMove.current = Date.now();
    s.trail.push({ t, y });
    if (s.trail.length > 8) s.trail.shift();
    setDrag(live.current.model.rubber(s.at + y - s.y));
  };
  const end = (y: number, t: number) => {
    const s = cur.current;
    cur.current = null;
    setDrag(null);
    if (!s) return;
    const { model, go } = live.current;
    go(model.release(s.at, s.at + y - s.y, flickV(s.trail, t, y)));
  };

  useEffect(() => {
    let touching = false;
    const release = (why: string) => {
      if (!cur.current && !press.current) return;
      const { drawn: at, model, go, kind, vh, from } = live.current;
      cur.current = null; press.current = null;
      setDrag(null);
      const to = model.nearest(at);
      go(to);
      void phoneDiag('layout-drag', stuckLine({ sheet: kind, why, at, to, vh, ...(from ? { from } : {}) }));
    };
    const onTouch = (e: TouchEvent) => { touching = e.touches.length > 0; };
    const onDown = () => { touching = true; };
    const onUp = () => { touching = false; };
    const onHide = () => { if (document.hidden) release('hide'); };
    const onShow = () => release('show');
    const onBlur = () => release('blur');
    const onResume = () => release('resume');
    const tick = window.setInterval(() => {
      if (dragStale({ dragging: !!cur.current, touching, lastMoveAt: lastMove.current, now: Date.now() })) release('stale');
    }, 500);
    const cap = { capture: true };
    const pcap = { passive: true, capture: true };
    document.addEventListener('touchstart', onTouch, pcap);
    document.addEventListener('touchend', onTouch, pcap);
    document.addEventListener('touchcancel', onTouch, pcap);
    document.addEventListener('pointerdown', onDown, cap);
    document.addEventListener('pointerup', onUp, cap);
    document.addEventListener('pointercancel', onUp, cap);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pageshow', onShow);
    window.addEventListener('blur', onBlur);
    window.addEventListener(RESUME_EVENT, onResume);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener('touchstart', onTouch, cap);
      document.removeEventListener('touchend', onTouch, cap);
      document.removeEventListener('touchcancel', onTouch, cap);
      document.removeEventListener('pointerdown', onDown, cap);
      document.removeEventListener('pointerup', onUp, cap);
      document.removeEventListener('pointercancel', onUp, cap);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pageshow', onShow);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener(RESUME_EVENT, onResume);
    };
  }, []);

  // 목록·시트 몸에서 아래로 끌기 — 브라우저 스크롤을 막아야 해서 passive:false 터치 리스너. 손잡이([data-grab])는 pointer 가 맡는다
  useEffect(() => {
    const el = o.el;
    if (!el) return;
    let st: { y: number; box: { scrollTop: number }; on: boolean } | null = null;
    const start = (e: TouchEvent) => {
      const t = e.target as Element;
      const box = e.touches.length === 1 && !t.closest?.('[data-grab]') ? live.current.pullFrom(t) : null;
      st = box ? { y: e.touches[0]!.clientY, box, on: false } : null;
    };
    const mv = (e: TouchEvent) => {
      if (!st) return;
      const y = e.touches[0]!.clientY;
      if (!st.on) {
        const step = pullStep({ dy: y - st.y, scrollTop: st.box.scrollTop });
        if (step === 'scroll') { st = null; return; }
        if (step === 'wait') return;
        st.on = true;
        begin(y, e.timeStamp);
      }
      e.preventDefault();
      move(y, e.timeStamp);
    };
    const up = (e: TouchEvent) => {
      if (st?.on) end(e.changedTouches[0]!.clientY, e.timeStamp);
      st = null;
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', mv, { passive: false });
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', mv);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', up);
    };
  }, [o.el]);

  /** 손잡이 줄 — 5px 넘게 움직이면 끌기, 아니면 누르기 */
  const grab = {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => { e.currentTarget.setPointerCapture?.(e.pointerId); press.current = { y: e.clientY, t: e.timeStamp }; },
    onPointerMove: (e: RPointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p) return;
      if (!cur.current) {
        if (Math.abs(e.clientY - p.y) <= SLOP) return;
        begin(p.y, p.t);
      }
      move(e.clientY, e.timeStamp);
    },
    onPointerUp: (e: RPointerEvent<HTMLElement>) => {
      const dragging = !!cur.current;
      press.current = null;
      if (dragging) end(e.clientY, e.timeStamp);
      else live.current.onTap?.();
    },
    onPointerCancel: () => { press.current = null; cur.current = null; setDrag(null); },
  };
  return { drag, grab };
}
