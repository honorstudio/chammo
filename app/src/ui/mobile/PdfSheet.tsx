// 폰 PDF 보기 — 사파리로 나가지 않고 앱 안에서(데스크톱 PdfView 그대로, 바이트만 폰 서버에서). 위에 '3 / 12', 두 손가락으로 키우기
// (전략 표 4번, 2026-10-03). 키우는 동안은 그림만 늘리고(transform), 손을 떼면 그 배율로 다시 그린다
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { fileBytes } from '../../data/web';
import type { ShowAt } from '../../domain/showAt';
import { IconClose } from '../Icons';

const PdfView = lazy(() => import('../reader/PdfView'));
const MIN = 100, MAX = 400;
const dist = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);

export default function PdfSheet({ path, title, at, onClose }: { path: string; title: string; at?: ShowAt; onClose: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(MIN);
  const [page, setPage] = useState({ n: 0, of: 0 });
  // 지금 쪽 — 화면 위 1/3 선을 넘은 마지막 쪽
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const on = () => {
      const box = el.querySelector<HTMLElement>('.pdfv');
      if (!box) return;
      const ps = [...box.querySelectorAll<HTMLElement>('.pdfv-page')];
      const line = box.getBoundingClientRect().top + box.clientHeight / 3;
      let n = ps.length ? 1 : 0;
      ps.forEach((p, i) => { if (p.getBoundingClientRect().top <= line) n = i + 1; });
      setPage((o) => (o.n === n && o.of === ps.length ? o : { n, of: ps.length }));
    };
    el.addEventListener('scroll', on, true);
    const t = window.setInterval(on, 800);
    return () => { el.removeEventListener('scroll', on, true); window.clearInterval(t); };
  }, []);
  // 두 손가락 — 사파리 화면 확대를 막고 PDF 만 키운다. 손을 떼면 같은 자리(비율)를 보게 다시 그린다
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let start = 0, k = 1, box: HTMLElement | null = null;
    const down = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      box = el.querySelector<HTMLElement>('.pdfv');
      start = dist(e.touches); k = 1;
      if (box) {
        const r = box.getBoundingClientRect();
        const mx = (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2 - r.left + box.scrollLeft;
        const my = (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2 - r.top + box.scrollTop;
        box.style.transformOrigin = `${mx}px ${my}px`;
      }
    };
    const move = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !start || !box) return;
      e.preventDefault();
      k = dist(e.touches) / start;
      box.style.transform = `scale(${k})`;
    };
    const up = () => {
      if (!start || !box) return;
      const b = box;
      const fy = b.scrollTop / Math.max(1, b.scrollHeight), fx = b.scrollLeft / Math.max(1, b.scrollWidth);
      b.style.transform = '';
      start = 0;
      setZoom((z) => {
        const nz = Math.round(Math.min(MAX, Math.max(MIN, z * k)));
        if (nz !== z) requestAnimationFrame(() => requestAnimationFrame(() => { b.scrollTop = fy * b.scrollHeight; b.scrollLeft = fx * b.scrollWidth; }));
        return nz;
      });
    };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
    return () => { el.removeEventListener('touchstart', down); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', up); el.removeEventListener('touchcancel', up); };
  }, []);
  return (
    <div className="m-view m-pdf" role="dialog" aria-label={title}>
      <div className="m-picker-head">
        <b className="m-view-title">{title}</b>
        {page.of > 0 && <span className="m-pdf-no">{page.n} / {page.of}</span>}
        <button type="button" className="m-rt-btn m-ico" onClick={onClose} aria-label="닫기" title="닫기"><IconClose /></button>
      </div>
      <div className="m-pdf-body" ref={wrap}>
        <Suspense fallback={<p className="m-muted m-pad">여는 중…</p>}>
          <PdfView path={path} zoom={zoom} at={at} atKey={path} load={fileBytes} />
        </Suspense>
      </div>
    </div>
  );
}
