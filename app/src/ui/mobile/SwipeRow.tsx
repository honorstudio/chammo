// 밀면 뒤 버튼이 드러나는 줄 — iOS 메일처럼. 오른쪽→왼쪽이면 오른쪽 버튼(재우기·깨우기·제거), 왼쪽→오른쪽이면 왼쪽 버튼(고정).
// 익숙한 동작이라 아이콘(2026-10-05 사용자), 되돌리기 어려운 제거는 누른 뒤 글자 확인을 부르는 쪽이 띄운다
// (2026-10-03 사용자 "달 아이콘 뭐야? 스와이프 액션으로" / "반대로 밀면 고정"). 끝까지 밀어도 실행하지 않고 버튼만 드러난다.
// 한 번에 한 줄만 열리고, 가로로 미는 동안은 세로 스크롤이 안 움직인다
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { swipeAxis, swipeSettle, swipeX } from '../../domain/swipe';

/** icon 이 있으면 아이콘만(aria-label·title = label) */
export type SwipeAction = { label: string; icon?: ReactNode; danger?: boolean; tone?: 'pin'; onPress: () => void };
const BTN = 84;
const ICON_BTN = 72;

/** onMenu = 길게 누르기(0.5초, 거의 안 움직임)·오른쪽 클릭 — 이름 바꾸기 등 메뉴. menuLabel = 화면 읽기(VoiceOver)용 숨은 메뉴 버튼 이름 */
export function SwipeRow({ id, openId, setOpenId, actions, start = [], className, onMenu, menuLabel, children }: { id: string; openId: string | null; setOpenId: (id: string | null) => void; actions: SwipeAction[]; start?: SwipeAction[]; className?: string; onMenu?: () => void; menuLabel?: string; children: ReactNode }) {
  const width = actions.reduce((w, a) => w + (a.icon ? ICON_BTN : BTN), 0);
  const startW = start.reduce((w, a) => w + (a.icon ? ICON_BTN : BTN), 0);
  const open = openId === id;
  const front = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const xRef = useRef(0);
  xRef.current = x;
  const [drag, setDrag] = useState(false);
  const moved = useRef(false);
  // 다른 줄이 열리거나 바깥을 누르면 닫힌다
  useEffect(() => { if (!open) setX(0); }, [open]);
  const live = useRef({ setOpenId, width, startW, onMenu });
  live.current = { setOpenId, width, startW, onMenu };
  useEffect(() => {
    const el = front.current;
    if (!el) return;
    let st: { x0: number; y0: number; base: number; axis: 'x' | 'y' | null } | null = null;
    let cur = 0;
    let hold: ReturnType<typeof setTimeout> | undefined;
    const down = (e: TouchEvent) => {
      if (e.touches.length !== 1) { st = null; clearTimeout(hold); return; }
      st = { x0: e.touches[0]!.clientX, y0: e.touches[0]!.clientY, base: xRef.current, axis: null };
      cur = xRef.current;
      moved.current = false;
      // 길게 누르기 — 0.5초 동안 거의 안 움직이면 메뉴(그 뒤 손을 떼도 줄 고르기로 안 넘어간다)
      clearTimeout(hold);
      if (live.current.onMenu) hold = setTimeout(() => { moved.current = true; st = null; live.current.setOpenId(null); live.current.onMenu?.(); }, 500);
    };
    const move = (e: TouchEvent) => {
      if (!st) return;
      const dx = e.touches[0]!.clientX - st.x0, dy = e.touches[0]!.clientY - st.y0;
      if (!st.axis) st.axis = swipeAxis(dx, dy);
      if (st.axis) clearTimeout(hold); // 움직이면 길게 누르기 아님
      if (st.axis !== 'x') return;
      e.preventDefault(); // 방향 잠금 — 가로로 미는 동안 목록이 위아래로 안 움직인다
      e.stopPropagation();
      moved.current = true;
      setDrag(true);
      cur = swipeX(st.base, dx, live.current.width, live.current.startW);
      setX(cur);
    };
    const up = () => {
      clearTimeout(hold);
      if (st?.axis === 'x') {
        const to = swipeSettle(cur, live.current.width, live.current.startW);
        setX(to);
        live.current.setOpenId(to ? id : null);
      }
      setDrag(false);
      st = null;
    };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
    return () => { clearTimeout(hold); el.removeEventListener('touchstart', down); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', up); el.removeEventListener('touchcancel', up); };
  }, [id]);
  const btn = (a: SwipeAction, side: 'start' | 'end') => (
    <button key={a.label} type="button" tabIndex={open ? 0 : -1} aria-label={a.icon ? a.label : undefined} title={a.icon ? a.label : undefined}
      className={`m-swipe-btn${a.danger ? ' m-danger' : ''}${a.tone === 'pin' ? ' m-pin' : ''}${side === 'start' ? ' m-start' : ''}`}
      onClick={() => { setOpenId(null); a.onPress(); }}>{a.icon ?? a.label}</button>
  );
  return (
    <div className={`m-swipe${x < 0 ? ' m-show-end' : x > 0 ? ' m-show-start' : ''} ${className ?? ''}`} data-swipe={id} onContextMenu={onMenu ? (e) => { e.preventDefault(); onMenu(); } : undefined}>
      {onMenu && <button type="button" className="m-sr" onClick={onMenu}>{menuLabel ?? '메뉴'}</button>}
      {start.length > 0 && <div className="m-swipe-acts m-swipe-start" style={{ width: startW }} aria-hidden={!open || x <= 0}>{start.map((a) => btn(a, 'start'))}</div>}
      <div className="m-swipe-acts" style={{ width }} aria-hidden={!open || x >= 0}>{actions.map((a) => btn(a, 'end'))}</div>
      <div ref={front} className="m-swipe-front" style={{ transform: `translateX(${x}px)`, transition: drag ? 'none' : undefined }}
        onClickCapture={(e) => {
          // 민 뒤의 누름, 열린 줄을 누름 = 닫기만(줄 고르기로 안 넘어간다)
          if (moved.current || open) { e.preventDefault(); e.stopPropagation(); moved.current = false; if (open) setOpenId(null); }
        }}>
        {children}
      </div>
    </div>
  );
}
