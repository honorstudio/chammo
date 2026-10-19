import { useEffect, useRef } from 'react';
import { makePinchAccum, makeWheelAccum, wheelDir } from '../domain/tabZoom';
import { anchorOf, scrollShift, viewCenter, type Anchor } from '../domain/zoomAnchor';

// 그림 확대 기준점 — 배율을 바꾸기 직전 markAnchor(스크롤 칸, 커서), 다시 그린 뒤(useLayoutEffect [zoom]) applyAnchor(같은 칸).
// 커서가 없으면(키보드·단추) 보이는 칸 가운데. 스페이스 탭·크게 보기·리더가 같이 쓴다(2026-10-19 사용자)
type Pt = { x: number; y: number };
const pending = new WeakMap<HTMLElement, Anchor>();

export function markAnchor(box: HTMLElement | null | undefined, at?: Pt) {
  const img = box?.querySelector('img');
  if (!box || !img) return;
  const a = anchorOf(at ?? viewCenter(box.getBoundingClientRect()), img.getBoundingClientRect());
  if (a) pending.set(box, a); else pending.delete(box);
}

export function applyAnchor(box: HTMLElement | null | undefined) {
  const a = box && pending.get(box);
  const img = box?.querySelector('img');
  if (!box || !a || !img) return;
  pending.delete(box);
  const d = scrollShift(a, img.getBoundingClientRect());
  box.scrollLeft += d.dx;
  box.scrollTop += d.dy;
}

/** ⌘/Ctrl/Alt+휠·트랙패드 핀치(ctrlKey 붙은 wheel, 사파리 gesturechange) → 한 단계씩 step(방향, 커서). on() 이 준 칸 안에서만, 웹뷰 기본 확대는 막는다 */
export function useWheelZoom(on: () => Element | null | undefined, step: (dir: 1 | -1, at?: Pt) => void) {
  const cb = useRef({ on, step });
  cb.current = { on, step };
  useEffect(() => {
    const wheelAcc = makeWheelAccum();
    const pinch = makePinchAccum();
    const inside = (t: EventTarget | null) => !!cb.current.on()?.contains(t as Node);
    const wheel = (e: WheelEvent) => {
      if (wheelDir(e) === null || !inside(e.target)) return;
      e.preventDefault();
      const s = wheelAcc(e.deltaY);
      if (s) cb.current.step(s, { x: e.clientX, y: e.clientY });
    };
    const gStart = (e: Event) => { if (!inside(e.target)) return; e.preventDefault(); pinch.start(); };
    const gChange = (e: Event) => {
      if (!inside(e.target)) return;
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      const s = pinch.move(g.scale);
      if (s) cb.current.step(s, Number.isFinite(g.clientX) ? { x: g.clientX, y: g.clientY } : undefined); // 좌표가 없는 웹뷰면 가운데
    };
    window.addEventListener('wheel', wheel, { passive: false, capture: true });
    window.addEventListener('gesturestart', gStart, { passive: false, capture: true });
    window.addEventListener('gesturechange', gChange, { passive: false, capture: true });
    return () => {
      window.removeEventListener('wheel', wheel, { capture: true });
      window.removeEventListener('gesturestart', gStart, { capture: true });
      window.removeEventListener('gesturechange', gChange, { capture: true });
    };
  }, []);
}
