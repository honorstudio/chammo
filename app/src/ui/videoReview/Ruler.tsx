// 시간 눈금 — 왼쪽 끝이 0, 오른쪽 끝이 끝. 끌면 시간 이동, 0.3초 누르고 있으면 손가락 자리 앞뒤 15초가 펴진다(폰에서 긴 영상 정밀 이동).
// 끝자락에 손가락을 두면 펴진 칸이 그쪽으로 흐른다. 시각 계산은 domain/videoReview
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { labelClear, rulerMarks, xToTime, zoomAround, type VrNote } from '../../domain/videoReview';

const HOLD_MS = 300;
const MOVE_PX = 6;
const EDGE_PX = 24;
const FLOW_SEC_PER_TICK = 0.5;

export function Ruler({ dur, t, notes, sel, labelW, fmtLabel, label, onScrub, onScrubEnd, onZoom }: {
  dur: number; t: number; notes: VrNote[]; sel: string | null; labelW: number; fmtLabel: (t: number) => string; label: string;
  onScrub: (t: number) => void; onScrubEnd: (t: number) => void; onZoom?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [zoom, setZoom] = useState<{ lo: number; hi: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const lo = zoom?.lo ?? 0;
  const hi = zoom?.hi ?? dur;
  const span = hi - lo;
  const toX = (v: number) => (span > 0 ? ((v - lo) / span) * w : 0);
  const playX = toX(t);

  const drag = useRef<{ id: number; startX: number; moved: boolean; x: number; at: number; win: { lo: number; hi: number } | null; hold: number; flow: number } | null>(null);
  const stop = () => {
    const d = drag.current;
    if (d) { window.clearTimeout(d.hold); window.clearInterval(d.flow); }
    drag.current = null;
    setZoom(null);
  };
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps

  const xOf = (e: React.PointerEvent) => e.clientX - (box.current?.getBoundingClientRect().left ?? 0);
  const timeAt = (x: number, win: { lo: number; hi: number } | null) => xToTime(x, w, win?.lo ?? 0, win?.hi ?? dur);

  return (
    <div ref={box} className={`vr-rul${zoom ? ' zoom' : ''}`} role="slider" aria-label={label} aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(t)} tabIndex={-1}
      onPointerDown={(e) => {
        if (!(dur > 0) || !(w > 0)) return;
        e.preventDefault(); // 글 칸 초점을 안 뺏고, 눌러 글자 고르기도 안 뜬다
        box.current?.setPointerCapture(e.pointerId);
        const x = xOf(e);
        const at = timeAt(x, null);
        const d = { id: e.pointerId, startX: x, moved: false, x, at, win: null as { lo: number; hi: number } | null, hold: 0, flow: 0 };
        d.hold = window.setTimeout(() => {
          if (d.moved || drag.current !== d) return;
          d.win = zoomAround(d.at, d.x, w, dur);
          setZoom(d.win);
          onZoom?.();
          d.flow = window.setInterval(() => {
            if (!d.win) return;
            const dir = d.x < EDGE_PX ? -1 : d.x > w - EDGE_PX ? 1 : 0;
            if (!dir) return;
            const size = d.win.hi - d.win.lo;
            const nlo = Math.max(0, Math.min(dur - size, d.win.lo + dir * FLOW_SEC_PER_TICK));
            if (nlo === d.win.lo) return;
            d.win = { lo: nlo, hi: nlo + size };
            setZoom(d.win);
            d.at = timeAt(d.x, d.win);
            onScrub(d.at);
          }, 100);
        }, HOLD_MS);
        drag.current = d;
        onScrub(at);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const x = xOf(e);
        if (Math.abs(x - d.startX) > MOVE_PX) d.moved = true;
        d.x = x;
        d.at = timeAt(x, d.win);
        onScrub(d.at);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const end = timeAt(xOf(e), d.win);
        stop();
        onScrubEnd(end);
      }}
      onPointerCancel={() => { const d = drag.current; stop(); if (d) onScrubEnd(d.at); }}>
      {rulerMarks(lo, hi, w, labelW).map((m) => (
        <span key={m.t}>
          <i className={`vr-tk${m.big ? ' big' : ''}`} style={{ left: m.x }} />
          {m.big && m.x + labelW <= w + 1 && labelClear(m.x, labelW, playX) && <span className="vr-tl" style={{ left: m.x }}>{fmtLabel(m.t)}</span>}
        </span>
      ))}
      {notes.filter((n) => n.t >= lo && n.t <= hi).map((n) => <i key={n.id} className={`vr-mk${n.id === sel ? ' on' : ''}`} style={{ left: toX(n.t) }} />)}
      {t >= lo && t <= hi && <i className="vr-ph" style={{ left: playX }} />}
    </div>
  );
}
