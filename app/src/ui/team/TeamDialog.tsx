// 팀 겹창(팀챗 만들기·바꾸기·팀 설정·초대·팀 만들기) — 뒤를 가리는 판 + 창 가운데 카드(10-26 사용자 300.png: 투명 상자가 팀 홈 머리 위에 겹쳐 엉켰다).
// 판을 누르거나 Esc 면 닫고, Tab 은 카드 안에서만 돈다. 닫으면 연 자리로 포커스를 돌려준다
import { useEffect, useRef } from 'react';
import { trapNext } from '../../domain/trapFocus';
import './team.css';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function TeamDialog({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const card = useRef<HTMLDivElement>(null);
  // 연 자리 — 그리기 전에 잡는다(안쪽 autoFocus 가 효과보다 먼저 포커스를 가져간다)
  const back = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    // 포커스가 밖이면(안쪽 autoFocus 가 없거나 개발판 StrictMode 가 효과를 두 번 돌릴 때) 첫 글 칸, 없으면 카드에 — 키가 뒤 화면으로 가지 않게
    const el = card.current;
    if (el && !el.contains(document.activeElement)) (el.querySelector<HTMLElement>('input:not([type="checkbox"]), textarea') ?? el).focus({ preventScroll: true });
    return () => back.current?.focus?.({ preventScroll: true });
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    const el = card.current;
    if (!el) return;
    if (e.key === 'Escape') {
      // 안에 또 뜬 카드·메뉴(내 프로필·더보기·확인 창)가 있으면 그쪽이 먼저 닫힌다
      if (el.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') || e.nativeEvent.isComposing) return;
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    const j = trapNext(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
    if (j === -1) return;
    e.preventDefault();
    if (j >= 0) items[j]!.focus();
  };
  return (
    <div className="tmx-dlg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={card} className="tmx-dlg-card" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={onKey}>{children}</div>
    </div>
  );
}
