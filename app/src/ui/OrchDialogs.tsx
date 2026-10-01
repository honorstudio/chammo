import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tr } from '../i18n';

/** 작은 확인 창 — Enter 확인, Esc 취소. 앱 창 가운데 */
export function Confirm({ title, body, ok, danger, onOk, onCancel }: { title: string; body?: string; ok: string; danger?: boolean; onOk: () => void; onCancel: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    btn.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onCancel]);
  return createPortal(
    <div className="od-back" onMouseDown={onCancel}>
      <div className="od-box" role="alertdialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <b>{title}</b>
        {body && <p>{body}</p>}
        <div className="od-foot">
          <button onClick={onCancel}>{tr('취소', 'Cancel')}</button>
          <button ref={btn} className={danger ? 'danger' : 'pri'} onClick={onOk}>{ok}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 이름 바꾸기 창 — 비우고 저장하면 기본 이름으로 */
export function Rename({ current, fallback, onSave, onCancel }: { current: string; fallback: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(current);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.select(); }, []);
  return createPortal(
    <div className="od-back" onMouseDown={onCancel}>
      <div className="od-box" role="dialog" aria-label={tr('이름 바꾸기', 'Rename')} onMouseDown={(e) => e.stopPropagation()}>
        <b>{tr('이름 바꾸기', 'Rename')}</b>
        <p>{tr(`무슨 일을 맡길지 떠올리기 쉬운 이름으로(예: 개발, 디자인). 비우면 "${fallback}"`, `A name that reminds you what it's for (e.g. Dev, Design). Empty = "${fallback}"`)}</p>
        <input ref={input} value={v} onChange={(e) => setV(e.target.value)} maxLength={40} placeholder={fallback}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) onSave(v); if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }} />
        <div className="od-foot">
          <button onClick={onCancel}>{tr('취소', 'Cancel')}</button>
          <button className="pri" onClick={() => onSave(v)}>{tr('저장', 'Save')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 오른쪽 클릭 메뉴 — 누른 자리에, 바깥을 누르거나 Esc 면 닫힘 */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: { label: string; danger?: boolean; run: () => void }[]; onClose: () => void }) {
  useEffect(() => {
    const off = () => onClose();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', off);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', off);
    return () => { window.removeEventListener('mousedown', off); window.removeEventListener('keydown', key); window.removeEventListener('blur', off); };
  }, [onClose]);
  return createPortal(
    <div className="od-menu" style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 120) }} onMouseDown={(e) => e.stopPropagation()} role="menu">
      {items.map((it) => <button key={it.label} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => { onClose(); it.run(); }}>{it.label}</button>)}
    </div>,
    document.body,
  );
}
