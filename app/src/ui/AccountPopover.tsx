import { useEffect, useRef, useState, type RefObject } from 'react';
import { accountsApi } from '../data/tauri';
import { ACCOUNTS_CHANGED, accountError, popHead, popRows, type AccountsView } from '../domain/accounts';
import { readAuto } from '../domain/accountAuto';
import { tr } from '../i18n';
import { AccountPopBody } from './AccountPopBody';
import { switchPinned } from './accountSwitch';

/**
 * 위 막대 계정 칩을 누르면 뜨는 작은 창 — 그림은 AccountPopBody(한 줄 목록 + 다가오는 초기화, 2026-10-10 시안 C).
 * 여기는 여닫기·바꾸기·자동 전환 저장만. 창 밖을 누르거나 Esc 로 닫힌다
 */
export function AccountPopover({ view, anchor, chip, onClose, onSettings }: { view: AccountsView; anchor: DOMRect; chip: RefObject<HTMLElement | null>; onClose: () => void; onSettings: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();
  const rows = popRows(view, now);
  const auto = readAuto(view.auto);

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

  const width = 300;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  return (
    <div ref={box} className="acct-pop" role="dialog" aria-label={tr('계정', 'Accounts')} tabIndex={-1} style={{ top: anchor.bottom + 6, left, width }}>
      <AccountPopBody
        rows={rows}
        head={popHead(view, now)}
        auto={auto.on}
        busy={busy}
        error={error}
        onUse={(id) => void act(() => switchPinned(id))}
        onAuto={(on) => void act(() => accountsApi.autoPatch({ on }))}
        onSettings={onSettings}
      />
    </div>
  );
}
