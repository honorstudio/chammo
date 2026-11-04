// 앱 폴링 주기 실행기 — 앱 창이 안 보이면(뒤·가려짐·화면 잠김·덮개 닫힘) 5배 느리게, 다시 보이면 원래 주기가 지났을 때 바로 한 번(2026-10-11 사용자 승인).
// 사람을 부르는 길(세션 목록 3초 — 멈춤 감지·자동 허용, 결정 카드, 로그인 풀림)은 쓰지 않는다 — 그 주기는 그대로
import { useEffect, useRef, useState } from 'react';
import { bothShown, flagVis, makeEvery } from '../domain/pollEvery';
import type { Every } from '../domain/sharedPoll';
import { isShown, onShown } from './attention';

export const every = makeEvery({ isShown, onShown });

/** 앱 창이 보이나 — 바뀌면 다시 그린다(주기를 받는 폴러에 넘길 때) */
export function useShown(): boolean {
  const [v, setV] = useState(isShown);
  useEffect(() => {
    setV(isShown());
    return onShown(setV);
  }, []);
  return v;
}

/** 이 칸이 덮였나까지 아는 every — 앱 창이 뒤에 있을 때처럼 덮인 동안 5배 느리게, 걷히면 밀린 한 번 바로.
 *  팀 모드·다른 기기 참모가 참모 채팅을 덮어도 칸은 붙인 채 남아 1초마다 기록을 읽었다(11-01 perf-bench). 돌려주는 함수는 늘 같다(훅 의존성에 넣어도 된다) */
export function useCoverEvery(covered: boolean): Every {
  const ref = useRef<{ flag: ReturnType<typeof flagVis>; every: Every } | null>(null);
  if (!ref.current) {
    const flag = flagVis(!covered);
    ref.current = { flag, every: makeEvery(bothShown({ isShown, onShown }, flag)) };
  }
  const { flag } = ref.current;
  useEffect(() => flag.set(!covered), [flag, covered]);
  return ref.current.every;
}
