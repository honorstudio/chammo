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
  // 사람 차례: 꼬리 달린 말풍선 + 점 셋(…) — 12px·10px 에서 점이 읽히는 테두리형(2026-10-12 사용자, 손바닥에서 바꿈)
  waiting: (
    <>
      <path d="M3.2 1.9h5.6a2.3 2.3 0 0 1 2.3 2.3v2.6a2.3 2.3 0 0 1-2.3 2.3H5.6L3.1 10.9V9.1a2.3 2.3 0 0 1-2.2-2.3V4.2a2.3 2.3 0 0 1 2.3-2.3z" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" />
      <circle cx="4.1" cy="5.5" r=".8" fill="currentColor" />
      <circle cx="6" cy="5.5" r=".8" fill="currentColor" />
      <circle cx="7.9" cy="5.5" r=".8" fill="currentColor" />
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
