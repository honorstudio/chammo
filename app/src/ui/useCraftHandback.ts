// Craft 창에서 사람이 '돌려주기'를 누르면 Rust 가 바뀐 것 한 줄을 window.__craftHandback 으로 준다 — 그 앱을 연 참모(없으면 대표 참모) 입력칸에 [앱] 줄(화면엔 안 띄운다, 2026-10-16 사용자).
// 이벤트 listen 이 아니라 eval 로 부르는 함수 — 이 앱은 capabilities 가 없어 listen 이 막혀 있다(appctl 과 같은 길)
import { useEffect, useRef } from 'react';
import { sendToSession } from '../data/tauri';
import { handbackLine, handbackTargets } from '../domain/craftWin';
import { craftOwner } from './craftOwner';
import type { Session } from '../domain/session';

export function useCraftHandback(front: Session | undefined) {
  const to = useRef(front);
  to.current = front;
  useEffect(() => {
    const w = window as unknown as { __craftHandback?: (p: { app?: string; name: string; text: string; by?: string }) => void };
    w.__craftHandback = (p) => {
      const line = handbackLine(p.name, p.text);
      // 그 칸이 떠 있는 참모 탭 → 그 Craft 를 연 참모(scripts/craft 가 적은 세션 번호) → 대표 참모, 앞이 없으면(꺼짐) 다음
      const targets = handbackTargets(p.app ? craftOwner(p.app) : undefined, p.by, to.current?.id);
      // 그 앱을 연 세션(프로젝트 세션의 스크립트일 수 있다)이 받은 참모와 다르면 그 세션에도 — 개입으로 멈춘 스크립트를 띄운 쪽이 상황을 안다(2026-10-19)
      const tryNext = (i: number) => {
        if (i >= targets.length) return;
        void sendToSession(targets[i]!, line).then(() => { if (p.by && p.by !== targets[i]) void sendToSession(p.by, line).catch(() => {}); }, () => tryNext(i + 1));
      };
      tryNext(0);
    };
    return () => { delete w.__craftHandback; };
  }, []);
}
