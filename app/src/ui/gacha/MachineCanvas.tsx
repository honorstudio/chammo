// 뽑기 기계 그리기 고리 — 데스크톱 상점(GachaPage)과 폰 뽑기 탭(ui/mobile)이 같이 쓴다. show 가 없으면 기다리는 기계(박자가 바뀔 때만), 있으면 매 프레임 연출
import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { brush } from '../office/draw';
import { drawMachine, drawTen, idleKey, stepParts, type Show } from './machine';

export function useMachineLoop(cv: RefObject<HTMLCanvasElement | null>, show: MutableRefObject<Show | null>) {
  useEffect(() => {
    const c = cv.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const b = brush(ctx);
    let id = 0;
    /** 기다리는 기계를 마지막에 그린 박자 — 같으면 건너뛴다(상점 QA 19, 연출 중엔 매 프레임) */
    let last = '';
    const loop = (now: number) => {
      id = requestAnimationFrame(loop);
      const s = show.current;
      const w = s?.kind === 'ten' ? 300 : 220, h = s?.kind === 'ten' ? 120 : 184;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; last = ''; }
      if (!s) {
        const k = idleKey(now);
        if (k === last) return;
        last = k;
      }
      ctx.clearRect(0, 0, w, h);
      if (s?.kind === 'ten') drawTen(b, w, h, s, now); else drawMachine(b, w, h, s, now);
      if (s) stepParts(b, s.parts);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [cv, show]);
}

/** 기계 캔버스 하나 — 붙는 순간부터 그린다(폰: 탭 칸의 기다리는 기계·방 위 연출 덮개를 따로 붙였다 뗀다). 크기는 CSS 로 */
export function MachineCanvas({ show, className }: { show: MutableRefObject<Show | null>; className?: string }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useMachineLoop(cv, show);
  return <canvas ref={cv} className={className} width={220} height={184} />;
}
