import { useCallback, useEffect, useRef, useState } from 'react';
import { accountsApi } from '../data/tauri';
import { ACCOUNTS_CHANGED, accountError, addState, moved, slotText, slotUsageText, type AccountsView } from '../domain/accounts';
import { readAuto, slotStatus } from '../domain/accountAuto';
import { pinActive, switchPinned } from './accountSwitch';
import { setupCommand } from '../domain/setup';
import { tr } from '../i18n';
import { TerminalPane } from './TerminalPane';

/**
 * 설정 > 계정 — 로그인을 칸마다 보관해 두고 손으로 바꿔 끼운다(docs/plans/2026-10-02-account-pool.md 1단계).
 * 바꾸기·보관은 저장 버튼 없이 바로 된다(설정 파일이 아니라 키체인 일이라서)
 */
export function AccountsSection({ title, claude, fontSize }: { title: string; claude?: string | null; fontSize: number }) {
  const [view, setView] = useState<AccountsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 계정 추가 중 — 시작할 때 로그인 이메일(바뀌면 새 로그인이 들어온 것) */
  const [adding, setAdding] = useState<{ start: string | null } | null>(null);
  const [newName, setNewName] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const names = useRef<Record<string, string>>({});

  const show = (v: AccountsView) => {
    setView(v);
    window.dispatchEvent(new Event(ACCOUNTS_CHANGED));
  };
  const read = useCallback(() => accountsApi.view().then(setView, (e: unknown) => setError(accountError(String(e)))), []);
  useEffect(() => { void read(); }, [read]);
  // 열어 둔 동안에도 — 자동 전환이 바꾸면 바로, 상태(소진 ~시각)는 15초마다
  useEffect(() => {
    const again = () => void read();
    window.addEventListener(ACCOUNTS_CHANGED, again);
    const t = setInterval(again, 15_000);
    return () => { window.removeEventListener(ACCOUNTS_CHANGED, again); clearInterval(t); };
  }, [read]);
  // 추가 중엔 3초마다 — 터미널 로그인이 끝나면 '보관' 버튼이 켜진다
  useEffect(() => {
    if (!adding) return;
    const t = setInterval(() => void read(), 3000);
    return () => clearInterval(t);
  }, [adding, read]);

  const act = async (f: () => Promise<AccountsView>) => {
    setBusy(true);
    setError(null);
    try {
      show(await f());
      return true;
    } catch (e: unknown) {
      setError(accountError(String(e)));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** ① 지금 로그인을 칸으로 보관 → ② 앱 안 터미널에서 claude auth login. 로그인이 없으면 바로 ② */
  const startAdd = async () => {
    setError(null);
    const v = await accountsApi.view().catch(() => null);
    if (v?.liveEmail) { // 칸에 있으면 갱신, 없으면 새 칸
      if (!(await act(() => accountsApi.capture()))) return;
    }
    setNewName('');
    setAdding({ start: v?.liveEmail ?? null });
  };
  const keepNew = async () => {
    if (await act(async () => pinActive(await accountsApi.capture(newName.trim() || undefined)))) setAdding(null);
  };

  const list = view?.accounts ?? [];
  const ids = list.map((a) => a.id);
  const state = adding && view ? addState(view, adding.start) : null;
  const unknownLive = view?.liveEmail && !view.active;
  const auto = readAuto(view?.auto);
  const now = Date.now();

  return (
    <section className="su-sec">
      <h2>{title}</h2>
      <p className="su-hint">{tr(
        '계정을 여러 개 보관해 두고 바꿔 쓸 수 있어요. 세션·기록·스킬은 그대로이고 "누구 사용량으로 쓰나"만 바뀌어요. 로그인 정보는 맥 키체인에만 보관돼요.',
        'Keep several accounts and switch between them. Sessions, history and skills stay the same — only whose usage is spent changes. Sign-ins are kept only in the macOS keychain.')}</p>
      <p className="su-hint">{tr('바꿔도 MCP 로그인은 그대로예요.', 'MCP sign-ins stay as they are when you switch.')}</p>
      <div className="su-rows">
        {list.map((a, i) => {
          const on = a.id === view?.active;
          const st = slotStatus(auto.slots[a.id], now);
          return (
            <div className="su-row acct-row" key={a.id}>
              <span className="acct-order">{i + 1}</span>
              <div className="su-row-text">
                <input className="acct-name" aria-label={tr('계정 이름', 'Account name')} defaultValue={a.name} spellCheck={false}
                  onChange={(e) => { names.current[a.id] = e.target.value; }}
                  onBlur={() => { const n = names.current[a.id]; if (n != null && n.trim() !== a.name) void act(() => accountsApi.rename(a.id, n)); }} />
                <span>
                  {[a.email, a.plan].filter(Boolean).join(' · ')}
                  {on && <b className="acct-on">{tr(' · 지금 쓰는 중', ' · In use')}</b>}
                  {auto.pinned === a.id && <b>{tr(' · 고정', ' · Pinned')}</b>}
                  <span className={st.kind === 'ok' ? '' : 'acct-st-out'}>{` · ${slotText(st, now)}`}</span>
                  {slotUsageText(auto.slots[a.id], now) && <span className="acct-usage">{` · ${slotUsageText(auto.slots[a.id], now)}`}</span>}
                </span>
              </div>
              <div className="su-row-act acct-act">
                <button className="btn su-mini" disabled={busy || i === 0} onClick={() => void act(() => accountsApi.reorder(moved(ids, i, -1)))}>{tr('위로', 'Up')}</button>
                <button className="btn su-mini" disabled={busy || i === list.length - 1} onClick={() => void act(() => accountsApi.reorder(moved(ids, i, 1)))}>{tr('아래로', 'Down')}</button>
                {!on && <button className="btn pri su-mini" disabled={busy || !!adding} onClick={() => void act(() => switchPinned(a.id))}>{tr('이 계정으로', 'Use this')}</button>}
                {/* 빼기는 두 번 — 웹뷰 confirm 창 대신 그 자리에서 한 번 더 묻는다 */}
                {removing === a.id
                  ? <>
                      <button className="btn su-mini" title={tr('보관한 로그인만 지워져요. 지금 로그인은 그대로예요.', 'Only the kept sign-in is deleted; your current sign-in stays.')} disabled={busy} onClick={() => { setRemoving(null); void act(() => accountsApi.remove(a.id)); }}>{tr('정말 빼기', 'Remove now')}</button>
                      <button className="btn su-mini" onClick={() => setRemoving(null)}>{tr('취소', 'Cancel')}</button>
                    </>
                  : <button className="btn su-mini" disabled={busy} onClick={() => setRemoving(a.id)}>{tr('빼기', 'Remove')}</button>}
              </div>
            </div>
          );
        })}
        {unknownLive && !adding && (
          <div className="su-row">
            <div className="su-row-text"><b>{view!.liveEmail}</b><span>{tr('지금 로그인인데 아직 칸에 없어요.', 'Your current sign-in is not in the list yet.')}</span></div>
            <div className="su-row-act"><button className="btn su-mini" disabled={busy} onClick={() => void act(() => accountsApi.capture())}>{tr('칸으로 보관', 'Keep it')}</button></div>
          </div>
        )}
      </div>
      {list.length > 0 && <>
        <label className="su-check acct-auto">
          <input type="checkbox" checked={auto.on} disabled={busy} onChange={(e) => void act(() => accountsApi.autoPatch({ on: e.target.checked }))} />
          {tr('자동 전환 — 쓸 수 있는 계정 중 위에 있는 것부터 쓰고, 5시간·주간이 95% 차면 다음 계정으로, 다시 열리면 돌아와요', 'Auto-switch — use the top available account first, move on at 95% of the 5-hour or weekly limit, and come back when it reopens')}
        </label>
        <p className="su-hint">{tr('"이 계정으로"를 누르면 그 계정에 머물러요(고정). 그 계정이 다 차면 다시 자동으로 넘어가요. 이미 돌고 있는 세션도 다음 요청부터 새 계정을 써요.', 'Choosing "Use this" pins that account until it fills up, then auto-switch resumes. Running sessions use the new account from their next request.')}</p>
      </>}
      {!adding
        ? <button className="btn su-add" disabled={busy} onClick={() => void startAdd()}>{tr('계정 추가', 'Add account')}</button>
        : (
          <div className="su-rows">
            <div className="su-hint">{tr('아래 터미널에서 브라우저가 열려요. 새로 쓸 계정으로 로그인하고 돌아오면 보관 버튼이 켜져요. 지금 로그인은 이미 칸으로 보관해 뒀어요.', 'A browser opens from the terminal below. Sign in with the new account and come back — the Keep button lights up. Your current sign-in is already kept.')}</div>
            <div className="su-term">
              <TerminalPane key="acct-login" command={setupCommand('login', { claude }, tr('끝났어요. 아래의 보관 버튼을 눌러 주세요.', 'Done. Press Keep below.'))}
                title={tr('계정 추가 — Claude 로그인', 'Add account — Claude sign-in')} subtitle={tr('이 창에 바로 입력할 수 있어요', 'You can type in this window')} fontSize={fontSize}
                controls={<button className="btn su-mini" onClick={() => { setAdding(null); void read(); }}>{tr('닫기', 'Close')}</button>} />
            </div>
            <div className="su-row">
              <div className="su-row-text">
                <b>{state === 'newLogin' ? tr(`새 로그인: ${view!.liveEmail}`, `New sign-in: ${view!.liveEmail}`) : state === 'known' ? tr(`이미 칸에 있는 계정이에요: ${view!.liveEmail}`, `Already in the list: ${view!.liveEmail}`) : tr('로그인 기다리는 중…', 'Waiting for sign-in…')}</b>
                <input className="acct-name" placeholder={tr('이름 (예: 작은 것)', 'Name (e.g. Small)')} value={newName} onChange={(e) => setNewName(e.target.value)} />
              </div>
              <div className="su-row-act"><button className="btn pri su-mini" disabled={busy || state !== 'newLogin'} onClick={() => void keepNew()}>{tr('보관', 'Keep')}</button></div>
            </div>
          </div>
        )}
      {error && <div className="su-error">{error}</div>}
    </section>
  );
}
