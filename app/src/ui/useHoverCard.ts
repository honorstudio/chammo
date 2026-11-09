import { useEffect, useRef, useState, type RefObject } from 'react';

/** 위 띠 칩에 올리면 뜨는 칸 — 부하 칩·오늘 한 일이 같이 쓴다. 올린 뒤 150ms 에 열고, 칩·칸을 벗어나면 220ms 뒤 닫고, Esc 로 닫는다 */
export function useHoverCard(chip: RefObject<HTMLButtonElement | null>) {
  const [at, setAt] = useState<DOMRect | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const open = (now = false) => {
    window.clearTimeout(timer.current);
    const go = () => { if (chip.current) setAt(chip.current.getBoundingClientRect()); };
    if (now) go(); else timer.current = window.setTimeout(go, 150);
  };
  const close = (now = false) => {
    window.clearTimeout(timer.current);
    if (now) setAt(null); else timer.current = window.setTimeout(() => setAt(null), 220);
  };
  useEffect(() => {
    if (!at) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setAt(null); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [at]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { at, open, close };
}
