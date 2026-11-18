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

/** 받기 전 뼈대 줄 n 개 — 고정·순서·프사·목록을 아직 모를 때 기본값·'없어요' 글 대신(2026-11-16 사용자 "잠깐 초기화 상태에서 맞춰져").
 *  높이는 참모 줄(.m-orch, 프사 44)과 같게 — 받으면 같은 자리에 진짜 줄이 들어온다 */
export function SkelRows({ n, size = 44 }: { n: number; size?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="m-orch m-orch-skel" aria-hidden="true">
          <span className="m-av-skel" style={{ width: size, height: size }} />
          <span className="m-orch-text"><span className="m-orch-top"><span className="m-skel-line m-skel-name" /></span><span className="m-orch-sub"><span className="m-orch-line m-skel-line" /></span></span>
        </div>
      ))}
    </>
  );
}
