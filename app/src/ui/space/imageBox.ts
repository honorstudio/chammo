// 그림 짚기(scripts/show --box x,y,w,h — 0~1 비율) — 그림 위 네모 자리. 미리보기 모달과 보관함 탭이 같이 쓴다(2026-11-01 ux-daily: 탭은 네모가 없었다)
import { useEffect, useState, type CSSProperties, type RefObject } from 'react';

export function useImageBox(imgBox: RefObject<HTMLDivElement | null>, b: [number, number, number, number] | undefined, deps: unknown[]): CSSProperties | null {
  const [boxAt, setBoxAt] = useState<CSSProperties | null>(null);
  useEffect(() => {
    const img = imgBox.current?.querySelector('img');
    if (!b || !img) { setBoxAt(null); return; }
    const place = () => setBoxAt({ left: img.offsetLeft + b[0] * img.offsetWidth, top: img.offsetTop + b[1] * img.offsetHeight, width: b[2] * img.offsetWidth, height: b[3] * img.offsetHeight });
    place();
    const ro = new ResizeObserver(place);
    ro.observe(img);
    const t = window.setTimeout(() => imgBox.current?.querySelector('.pv-box')?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }), 150);
    return () => { ro.disconnect(); window.clearTimeout(t); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return boxAt;
}
