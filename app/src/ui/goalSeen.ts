// 진행 칸 '봤음' 기록 — 끝난 조각을 사용자가 한 번 보면 사라진다(domain/goalBar seen). 기기마다 따로(데스크톱·폰 각자 localStorage),
// 같은 기기 여러 창은 storage 사건으로 맞춘다. 사흘 지난 기록은 버린다(끝난 조각은 하루면 어차피 빠진다)
import { useCallback, useEffect, useState } from 'react';

const KEY = 'goalSeen.v1';
const KEEP_MS = 3 * 24 * 3600_000;

function load(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function useGoalSeen(): [Set<string>, (units: string[]) => void] {
  const [seen, setSeen] = useState(() => new Set(Object.keys(load())));
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === KEY) setSeen(new Set(Object.keys(load()))); };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
  const mark = useCallback((units: string[]) => {
    if (!units.length) return;
    const now = Date.now();
    // 다시 읽어 이 창이 더한 것만 얹는다 — 다른 창이 쓴 걸 덮지 않게
    const m = Object.fromEntries(Object.entries(load()).filter(([, t]) => now - t < KEEP_MS));
    for (const u of units) m[u] = now;
    try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* 저장 못 해도 이번 화면에선 사라진다 */ }
    setSeen(new Set(Object.keys(m)));
  }, []);
  return [seen, mark];
}
