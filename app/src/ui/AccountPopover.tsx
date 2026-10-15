import { useEffect, useRef, useState, type RefObject } from 'react';
import { accountsApi } from '../data/tauri';
import { ACCOUNTS_CHANGED, accountError, accountLoginCommand, loginFixes, popHead, popRows, reloginDone, type AccountsView } from '../domain/accounts';
import { readAuto } from '../domain/accountAuto';
import { SETTLE_MS } from '../domain/login';
import { tr } from '../i18n';
import { AccountPopBody } from './AccountPopBody';
import { switchPinned } from './accountSwitch';
import { TerminalPane } from './TerminalPane';

/**
 * 위 막대 계정 칩을 누르면 뜨는 작은 창 — 그림은 AccountPopBody(한 줄 목록 + 다가오는 초기화, 2026-10-10 시안 C).
 * 여기는 여닫기·바꾸기·자동 전환 저장, 그리고 바꾸기가 칸 토큰 갱신 막힘(rate)·죽은 갱신 토큰(dead)으로 실패하면 '로그인해서 바꾸기' —
 * 지금 로그인을 그 칸에 먼저 보관하고(밖에서 로그인하면 로그인 칸이 덮인다), 창 안 터미널에서 그 계정 이메일로 claude auth login,
 * 로그인 표시가 그 계정이 되면 바꾸기(+고정)를 다시 부른다 — Rust reconcile 이 새 로그인을 그 칸에 담고 지금 칸으로 맞춘다. 창 밖을 누르거나 Esc 로 닫힌다
 */
export function AccountPopover({ view, anchor, chip, claude, fontSize, onClose, onSettings }: { view: AccountsView; anchor: DOMRect; chip: RefObject<HTMLElement | null>; claude?: string | null; fontSize: number; onClose: () => void; onSettings: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 마지막 바꾸기 실패 — 로그인으로 풀리는 것이면 버튼 */
  const [failed, setFailed] = useState<{ id: string; code: string } | null>(null);
  /** 로그인해서 바꾸는 중 — 그 칸 */
  const [relogin, setRelogin] = useState<{ id: string; email: string } | null>(null);
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

  const act = async (f: () => Promise<unknown>, id?: string) => {
    setBusy(true);
    setError(null);
    setFailed(null);
    try {
      await f();
      window.dispatchEvent(new Event(ACCOUNTS_CHANGED)); // 위 막대·이 창이 새 값을 바로 읽는다
      return true;
    } catch (e: unknown) {
      setError(accountError(String(e)));
      if (id) setFailed({ id, code: String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startRelogin = async () => {
    if (!failed) return;
    const id = failed.id, email = view.accounts.find((a) => a.id === id)?.email ?? '';
    // 지금 로그인이 칸 계정이면 그 칸에 먼저 보관 — 쓰다 갱신된 토큰을 잃지 않게(설정 '계정 추가'와 같은 순서). 칸에 없는 로그인은 안 담는다
    const ok = await act(async () => { if ((await accountsApi.view()).active) await accountsApi.capture(); });
    if (ok) setRelogin({ id, email });
  };

  // 로그인해서 바꾸는 중 — 3초마다 로그인 표시를 본다. 그 계정이 되면 한 번 더 기다렸다(키체인·표시를 다 쓸 때까지) 바꾸기+고정
  const seen = useRef(0);
  useEffect(() => {
    if (!relogin) return;
    seen.current = 0;
    let going = false;
    const t = setInterval(() => {
      if (going) return;
      void accountsApi.view().then(async (v) => {
        if (!reloginDone(v, relogin.id)) { seen.current = 0; return; }
        if (!seen.current) { seen.current = Date.now(); return; }
        if (Date.now() - seen.current < SETTLE_MS || going) return;
        going = true;
        clearInterval(t);
        await act(() => switchPinned(relogin.id)); // 실패면 오류 줄로 — 터미널은 닫는다(더 볼 게 없다)
        setRelogin(null);
      }, () => {});
    }, 3000);
    return () => clearInterval(t);
  }, [relogin]); // eslint-disable-line react-hooks/exhaustive-deps

  const width = relogin ? 460 : 300;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  return (
    <div ref={box} className="acct-pop" role="dialog" aria-label={tr('계정', 'Accounts')} tabIndex={-1} style={{ top: anchor.bottom + 6, left, width }}>
      <AccountPopBody
        rows={rows}
        head={popHead(view, now)}
        auto={auto.on}
        busy={busy}
        error={error}
        fix={!!failed && loginFixes(failed.code) && !relogin}
        onFix={() => void startRelogin()}
        onUse={(id) => void act(() => switchPinned(id), id)}
        onAuto={(on) => void act(() => accountsApi.autoPatch({ on }))}
        onSettings={onSettings}
      />
      {relogin && (
        <div className="acct-pop-term">
          <TerminalPane key={`acct-relogin-${relogin.id}`} command={accountLoginCommand(claude, relogin.email, tr('끝났어요. 잠시 뒤 이 계정으로 바뀌어요.', 'Done. It will switch to this account in a moment.'))}
            title={tr('Claude 로그인', 'Claude sign-in')} subtitle={relogin.email || tr('브라우저에서 로그인하고 돌아오세요', 'Sign in in the browser, then come back')} fontSize={fontSize} />
        </div>
      )}
    </div>
  );
}
