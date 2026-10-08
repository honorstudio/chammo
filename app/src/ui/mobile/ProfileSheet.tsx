// 폰 프로필 창 — 대시보드 머리 아바타를 누르면 아래에서 올라온다. 이름(별명)만 바꾼다(2026-10-05 사용자).
// 이름은 길게 누르기 메뉴와 같은 길(/api/rename → 맥이 쉬는 때 /rename), 번호(참모-N)는 그대로라 색·모양·목소리 배정이 안 바뀐다.
// 모양·색·목소리는 아직 데스크톱에서만(폰 쓰기 길은 roadmap 부채)
import { useState } from 'react';
import { nickChange, splitOrchName } from '../../domain/orchLabel';
import type { Session } from '../../domain/session';
import { MAvatar } from './MAvatar';
import { renamePending, usePendingNicks } from './pendingNicks';

export function ProfileSheet({ orch, orchs, onClose }: { orch: Session; orchs: Session[]; onClose: () => void }) {
  const { nickOf, nameOf } = usePendingNicks(orchs);
  const [v, setV] = useState(nickOf(orch) ?? splitOrchName(orch.name).nick ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const name = nameOf(orch);
  const save = async () => {
    const nick = nickChange(nickOf(orch) ?? splitOrchName(orch.name).nick ?? '', v);
    if (nick === null) { onClose(); return; }
    setBusy(true);
    setErr(null);
    try { await renamePending(orch.id, nick); onClose(); } catch (e) { setErr(`못 바꿨어요: ${(e as Error).message}`); } finally { setBusy(false); }
  };
  return (
    <div className="m-menu-wrap" role="dialog" aria-modal="true" aria-label={`${name} 프로필`}>
      <button type="button" className="m-pick-back m-on" aria-label="닫기" onClick={onClose} />
      <div className="m-menu">
        <div className="m-menu-title">{name} 프로필</div>
        <div className="m-prof-av"><MAvatar orch={orch} orchs={orchs} size={72} /></div>
        <form className="m-new" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <input className="m-new-input" value={v} maxLength={24} enterKeyHint="done" aria-label="이름" placeholder="비우면 처음 이름으로" onChange={(e) => setV(e.target.value)} />
          {err && <div className="m-error">{err}</div>}
          <div className="m-new-row">
            <button type="button" className="m-btn" onClick={onClose}>취소</button>
            <button type="submit" className="m-send" disabled={busy}>저장</button>
          </div>
        </form>
      </div>
    </div>
  );
}
