// 폰 세션판 — 떠 있는 동안 하위 세션 대화 꼬리(/api/tails, 12개씩 나눠)를 15초마다 받는다. 판단은 domain/mobile subStatus(데스크톱과 같은 activityStatus)
import { useEffect, useRef, useState } from 'react';
import { readTails } from '../../data/web';
import { makePoller } from '../../domain/poller';
import type { Session } from '../../domain/session';

export function useSubTails(sessions: Session[]): Record<string, string> {
  const [tails, setTails] = useState<Record<string, string>>({});
  const live = useRef(sessions);
  live.current = sessions;
  useEffect(() => {
    const p = makePoller({
      read: () => readTails(live.current.map((s) => s.sessionId).filter((x): x is string => !!x)),
      apply: setTails,
      everyMs: () => 15_000,
    });
    p.start();
    return () => p.stop();
  }, []);
  return tails;
}
