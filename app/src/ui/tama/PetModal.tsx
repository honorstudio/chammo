import { useEffect, useRef, type ReactNode } from 'react';
import { tr } from '../../i18n';
import { IconClose } from '../Icons';

/**
 * 위젯 '더보기' — 화면을 옮기지 않고 지금 화면 위에 다마고치(PetView)를 띄운다. 바깥·Esc·× 로 닫힌다.
 * 전엔 채팅 뷰면 돌보는 참모 대시보드(스페이스)의 펫 탭으로 화면이 넘어갔다(2026-10-10 사용자: 스페이스 말고 모달)
 */
export function PetModal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // 상점 창(OfficeModal)이 떠 있으면 그쪽 Esc 가 먼저 — 그 창이 닫힌 뒤 한 번 더 누르면 여기
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.pet-modal .office-modal')) close.current(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <div className="pet-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pet-modal-card" role="dialog" aria-modal="true" aria-label={tr('다마고치', 'Pet')}>
        <button className="pet-modal-x" onClick={onClose} aria-label={tr('닫기', 'Close')} title={tr('닫기 (Esc)', 'Close (Esc)')}><IconClose /></button>
        <div className="pet-modal-body">{children}</div>
      </div>
    </div>
  );
}
