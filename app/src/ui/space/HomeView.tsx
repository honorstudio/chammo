// 홈(홈·모드 v1, 사용자 10/11) — 탭 줄 맨 왼쪽 홈 탭. 가운데는 모드 — 잡고 있는 세션은 가운데 맨 아래 세션 독이 어디서나 보여 준다
// (패널 하나로 S5, 사용자 10/12 "추천대로"). 옛 참모 대시보드(o:)에만 있던 곁가지는 여기로: 위 알림(닫히지 않은 일·주인 없는 일),
// 그 아래 곁 줄(참모 할 일·결정 — 접을 수 있다 · 분신)
import type { ReactNode } from 'react';

export function HomeView({ modes, hint, aside }: { modes: ReactNode; hint?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="hm">
      {hint}
      {aside && <div className="hm-side">{aside}</div>}
      <div className="hm-modes">{modes}</div>
    </div>
  );
}
