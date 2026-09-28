// 세션 상태 표시 — 직접 그린 SVG(아이콘 라이브러리 금지). 모양 자체가 달라서 색을 못 봐도 구분된다
import type { ReactElement } from 'react';
import { statusLabel, type StatusKind } from '../domain/statusMark';

const SHAPE: Record<StatusKind, ReactElement> = {
  // 작업 중: 도는 호 (CSS 로 회전)
  working: (
    <>
      <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" opacity=".22" />
      <path d="M6 1.8a4.2 4.2 0 1 1-4.2 4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  // 사람 차례: 펼친 손바닥 — 손가락 넷 + 엄지 + 손바닥
  waiting: (
    <>
      <path d="M3.7 6.4V3.2M5.6 6V1.9M7.5 6V2.3M9.3 6.6V3.6M3.3 8.2 1.9 6.6" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <path d="M3 6.2h7v2.1a3.3 3.3 0 0 1-3.3 3.2h-.5A3.2 3.2 0 0 1 3 8.3z" fill="currentColor" />
    </>
  ),
  // 대기: 가만히 있는 꽉 찬 원
  idle: <circle cx="6" cy="6" r="3.6" fill="currentColor" />,
  // 세션 없음: 빈 원
  none: <circle cx="6" cy="6" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.4" />,
};

/** small = 프로젝트 줄 안에 세션마다 하나씩 늘어놓을 때 */
export function StatusMark({ kind, small }: { kind: StatusKind; small?: boolean }) {
  const label = statusLabel(kind);
  return (
    <span className={`sm ${kind}${small ? ' small' : ''}`} role="img" title={label} aria-label={label}>
      <svg viewBox="0 0 12 12" aria-hidden="true">{SHAPE[kind]}</svg>
    </span>
  );
}
