import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { assistant, tr } from '../i18n';
import { cleanLabel, withNick } from '../domain/orchLabel';
import { OrchAvatar } from './avatar';
import { AvatarPicker } from './avatar/AvatarPicker';
import { RoleField } from './orchRoleStore';

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

/** 새 참모 이름 짓기 — 번호 대신 별명으로 부른다(2026-10-02 사용자). 빈칸·이미 있는 이름이면 못 만든다(check = domain nickProblem) */
export function NameNew({ baseName, color, check, onMake, onCancel }: { baseName: string; color: string; check: (v: string) => string | null; onMake: (v: string, role: string) => void; onCancel: () => void }) {
  const [v, setV] = useState('');
  const [role, setRole] = useState(''); // 맡은 일 — 이름과 따로(2026-10-04 사용자 "업무 담당 vs 그냥 이름"), 비워도 된다
  const [picking, setPicking] = useState(false);
  // 프사는 기본 이름(참모-N)에 붙는다 — 만들기 전에 골라도 그 참모가 뜨면 그대로
  const realName = withNick(baseName, v || '');
  const label = cleanLabel(v) ?? tr(`새 ${assistant()}`, 'New assistant');
  const [tried, setTried] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const problem = check(v);
  const make = () => { setTried(true); if (!problem) onMake(v, role); };
  return createPortal(
    <div className="od-back" onMouseDown={onCancel}>
      <div className="od-box" role="dialog" aria-label={tr(`새 ${assistant()} 이름`, 'Name the new assistant')} onMouseDown={(e) => e.stopPropagation()}>
        <b>{tr(`새 ${assistant()} 이름`, 'Name the new assistant')}</b>
        <div className="od-newav">
          <button className="oa-btn" onClick={() => setPicking(true)} aria-label={tr('프로필 고르기', 'Choose avatar')} title={tr('프로필 고르기', 'Choose avatar')}>
            <OrchAvatar name={realName} size={56} state="rest" color={color} label={label} /><span className="oa-change" aria-hidden="true">{tr('바꾸기', 'Change')}</span>
          </button>
        </div>
        <input ref={input} value={v} onChange={(e) => setV(e.target.value)} maxLength={24} placeholder={tr('예: 개발, 디자인', 'e.g. Dev, Design')} aria-invalid={tried && !!problem}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) make(); if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }} />
        {tried && problem && <p className="od-err" role="alert">{problem}</p>}
        <RoleField value={role} onChange={setRole} onEnter={make} onEscape={onCancel} />
        {picking && <AvatarPicker name={realName} label={label} color={color} onClose={() => { setPicking(false); input.current?.focus(); }} />}
        <div className="od-foot">
          <button onClick={onCancel}>{tr('취소', 'Cancel')}</button>
          <button className="pri" onClick={make} disabled={!v.trim()}>{tr('만들기', 'Create')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 이름·맡은 일 창 — 이름을 비우고 저장하면 기본 이름으로, 맡은 일을 비우면 지움(role 이 undefined 면 이름만 — 프로젝트 세션) */
export function Rename({ current, fallback, role: role0, onSave, onCancel }: { current: string; fallback: string; role?: string; onSave: (v: string, role: string | undefined) => void; onCancel: () => void }) {
  const [v, setV] = useState(current);
  const [role, setRole] = useState(role0 ?? '');
  const save = () => onSave(v, role0 === undefined ? undefined : role);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.select(); }, []);
  return createPortal(
    <div className="od-back" onMouseDown={onCancel}>
      <div className="od-box" role="dialog" aria-label={role0 === undefined ? tr('이름 바꾸기', 'Rename') : tr('이름·맡은 일', 'Name & role')} onMouseDown={(e) => e.stopPropagation()}>
        <b>{role0 === undefined ? tr('이름 바꾸기', 'Rename') : tr('이름·맡은 일', 'Name & role')}</b>
        <input ref={input} value={v} onChange={(e) => setV(e.target.value)} maxLength={40} placeholder={fallback} aria-label={tr('이름', 'Name')}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) save(); if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }} />
        {role0 !== undefined && <RoleField value={role} onChange={setRole} onEnter={save} onEscape={onCancel} />}
        <div className="od-foot">
          <button onClick={onCancel}>{tr('취소', 'Cancel')}</button>
          <button className="pri" onClick={save}>{tr('저장', 'Save')}</button>
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
