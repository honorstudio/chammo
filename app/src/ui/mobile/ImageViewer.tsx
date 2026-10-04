// 그림 보기 — 화면 꽉(검은 바탕), 처음엔 그림 전체가 보이게 맞춤(contain), 두 번 톡 = 누른 곳 실제 크기(1:1) ↔ 맞춤,
// 두 손가락 = 누른 곳 기준 1배~실제 크기의 2배, 커지면 한 손가락으로 끌기, 맞춤일 때 아래로 쓸면 닫기.
// 맥은 보기용(크거나 무거우면 JPEG 2560)을 주고, 받은 것보다 크게 보이면 원본을 한 번 더 받는다(2026-10-03 사용자 v1.png "작은 칸에 흐리게").
// 긴 캡처(긴 변이 2.5배 넘게)는 처음부터 짧은 쪽을 칸에 맞추고 맨 위(왼쪽)부터, 두 번 톡 = 전체 ↔ 맞춤(전략 표 7번)
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fileImage } from '../../data/web';
import { fileError } from '../../domain/phoneFile';
import { clampIn, fitContain, longFit, maxZoom, needOriginal, realScale, zoomAt } from '../../domain/zoom';
import { IconClose } from '../Icons';

type View = { s: number; x: number; y: number };
type Pt = { x: number; y: number };
const mid = (t: TouchList): Pt => ({ x: (t[0]!.clientX + t[1]!.clientX) / 2, y: (t[0]!.clientY + t[1]!.clientY) / 2 });
const gap = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);

export function ImageViewer({ path, title, onClose }: { path: string; title: string; onClose: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<{ url: string; w: number; h: number; served: number; original: boolean } | null>(null);
  const [err, setErr] = useState<{ text: string; gone: boolean } | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [v, setV] = useState<View>({ s: 1, x: 0, y: 0 });
  const [drop, setDrop] = useState(0); // 맞춤일 때 아래로 끈 거리(닫기)
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  useEffect(() => {
    let alive = true;
    fileImage(path).then((r) => {
      if (!alive) { URL.revokeObjectURL(r.url); return; }
      urls.current.push(r.url);
      const el = new Image();
      el.onload = () => alive && setImg({ url: r.url, w: r.w || el.naturalWidth, h: r.h || el.naturalHeight, served: el.naturalWidth, original: !r.w || el.naturalWidth >= r.w });
      el.src = r.url;
    }, (e: unknown) => alive && setErr(fileError((e as Error).message)));
    return () => { alive = false; };
  }, [path]);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const on = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    on();
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = img && box.w ? fitContain(img.w, img.h, box.w, box.h) : null;
  const dpr = window.devicePixelRatio || 1;
  const long = img && box.w ? longFit(img.w, img.h, box.w, box.h) : null;
  const limit = img && fit ? Math.max(maxZoom(img.w, fit.w, dpr), (long?.s ?? 1) * 2) : 4;
  const clamp = (n: View): View => (fit ? { s: n.s, ...clampIn(n.x, n.y, n.s, fit.w, fit.h, box.w, box.h) } : n);
  // 긴 캡처는 처음 한 번 맞춤 자리로
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || !long) return;
    placed.current = true;
    setV(long);
  }, [long]);

  // 받은 그림보다 크게 보이면 원본 — 한 번만
  const askedOriginal = useRef(false);
  useEffect(() => {
    if (!img || !fit || img.original || askedOriginal.current) return;
    if (!needOriginal(v.s, fit.w, dpr, img.served, img.w)) return;
    askedOriginal.current = true;
    fileImage(path, true).then((r) => {
      urls.current.push(r.url);
      setImg((p) => (p ? { ...p, url: r.url, served: p.w, original: true } : p));
    }, () => {});
  }, [v.s, img, fit, dpr, path]);

  // 손가락 — 두 손가락은 누른 곳 기준 확대, 한 손가락은 커졌으면 끌기·맞춤이면 아래로 쓸어 닫기, 두 번 톡은 1:1 ↔ 맞춤
  const g = useRef<{ v: View; d: number; c: Pt; p: Pt; moved: boolean } | null>(null);
  const tap = useRef(0);
  const rel = (p: Pt): Pt => {
    const r = stage.current!.getBoundingClientRect();
    return { x: p.x - (r.left + r.width / 2), y: p.y - (r.top + r.height / 2) };
  };
  const start = (e: React.TouchEvent) => {
    const t = e.touches;
    g.current = { v, d: t.length > 1 ? gap(t as unknown as TouchList) : 0, c: t.length > 1 ? rel(mid(t as unknown as TouchList)) : rel({ x: t[0]!.clientX, y: t[0]!.clientY }), p: { x: t[0]!.clientX, y: t[0]!.clientY }, moved: false };
  };
  const move = (e: React.TouchEvent) => {
    const st = g.current;
    if (!st) return;
    const t = e.touches;
    if (t.length > 1) {
      if (!st.d) { start(e); return; }
      st.moved = true;
      const s = Math.min(limit, Math.max(1, (st.v.s * gap(t as unknown as TouchList)) / st.d));
      setV(clamp(zoomAt(st.v, s, st.c.x, st.c.y)));
      return;
    }
    const dx = t[0]!.clientX - st.p.x;
    const dy = t[0]!.clientY - st.p.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) st.moved = true;
    if (st.v.s > 1.01) setV(clamp({ s: st.v.s, x: st.v.x + dx, y: st.v.y + dy }));
    else setDrop(Math.max(0, dy));
  };
  const end = (e: React.TouchEvent) => {
    const st = g.current;
    if (e.touches.length) { start(e); return; }
    g.current = null;
    if (drop > 120) { onClose(); return; }
    setDrop(0);
    if (!st || st.moved || !fit || !img) return;
    const now = Date.now();
    if (now - tap.current < 300) {
      tap.current = 0;
      if (long) { setV(v.s > 1.05 ? { s: 1, x: 0, y: 0 } : long); return; } // 긴 캡처: 맞춤 ↔ 전체
      const target = v.s > 1.05 ? 1 : realScale(img.w, fit.w, dpr);
      setV(target === 1 ? { s: 1, x: 0, y: 0 } : clamp(zoomAt(v, Math.min(limit, target), st.c.x, st.c.y)));
    } else tap.current = now;
  };

  return (
    <div className="m-iv" role="dialog" aria-label={title} style={{ background: `rgba(0, 0, 0, ${1 - Math.min(0.6, drop / 400)})` }}>
      <div className="m-iv-head">
        <b className="m-iv-title">{title}</b>
        <button type="button" className="m-icon m-iv-x" onClick={onClose} aria-label="닫기" title="닫기"><IconClose /></button>
      </div>
      <div ref={stage} data-zoom className="m-iv-stage" onTouchStart={start} onTouchMove={move} onTouchEnd={end} onTouchCancel={end}>
        {img && fit && (
          <img src={img.url} alt={title} draggable={false} style={{ width: fit.w, height: fit.h, transform: `translate(${v.x}px, ${v.y + drop}px) scale(${v.s})` }} />
        )}
        {!img && !err && <div className="m-iv-wait" aria-label="그림 받는 중"><span className="m-live-dots" aria-hidden><i /><i /><i /></span></div>}
        {err && <p className={err.gone ? 'm-muted' : 'm-error'}>{err.text}</p>}
      </div>
    </div>
  );
}
