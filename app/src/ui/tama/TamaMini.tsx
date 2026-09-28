// 상단 바 오른쪽 작은 다마고치(시안 H-4). 누르면 떠 있는 다마고치 창 보이기·숨기기 — 전체 화면(도감·보관함)은 그 창의 "더보기"에서(사용자 2026-09-28: 누르자마자 페이지가 바뀌는 게 어색하다)
import { useEffect, useRef, useState } from 'react';
import { sceneFor } from '../../domain/tama/scene';
import type { TamaFile } from '../../domain/tama/store';
import { nameOf } from '../../domain/tama/tree';
import { AREA_H, draw, spriteOf, W } from './lcd';
import { tr } from '../../i18n';

const DOT = 1.6;

export function TamaMini({ file, onOpen, on = false }: { file: TamaFile | null; onOpen: () => void; on?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 480);
    return () => clearInterval(t);
  }, []);
  const pet = file?.pet ?? null;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(W * DOT * dpr)) { c.width = Math.round(W * DOT * dpr); c.height = Math.round(AREA_H * DOT * dpr); }
    const { scene, lit } = sceneFor(pet, Date.now(), { busy: !!file?.busy, justEvolved: false });
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    draw(c, { scene, lit, who: pet ? spriteOf(pet.egg, pet.slot) : 'egg' }, tick, dark ? 'dark' : 'light', true);
  });
  const label = pet && !pet.dead ? nameOf(pet.egg, pet.slot) : tr('다마고치', 'Pet');
  return (
    <button className={`tama-mini ${on ? 'on' : ''}`} title={on ? tr(`${label} — 눌러서 다마고치 창 숨기기`, `${label} — click to hide the pet window`) : tr(`${label} — 눌러서 다마고치 창 띄우기`, `${label} — click to show the pet window`)} onClick={onOpen}>
      <canvas ref={ref} style={{ width: W * DOT, height: AREA_H * DOT }} />
    </button>
  );
}
