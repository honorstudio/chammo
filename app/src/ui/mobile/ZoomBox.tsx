// 칸 안에서만 확대 — 두 손가락으로 벌리면 커지고(1~5배), 커진 채로 한 손가락으로 옮기고, 두 번 톡 치면 2.5배 ↔ 원래대로.
// 페이지 확대는 막혀 있고(zoomGuard) 이 칸([data-zoom])만 허용한다. 그림 보기·브라우저 크게 보기에 쓴다
import { useRef, useState, type ReactNode } from 'react';
import { clampPan, pinchScale, tapZoom } from '../../domain/zoom';

type View = { s: number; x: number; y: number };
const dist = (t: { [i: number]: { clientX: number; clientY: number } }) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);

export function ZoomBox({ children, className = '' }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [v, setV] = useState<View>({ s: 1, x: 0, y: 0 });
  const start = useRef<{ v: View; d: number; px: number; py: number } | null>(null);
  const lastTap = useRef(0);
  const fit = (n: View): View => {
    const r = box.current?.getBoundingClientRect();
    return { s: n.s, ...clampPan(n.x, n.y, n.s, r?.width ?? 0, r?.height ?? 0) };
  };
  return (
    <div
      ref={box}
      data-zoom
      className={`m-zoom ${className}`}
      onTouchStart={(e) => {
        const t = e.touches;
        start.current = { v, d: t.length > 1 ? dist(t) : 0, px: t[0]!.clientX, py: t[0]!.clientY };
        if (t.length === 1) {
          const now = Date.now();
          if (now - lastTap.current < 300) { setV(fit({ s: tapZoom(v.s), x: 0, y: 0 })); lastTap.current = 0; } else lastTap.current = now;
        }
      }}
      onTouchMove={(e) => {
        const st = start.current;
        if (!st) return;
        const t = e.touches;
        if (t.length > 1) {
          if (!st.d) { start.current = { ...st, d: dist(t) }; return; }
          setV(fit({ ...st.v, s: pinchScale(st.v.s, st.d, dist(t)) }));
        } else if (st.v.s > 1) {
          setV(fit({ s: st.v.s, x: st.v.x + t[0]!.clientX - st.px, y: st.v.y + t[0]!.clientY - st.py }));
        }
      }}
      onTouchEnd={(e) => { if (!e.touches.length) start.current = null; else start.current = { v, d: e.touches.length > 1 ? dist(e.touches) : 0, px: e.touches[0]!.clientX, py: e.touches[0]!.clientY }; }}
    >
      <div className="m-zoom-in" style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.s})` }}>{children}</div>
    </div>
  );
}
