import { useEffect, useRef, useState, type RefObject } from 'react';
import { accountsApi } from '../data/tauri';
import { ACCOUNTS_CHANGED, accountError, allOut, popRows, type AccountsView } from '../domain/accounts';
import { readAuto } from '../domain/accountAuto';
import { usageLevel } from '../domain/usage';
import { tr } from '../i18n';
import { switchPinned } from './accountSwitch';

/** 남은 % 작은 막대 — 위 막대(Meter)와 같은 모양·색 */
function Bar({ label, left }: { label: string; left: number | null }) {
  if (left == null) return <span className="meter dim acct-pop-bar">{label} —</span>;
  return (
    <span className="meter acct-pop-bar">
      <span className="m-label">{label}</span>
      <span className="m-track"><span className={`m-fill ${usageLevel(left)}`} style={{ width: `${Math.max(2, left)}%` }} /></span>
      <b>{left}%</b>
    </span>
  );
}

/**
 * 위 막대 계정 칩을 누르면 뜨는 작은 창 — 등록된 계정마다 이름·5시간·주간 남은 %·'이 계정으로'.
 * 리셋 시각·몇 분 전은 작은 한 줄, 이메일·요금제는 줄에 마우스를 올리면. 창 밖을 누르거나 Esc 로 닫힌다
 */
export function AccountPopover({ view, anchor, chip, onClose, onSettings }: { view: AccountsView; anchor: DOMRect; chip: RefObject<HTMLElement | null>; onClose: () => void; onSettings: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();
  const rows = popRows(view, now);
  const auto = readAuto(view.auto);
  const out = allOut(view, now);

  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close.current(); } };
    // 칩을 누른 건 칩이 직접 여닫는다(여기서 닫으면 바로 다시 열린다)
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !chip.current?.contains(t)) close.current();
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('mousedown', down, true);
    box.current?.focus(); // 처음 한 번 — Esc 가 바로 먹게
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('mousedown', down, true); };
  }, [chip]);

  const act = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      window.dispatchEvent(new Event(ACCOUNTS_CHANGED)); // 위 막대·이 창이 새 값을 바로 읽는다
    } catch (e: unknown) {
      setError(accountError(String(e)));
    } finally {
      setBusy(false);
    }
  };

  const width = 450;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  return (
    <div ref={box} className="acct-pop" role="dialog" aria-label={tr('계정', 'Accounts')} tabIndex={-1} style={{ top: anchor.bottom + 6, left, width }}>
      {rows.map((r) => (
        <div key={r.id} className={`acct-pop-row ${r.on ? 'acct-pop-cur' : ''}`} title={r.title}>
          <div className="acct-pop-main">
            <span className="acct-pop-name">
              <b>{r.name}</b>
              {r.on && <span className="acct-pop-tag">{tr('지금', 'Now')}</span>}
              {r.pinned && <span className="acct-pop-tag">{tr('고정', 'Pinned')}</span>}
            </span>
            <Bar label={tr('5시간', '5h')} left={r.five} />
            <Bar label={tr('주간', 'Week')} left={r.week} />
            {r.on
              ? <span className="acct-pop-btn-gap" />
              : <button type="button" className="btn acct-pop-btn" disabled={busy} onClick={() => void act(() => switchPinned(r.id))}>{tr('이 계정으로', 'Use')}</button>}
          </div>
          {r.note && <div className="acct-pop-note">{r.note}</div>}
        </div>
      ))}
      {out && <div className="acct-pop-note acct-pop-out">{out}</div>}
      {error && <div className="acct-pop-note acct-pop-out">{error}</div>}
      <div className="acct-pop-foot">
        <label className="su-check">
          <input type="checkbox" checked={auto.on} disabled={busy} onChange={(e) => void act(() => accountsApi.autoPatch({ on: e.target.checked }))} />
          {tr('자동 전환', 'Auto-switch')}
        </label>
        <button type="button" className="btn acct-pop-btn" onClick={onSettings}>{tr('설정에서 더 보기', 'More in Settings')}</button>
      </div>
    </div>
  );
}
