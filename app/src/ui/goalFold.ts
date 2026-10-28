// 진행 칸 접힘 기억 — 참모마다·자리마다(스페이스 홈 'home'·홈 대시보드 'dash', 폰은 기기가 달라 따로) 기기 localStorage 에.
// 같은 기기 여러 창은 storage 사건으로 맞춘다(goalSeen 과 같은 모양)
import { useCallback, useEffect, useState } from 'react';

const KEY = 'goalFold.v1';

const parse = (raw: string | null): Record<string, 1> => {
  try {
    const v = JSON.parse(raw ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, 1>) : {};
  } catch {
    return {};
  }
};
/** 접혀 있나 */
export const foldGet = (raw: string | null, id: string): boolean => parse(raw)[id] === 1;
/** 접힘을 바꾼 새 값 — 펼치면 줄을 지운다(기본이 펼침) */
export const foldSet = (raw: string | null, id: string, on: boolean): string => {
  const m = parse(raw);
  if (on) m[id] = 1;
  else delete m[id];
  return JSON.stringify(m);
};

const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

export function useGoalFold(id: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => foldGet(read(), id));
  useEffect(() => {
    setOn(foldGet(read(), id));
    const sync = (e: StorageEvent) => { if (e.key === KEY) setOn(foldGet(e.newValue, id)); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [id]);
  const set = useCallback((v: boolean) => {
    setOn(v);
    try { localStorage.setItem(KEY, foldSet(read(), id, v)); } catch { /* 저장 못 해도 이번 화면에선 접힌다 */ }
  }, [id]);
  return [on, set];
}
