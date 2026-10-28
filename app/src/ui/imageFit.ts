import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { dragScroll, fitPercent } from '../domain/imageFit';

// 그림 칸 공통(스페이스 탭·크게 보기·리더) — 맞춤 배율을 칸 크기로 재고, 두 번 누르기·끌어서 이동을 붙인다(2026-10-28 사용자 "이미지 확대가 안 된다잉")
type Pt = { x: number; y: number };

/**
 * 그림이 불러와지면 자연 크기(css 점 = 픽셀 / devicePixelRatio)를 알고, 칸(box)의 안쪽 크기가 바뀔 때마다 맞춤 배율(%)을 다시 잰다.
 * fit 0 = 아직 모름(그림 CSS 가 옛 맞춤으로 그린다). natural = 자연 폭(css 점), 0 = 아직 안 불러옴
 */
export function useImageFit(box: React.RefObject<HTMLElement | null>) {
  const [px, setPx] = useState({ w: 0, h: 0 }); // 그림 자체 픽셀 — 화면 배율(dpr)이 바뀌면(레티나 ↔ 외장 모니터) css 점 크기가 따라 바뀐다
  const dpr = useDpr();
  const nat = useMemo(() => ({ w: px.w / dpr, h: px.h / dpr }), [px, dpr]);
  const [fit, setFit] = useState(0);
  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>) => setPx({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !nat.w) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      const h = el.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
      setFit(fitPercent({ w, h }, nat));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [box, nat]);
  return { natural: nat.w, fit, onLoad };
}

function useDpr(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const on = () => setDpr(window.devicePixelRatio || 1);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [dpr]);
  return dpr;
}

/**
 * 두 번 누르기(누른 곳 = 기준점)와 마우스로 끌어서 이동 — 칸이 넘칠 때만 끌린다(맞춤은 넘치지 않는다). 터치는 브라우저 스크롤 그대로.
 * 칸이 나중에 생겨도(종류가 바뀜) 매 렌더 다시 붙인다
 */
export function useImagePan(box: () => HTMLElement | null | undefined, onToggle: (at: Pt) => void) {
  const cb = useRef(onToggle);
  cb.current = onToggle;
  useEffect(() => {
    const el = box();
    if (!el) return;
    let from: { x: number; y: number; left: number; top: number } | null = null;
    const over = () => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType !== 'mouse' || !over()) return;
      from = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
      el.setPointerCapture(e.pointerId);
      el.classList.add('panning');
      e.preventDefault(); // 그림을 끌어 놓기로 집지 않게
    };
    const move = (e: PointerEvent) => {
      if (!from) return;
      const s = dragScroll(from, { x: e.clientX, y: e.clientY });
      el.scrollLeft = s.left;
      el.scrollTop = s.top;
    };
    const up = (e: PointerEvent) => {
      if (!from) return;
      from = null;
      el.classList.remove('panning');
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    const dbl = (e: MouseEvent) => cb.current({ x: e.clientX, y: e.clientY });
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('dblclick', dbl);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('dblclick', dbl);
      el.classList.remove('panning');
    };
  });
}
