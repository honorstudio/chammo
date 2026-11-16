// 계정 메뉴 로그인 필요 줄 E2E 받침 — 진짜 AccountPopover·AccountsSection·폰 AccountSheet + 진짜 자동 전환(useAccountAuto)에 가짜 invoke(index.html)만.
// ?s= 없음 = 위 막대 계정 칩, settings = 설정 › 계정, phone = 폰 계정 시트(data/web 은 fakeWeb). App 처럼 계정 보기를 3초마다·ACCOUNTS_CHANGED 때 다시 읽는다
import '../../src/ui/layers.css';
import '../../src/ui/styles.css';
import '../../src/ui/mobile/mobile.css';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { accountsApi } from '../../src/data/tauri';
import { ACCOUNTS_CHANGED, topLabel, type AccountsView } from '../../src/domain/accounts';
import { AccountPopover } from '../../src/ui/AccountPopover';
import { AccountsSection } from '../../src/ui/AccountsSection';
import { AccountSheet } from '../../src/ui/mobile/AccountSheet';
import { useAccountAuto } from '../../src/ui/useAccountAuto';
import { phoneText } from './fakeWeb';

const page = new URLSearchParams(location.search).get('s');

function Harness() {
  const [view, setView] = useState<AccountsView | null>(null);
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(phoneText);
  const chip = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const load = () => void accountsApi.view().then(setView, () => {});
    load();
    const t = setInterval(load, 3000);
    window.addEventListener(ACCOUNTS_CHANGED, load);
    return () => { clearInterval(t); window.removeEventListener(ACCOUNTS_CHANGED, load); };
  }, []);
  useAccountAuto(view, [], false);
  const label = topLabel(view);
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header className="topbar">
        <button ref={chip} className="e2e-chip" onClick={() => setOpen((o) => !o)}>{label?.name ?? '…'}</button>
      </header>
      {open && view && chip.current && (
        <AccountPopover view={view} anchor={chip.current.getBoundingClientRect()} chip={chip} claude="claude" fontSize={12} onClose={() => setOpen(false)} onSettings={() => {}} />
      )}
      {page === 'settings' && <div className="e2e-settings" style={{ padding: 16 }}><AccountsSection title="계정" claude="claude" fontSize={12} /></div>}
      {page === 'phone' && <div className="m-root e2e-phone"><AccountSheet text={phone} onChanged={setPhone} onClose={() => {}} /></div>}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
