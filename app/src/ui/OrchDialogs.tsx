import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { menuPos, menuStep } from '../domain/ctxMenu';
import { createPortal } from 'react-dom';
import { closeOnOutside } from './outsideClose';
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
        {body && <p style={{ whiteSpace: 'pre-line' }}>{body}</p>}
        <div className="od-foot">
          <button onClick={onCancel}>{tr('취소', 'Cancel')}</button>
          <button ref={btn} className={danger ? 'danger' : 'pri'} onClick={onOk}>{ok}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 새 참모 이름 짓기 — 번호 대신 별명으로 부른다(2026-10-02 사용자). 이미 있는 이름이면 못 만든다(check = domain nickProblem).
 *  비우면 기본 이름 그대로 — 첫 설정에서 이름을 이미 물었는데 여기서 또 막아 두 번 물었다(2026-10-22 첫 사용자 QA 14) */
export function NameNew({ baseName, color, check, onMake, onCancel }: { baseName: string; color: string; check: (v: string) => string | null; onMake: (v: string, role: string) => void; onCancel: () => void }) {
  const [v, setV] = useState('');
  const [role, setRole] = useState(''); // 맡은 일 — 이름과 따로(2026-10-04 사용자 "업무 담당 vs 그냥 이름"), 비워도 된다
  const [picking, setPicking] = useState(false);
  // 프사는 기본 이름(참모-N)에 붙는다 — 만들기 전에 골라도 그 참모가 뜨면 그대로
  const realName = withNick(baseName, v || '');
  const label = cleanLabel(v) ?? baseName;
  const [tried, setTried] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const problem = v.trim() ? check(v) : null;
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
        <input ref={input} value={v} onChange={(e) => setV(e.target.value)} maxLength={24} placeholder={tr(`별명 — 예: 개발·디자인, 비우면 ${baseName}`, `Nickname — e.g. Dev, Design; empty = ${baseName}`)} aria-label={tr('별명', 'Nickname')} aria-invalid={tried && !!problem}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) make(); if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }} />
        {tried && problem && <p className="od-err" role="alert">{problem}</p>}
        <RoleField value={role} onChange={setRole} onEnter={make} onEscape={onCancel} />
        {picking && <AvatarPicker name={realName} label={label} color={color} onClose={() => { setPicking(false); input.current?.focus(); }} />}
        <div className="od-foot">
          <button onClick={onCancel}>{tr('취소', 'Cancel')}</button>
          <button className="pri" onClick={make} disabled={tried && !!problem}>{tr('만들기', 'Create')}</button>
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

/** 메뉴 한 줄 — sub 가 있으면 누를 때 그 자리에서 다음 목록으로 바뀐다(폴더 고르기·이전 판 같은 것, empty = 비었을 때 한 줄).
 *  sep = 위에 가는 줄(묶음 나누기) */
export type MenuItem = { label: string; /** 글 대신 그릴 줄(참모 고르기 — 프사 + 이름, team/OrchPick). label 은 열쇠·하위 목록 머리 */ node?: ReactNode; danger?: boolean; run?: () => void; sub?: () => MenuItem[] | Promise<MenuItem[]>; empty?: string; sep?: boolean; title?: string; /** 고른 것(정렬 기준처럼 하나 고르기) — 오른쪽 점 */ checked?: boolean };

/** 오른쪽 클릭 메뉴(앱 공용) — 누른 자리에, 창 밖으로 넘치면 왼쪽·위로 펼친다. 바깥을 누르거나 Esc 면 닫힘.
 *  ↑↓·Home·End 로 오르내리고 Enter 로 고른다, 다음 목록에선 ← 로 돌아간다 */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [stack, setStack] = useState<{ items: MenuItem[]; empty?: string; title?: string }[]>([{ items }]);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight?: number }>({ left: x, top: y });
  const cur = stack[stack.length - 1] ?? { items: [] };
  const buttons = () => [...(box.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? [])];
  const open = async (it: MenuItem) => {
    if (!it.sub) { onClose(); it.run?.(); return; }
    let next: MenuItem[] = [];
    try { next = await it.sub(); } catch { next = []; }
    setStack((s) => [...s, { items: next, empty: it.empty, title: it.label }]);
  };
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.maxHeight = '';
    const r = el.getBoundingClientRect();
    setPos(menuPos(x, y, r.width, r.height, window.innerWidth, window.innerHeight));
    el.focus({ preventScroll: true });
  }, [x, y, stack.length]);
  useEffect(() => {
    const off = () => onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key === 'Tab' || e.metaKey || e.ctrlKey) { onClose(); return; } // ⌘B·⌘W 같은 앱 단축키(띠 접기 등)도 메뉴는 닫고 지나간다
      const bs = buttons();
      const i = bs.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowLeft' && stack.length > 1) { e.preventDefault(); setStack((s) => s.slice(0, -1)); return; }
      if (e.key === 'ArrowRight' && i >= 0 && cur.items[i]?.sub) { e.preventDefault(); void open(cur.items[i]); return; }
      const j = menuStep(bs.length, i, e.key);
      if (j !== i) { e.preventDefault(); e.stopPropagation(); bs[j]?.focus(); }
    };
    const stopOutside = closeOnOutside(window, (t) => !!box.current?.contains(t as Node), onClose); // 바깥 누름(채팅 칸이 mousedown 을 삼켜도)
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', off);
    window.addEventListener('resize', off);
    return () => { stopOutside(); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', off); window.removeEventListener('resize', off); };
  }, [onClose, stack]); // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(
    <div ref={box} className="od-menu" tabIndex={-1} style={pos} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()} role="menu">
      {cur.title && <span className="od-menu-cap">{cur.title}</span>}
      {cur.items.length === 0 && <span className="od-menu-note">{cur.empty ?? tr('없어요', 'Nothing')}</span>}
      {cur.items.map((it, i) => (
        <Fragment key={`${i}:${it.label}`}>
          {it.sep && i > 0 && <i className="od-sep" role="separator" />}
          <button role="menuitem" className={[it.danger ? 'danger' : '', it.sub ? 'more' : '', it.checked ? 'on' : ''].filter(Boolean).join(' ')} title={it.title} aria-haspopup={it.sub ? 'menu' : undefined} aria-current={it.checked || undefined}
            onMouseEnter={(e) => e.currentTarget.focus({ preventScroll: true })} onClick={() => void open(it)}>{it.node ?? it.label}</button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
