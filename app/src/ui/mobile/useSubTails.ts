// 폰 세션판 — 떠 있는 동안 하위 세션 대화 꼬리(/api/tails, 12개씩 나눠)를 15초마다 받는다. 판단은 domain/mobile subStatus(데스크톱과 같은 activityStatus)
import { useEffect, useRef, useState } from 'react';
import { readTails } from '../../data/web';
import { makePoller } from '../../domain/poller';
import type { Session } from '../../domain/session';
import { remember, remembered } from './memo';

export function useSubTails(sessions: Session[]): Record<string, string> {
  // 지난번 꼬리(메모리 기억)로 시작 — 시트·화면을 열 때마다 빈 값으로 세션 목록만 보고 짐작한 점을 그렸다가 바꿨다(2026-11-16)
  const [tails, setTails] = useState<Record<string, string>>(() => remembered<Record<string, string>>(TAILS_KEY) ?? {});
  const live = useRef(sessions);
  live.current = sessions;
  useEffect(() => {
    const p = makePoller({
      read: () => readTails(live.current.map((s) => s.sessionId).filter((x): x is string => !!x)),
      apply: (t) => { remember(TAILS_KEY, t); setTails(t); },
      everyMs: () => 15_000,
    });
    p.start();
    return () => p.stop();
  }, []);
  return tails;
}

const TAILS_KEY = 'subTails';
