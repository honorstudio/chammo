// 폰 화면 공용 조각(2026-10-11 컴포넌트 정리) — 화면마다 따로 짜던 것: 프사 고리(컨텍스트)·상태 점·남은 양 고리·아이콘 버튼·시트 머리.
// 아이콘은 직접 그린 SVG(Icons.tsx)만, 색은 mobile.css 토큰. 왼쪽 색 띠 없음
import type { CSSProperties, ReactNode } from 'react';
import { IconClose } from '../Icons';
import { tr } from '../../i18n';

/** 프사 둘레 고리 = 컨텍스트 %(80% 넘으면 빨강) + 오른쪽 아래 상태 점(st-work·st-wait·st-done) */
/** color = 그 참모 색(없으면 지금 참모 색 --orch-solid) */
export function AvatarRing({ pct, dot, dotLabel, color, size = 44, children }: { pct?: number; dot?: string; dotLabel?: string; color?: string; size?: number; children: ReactNode }) {
  const p = pct === undefined ? 0 : Math.round(pct);
  return (
    <span className={p >= 80 ? 'm-ring m-ring-hot' : 'm-ring'} style={{ '--p': p, ...(color ? { '--ring': color } : {}), width: size, height: size } as CSSProperties}>
      {children}
      {dot && <i className={`st-dot m-ring-dot ${dot}`} role="img" aria-label={dotLabel} />}
    </span>
  );
}

/** 남은 양 고리(계정) — 숫자 하나, 색은 usageLevel(ok·mid·low) */
export function UsageRing({ left, level }: { left: number; level: string }) {
  const c = 2 * Math.PI * 15;
  return (
    <span className={`m-uring m-${level}`} aria-hidden="true">
      <svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" className="bg" /><circle cx="18" cy="18" r="15" className="fg" style={{ strokeDasharray: `${(c * left) / 100} ${c}` }} /></svg>
      <b>{left}</b>
    </span>
  );
}

/** 아이콘 버튼 — 누르는 자리 44px, 이름은 aria-label·title */
export function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return <button type="button" className="m-icon" onClick={onClick} disabled={disabled} aria-label={label} title={label}>{children}</button>;
}

/** 시트 머리 — 제목 + (덧붙일 것들: 쪽 번호·받기 등) + 닫기 X. titleClass = 파일 보기처럼 말줄임 제목 */
export function SheetHead({ title, titleClass, onClose, closeDisabled, children }: { title: ReactNode; titleClass?: string; onClose: () => void; closeDisabled?: boolean; children?: ReactNode }) {
  return (
    <div className="m-picker-head">
      <b className={titleClass}>{title}</b>
      <span className="m-head-btns">
        {children}
        <IconBtn label={tr('닫기', 'Close')} onClick={onClose} disabled={closeDisabled}><IconClose /></IconBtn>
      </span>
    </div>
  );
}

// 시트 몸통(뒷막·손잡이·끌기·safe-area·키보드 위·닫기)은 BottomSheet 하나로
export { BottomSheet, SheetHostProvider, SheetPortal, useSheet } from './BottomSheet';
