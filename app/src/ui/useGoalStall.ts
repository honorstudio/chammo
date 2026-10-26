// 오래 멈춘 목표 — 맡긴 참모 입력칸에 [앱] 한 줄. 판단은 domain/goalStall, 스위치는 '세션 자동 정리'(useAutoTidy 와 같은 길).
// 1분마다 하나씩(24시간·날짜 판정이라 촘촘할 필요 없다). 같은 목표는 하루 한 번 — 마지막으로 알린 때를 남긴다
import { useEffect, useRef } from 'react';
import { sendToSession } from '../data/tauri';
import { GOAL_STALL_AGAIN_MS, pickGoalStall, stallText } from '../domain/goalStall';
import type { Session } from '../domain/session';
import type { TaskEvent } from '../domain/tasks';
import { every } from './poll';
import { TIDY_POLL_MS } from './useAutoTidy';

const LAST_KEY = 'goalStallLast';
const loadLast = (): Map<string, number> => {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as Record<string, number>));
  } catch {
    return new Map();
  }
};
const saveLast = (m: Map<string, number>, now: number) => {
  // 이틀 지난 것은 버린다 — 다시 알릴 때가 된 열쇠라 남길 까닭이 없다
  for (const [k, at] of m) if (now - at > 2 * GOAL_STALL_AGAIN_MS) m.delete(k);
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(Object.fromEntries(m)));
  } catch {
    // 못 남겨도 이번 실행 동안은 하루 한 번
  }
};

export function useGoalStall(o: { on: boolean; orchs: Session[]; events: TaskEvent[]; sessions: Session[] }) {
  const cur = useRef(o);
  cur.current = o;
  const busy = useRef(false);
  const last = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    const tick = async () => {
      const x = cur.current;
      if (!x.on || busy.current || !x.orchs.length) return;
      last.current ??= loadLast();
      const now = Date.now();
      const p = pickGoalStall(x.orchs, { events: x.events, sessions: x.sessions, now, last: last.current });
      if (!p) return;
      busy.current = true;
      const before = last.current.get(p.key);
      last.current.set(p.key, now); // 넣는 동안 다시 안 잡게 — 못 넣으면 되돌린다
      saveLast(last.current, now);
      try {
        await sendToSession(p.orch.id, stallText(p.stall, now));
      } catch {
        if (before === undefined) last.current.delete(p.key); else last.current.set(p.key, before);
        saveLast(last.current, now);
      } finally {
        busy.current = false;
      }
    };
    void tick();
    return every(() => void tick(), TIDY_POLL_MS);
  }, []);
}
