// 한 마리를 작은 LCD 칸에 — 도감·보관함·혈통·몬스터 공용
import { useEffect, useRef } from 'react';
import { drawSprite } from './lcd';

const theme = () => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

/** name = 스프라이트 이름(lcd.spriteOf 로 구한 것) */
export function Sprite({ name, size }: { name: string; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = c.height = Math.round(size * (window.devicePixelRatio || 1));
    drawSprite(c, name, theme());
  }, [name, size]);
  return <canvas ref={ref} className="pv-lcd" style={{ width: size, height: size }} />;
}
