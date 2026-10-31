// 참모 줄 길게 누르기 메뉴 — 아래에서 올라오는 작은 시트. 밀기 동작(고정·재우기·깨우기·제거)을 다 모으고 이름 바꾸기를 더했다(2026-10-04 사용자).
// 메뉴 항목은 읽을 이름이라 글자(아이콘과 같이 붙이지 않음), 제거는 빨강(누르면 경고는 시트가). 이름 바꾸기는 그 자리에서 글 칸 하나 + 저장
import { useState } from 'react';
import { cleanLabel } from '../../domain/orchLabel';
import { cleanRole } from '../../domain/orchRoles';
import { PhoneRoleField } from './OrchWake';
import { orchMenu, type OrchMenuKey } from '../../domain/mobile';
import { BottomSheet } from './kit';
import { tr } from '../../i18n';

export function OrchMenu({ title, live, pinned, canPin, nick, role, onPick, onRename, onRole, onClose }: {
  title: string; live: boolean; pinned: boolean; canPin: boolean; nick: string; role: string;
  onPick: (k: Exclude<OrchMenuKey, 'rename' | 'role'>) => void; onRename: (nick: string) => Promise<void>; onRole: (role: string) => Promise<void>; onClose: () => void;
}) {
  const [naming, setNaming] = useState(false);
  const [roling, setRoling] = useState(false); // 맡은 일 고치기(2026-10-04)
  const [v, setV] = useState(nick);
  const [r, setR] = useState(role);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try { await onRename(cleanLabel(v) ?? ''); onClose(); } catch (e) { setErr(tr(`못 바꿨어요: ${(e as Error).message}`, `Couldn't change it: ${(e as Error).message}`)); } finally { setBusy(false); }
  };
  const saveRole = async () => {
    setBusy(true);
    setErr(null);
    try { await onRole(cleanRole(r)); onClose(); } catch (e) { setErr(tr(`못 바꿨어요: ${(e as Error).message}`, `Couldn't change it: ${(e as Error).message}`)); } finally { setBusy(false); }
  };
  return (
    // 길게 눌러 뜨면 손가락 밑에 항목이 놓여, 손을 떼는 순간 그 항목이 눌렸다(시뮬레이터 실측 — '재우기' 확인이 바로 뜸) — 뜬 뒤 잠깐(armMs)은 안 받는다
    <BottomSheet kind="card" label={tr(`${title} 메뉴`, `${title} menu`)} title={title} onClose={onClose} armMs={450}>
      {({ armed }) => naming ? (
        <form className="m-new" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <input className="m-new-input" value={v} maxLength={24} autoFocus enterKeyHint="done" aria-label={tr('새 이름', 'New name')} placeholder={tr('비우면 처음 이름으로', 'Leave empty to use the original name')} onChange={(e) => setV(e.target.value)} />
          {err && <div className="m-error">{err}</div>}
          <div className="m-new-row">
            <button type="button" className="m-btn" onClick={() => setNaming(false)}>{tr('취소', 'Cancel')}</button>
            <button type="submit" className="m-send" disabled={busy}>{tr('저장', 'Save')}</button>
          </div>
        </form>
      ) : roling ? (
        <form className="m-new" onSubmit={(e) => { e.preventDefault(); void saveRole(); }}>
          <PhoneRoleField value={r} onChange={setR} />
          {err && <div className="m-error">{err}</div>}
          <div className="m-new-row">
            <button type="button" className="m-btn" onClick={() => setRoling(false)}>{tr('취소', 'Cancel')}</button>
            <button type="submit" className="m-send" disabled={busy}>{tr('저장', 'Save')}</button>
          </div>
        </form>
      ) : (
        orchMenu({ live, pinned, canPin }).map((m) => (
          <button key={m.key} type="button" className={m.danger ? 'm-menu-item m-danger-ink' : 'm-menu-item'}
            onClick={() => { if (!armed) return; if (m.key === 'rename') setNaming(true); else if (m.key === 'role') setRoling(true); else { onClose(); onPick(m.key); } }}>{m.label}</button>
        ))
      )}
    </BottomSheet>
  );
}
