// 앱 폴링 주기 실행기 — 앱 창이 안 보이면(뒤·가려짐·화면 잠김·덮개 닫힘) 5배 느리게, 다시 보이면 원래 주기가 지났을 때 바로 한 번(2026-10-11 사용자 승인).
// 사람을 부르는 길(세션 목록 3초 — 멈춤 감지·자동 허용, 결정 카드, 로그인 풀림)은 쓰지 않는다 — 그 주기는 그대로
import { useEffect, useState } from 'react';
import { makeEvery } from '../domain/pollEvery';
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
