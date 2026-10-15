// 모드 Svg 칸 — 거른 SVG 를 <img> 로. 줄이기·끄기(ui/calm)·사람이 안 볼 때(ui/attention)·칸이 화면에 안 보일 때(가려진 탭·접힌 칸·스크롤 밖)는 정지판(still).
// <img> 안 SVG 는 점 하나만 움직여도 그림 전체를 매 프레임 다시 그린다(렌더러 CPU 10~12% → 정지판 2.5~2.9%, 2026-10-12 mode-showcase).
// <img> 안 SVG 는 앱 테마도 못 봐서 지금 테마를 못 박아 그린다(2026-10-16 폰 다크). 주소는 그림·테마·움직임이 바뀔 때만 다시 만든다
import { useEffect, useMemo, useRef, useState } from 'react';
import { svgSrc, svgStillSrc } from '../../domain/modeSvg';
import { useScheme } from '../scheme';
import { calmLevel, onCalm } from '../calm';
import { isAttended, onAttention } from '../attention';

export function ModeSvg({ svg, alt }: { svg: string; alt: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [calm, setCalm] = useState(() => calmLevel() !== 'full');
  const [seen, setSeen] = useState(() => isAttended());
  const [inView, setInView] = useState(true);
  useEffect(() => onCalm((c) => setCalm(c !== 'full')), []);
  useEffect(() => onAttention(setSeen), []);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => setInView(es.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const scheme = useScheme();
  const moving = !calm && seen && inView;
  const src = useMemo(() => (moving ? svgSrc : svgStillSrc)(svg, scheme), [svg, scheme, moving]);
  return <img ref={ref} className="mdv-svg" src={src ?? ''} alt={alt} draggable={false} />;
}
