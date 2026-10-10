// 멈춘 예약을 맨 앞 참모 입력칸에 한 줄로 넘긴다 — 판단은 domain/routine stallNotices, 멈춤을 보는 건 scripts/routine tick(stall 기록).
// 예약 세션은 예약 폴더(<데이터>/routines/…)에서 떠서 세션 목록·결정 대기함에 안 잡힌다 — 이 줄이 없으면 아무도 모른다(2026-10-09 docs-sync)
import { useEffect, useRef, useState } from 'react';
import { routineDo, sendToSession } from '../data/tauri';
import { stallNotices, type Routine } from '../domain/routine';
import type { Session } from '../domain/session';

const TOLD_KEY = 'routineStallTold';
const RETRY_MS = 30_000;
const loadTold = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(TOLD_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
};
const saveTold = (d: Set<string>) => {
  try {
    localStorage.setItem(TOLD_KEY, JSON.stringify([...d].slice(-100)));
  } catch {
    // 못 남겨도 이번 실행 동안은 한 번만 넘긴다
  }
};

export function useRoutineStalls(routines: Routine[], orch: Session | undefined) {
  const told = useRef<Set<string> | null>(null);
  const busy = useRef(false);
  const [again, setAgain] = useState(0);
  const notes = stallNotices(routines, (told.current ??= loadTold()));
  const key = notes.map((n) => n.key).join('|');
  useEffect(() => {
    if (!orch || !notes.length || busy.current) return;
    busy.current = true;
    void (async () => {
      try {
        for (const n of notes) {
          // 기록부터 — 보낸 뒤 남기다 실패하면 다음 폴링에 또 보낸다
          told.current!.add(n.key);
          saveTold(told.current!);
          const sent = await sendToSession(orch.id, n.text).then(() => true, () => {
            told.current!.delete(n.key); // 못 보냈으면(참모 화면이 막 뜨는 중 등) 30초 뒤 다시
            saveTold(told.current!);
            window.setTimeout(() => setAgain((v) => v + 1), RETRY_MS);
            return false;
          });
          // 보낸 것은 예약 기록에도 — localStorage 가 지워져도(새로 깔기) 다시 안 넘긴다. 못 남기면 다음 실행에 한 번 더 갈 뿐
          if (sent) await routineDo(n.name, 'told').catch(() => {});
        }
      } finally {
        busy.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, orch?.id, again]);
}
