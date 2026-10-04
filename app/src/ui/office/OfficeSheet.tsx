import { useEffect, useRef, type ReactNode } from 'react';
import { tr } from '../../i18n';
import { IconBack, IconClose, IconMaximize } from '../Icons';

/** Esc 를 그 자리 몫으로 두는 곳 — 터미널(Claude 의 Esc = 멈춤)·글칸·문서 편집기 */
const ownsEsc = (el: EventTarget | null) => !!(el as HTMLElement | null)?.closest?.('.xterm, input, textarea, [contenteditable="true"], .bn-editor');

/** 창 머리 오른쪽 아이콘 — 뒤로(창 안에서 링크를 탔을 때) · 크게(스페이스로) · 닫기(사무실로) */
export function SheetIcons({ onBack, onBig, onClose }: { onBack?: () => void; onBig: () => void; onClose: () => void }) {
  return (
    <>
      {onBack && <button className="osh-ic" onClick={onBack} aria-label={tr('뒤로', 'Back')} title={tr('뒤로', 'Back')}><IconBack /></button>}
      <button className="osh-ic" onClick={onBig} aria-label={tr('크게', 'Expand')} title={tr('크게 — 스페이스에서 열기', 'Expand — open in the space')}><IconMaximize /></button>
      <button className="osh-ic" onClick={onClose} aria-label={tr('닫기', 'Close')} title={tr('닫기 (Esc)', 'Close (Esc)')}><IconClose /></button>
    </>
  );
}

/**
 * 사무실 위 창(오피스 A 1단계, 시안 docs/design-drafts/office-space v1 A) — 사무실을 떠나지 않고 스페이스와 같은 화면(세션 칸·문서)을
 * 사무실 위에 연다. 닫으면(Esc·바깥·×) 사무실. 머리 줄은 안에 담긴 화면이 그린다(문서는 문서 바에, 세션은 osh-bar) — 머리가 두 줄이 안 되게.
 * 가장자리 오른쪽 아래를 끌면 크기 조절
 */
export function OfficeSheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // 미리보기·세션 브라우저 모달은 먼저(캡처 단계) 받아 멈추므로 여기까지 안 온다
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !e.defaultPrevented && !ownsEsc(e.target)) { e.preventDefault(); close.current(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <div className="osh" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="osh-card" role="dialog" aria-label={label}>{children}</div>
    </div>
  );
}
