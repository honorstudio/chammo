// 계정 되찾기 갈래 ② — 잃은 기기가 서버엔 살아 있을 때(chammo-relay ADR 0007 R9, 시안 docs/design-drafts/e2e-recover/v1.html TO-BE ②).
// 새 기기 8자리 → 사람이 브라우저 되찾기 페이지에 손으로(주소에 코드를 싣지 않는다) → 48시간 → 여기서 '다시 시작 마치기'. 누르기는 사람 클릭만
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { fmtRecoverCode, hoursLeft } from '../../domain/e2eRecover';
import { tr } from '../../i18n';
import { IconBack } from '../Icons';
import { IconButton } from '../kit/IconButton';
import './e2e.css';

/** 숫자 대기 화면에서 '허용해 줄 기기가 없어요' — 옛 기기가 있나 묻고, 잃었으면 요청 코드 */
export function RecoverLost({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ask = (e: React.MouseEvent) => {
    if (!e.isTrusted || busy) return;
    setBusy(true);
    setErr(null);
    void invoke<{ code: string }>('e2e_recover_code').then((x) => setCode(x.code), (x: unknown) => setErr(String(x))).finally(() => setBusy(false));
  };
  const open = (e: React.MouseEvent) => {
    if (!e.isTrusted) return;
    void invoke('e2e_recover_open').catch((x: unknown) => setErr(String(x)));
  };
  const shown = fmtRecoverCode(code);
  return (
    <div className="nw-box">
      {!shown ? (
        <>
          <h3>{tr('옛 기기가 아직 있나요?', 'Do you still have your old device?')}</h3>
          <p>{tr('있으면 그 기기를 켜요 — 이 기기 카드가 뜨고 숫자로 허용하면 대화가 그대로 이어져요.', 'If so, turn it on — a card for this device appears there, and approving with the number keeps your chats.')}</p>
          <div className="nw-acts">
            <button className="btn" disabled={busy} onClick={onBack}>{tr('있어요', 'I have it')}</button>
            <button className="btn pri" disabled={busy} onClick={ask}>{tr('잃어버렸어요', 'I lost it')}</button>
          </div>
        </>
      ) : (
        <>
          <h3>{tr('요청 코드', 'Request code')}</h3>
          <div className="nw-big" aria-label={tr(`요청 코드 ${shown}`, `Request code ${shown}`)}>{shown}</div>
          <p>{tr('브라우저에서 되찾기 페이지를 열고 구글에 다시 로그인한 뒤 이 코드를 직접 넣어 주세요. 30분 안에요.', 'Open the recovery page in your browser, sign in to Google again, then type this code yourself — within 30 minutes.')}</p>
          <div className="nw-acts">
            <IconButton size="l" tone="line" label={tr('뒤로', 'Back')} onClick={onBack}><IconBack /></IconButton>
            <button className="btn pri" onClick={open}>{tr('되찾기 페이지 열기', 'Open recovery page')}</button>
          </div>
        </>
      )}
      {err && <div className="su-error">{err}</div>}
    </div>
  );
}

/** 이 기기가 낸 요청 — 남은 시간·취소 */
export function RecoverWait({ onLater, onChanged }: { onLater: () => void; onChanged: () => void }) {
  const [readyAt, setReadyAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void invoke<{ readyAt?: number } | null>('e2e_recover_state').then((r) => setReadyAt(r?.readyAt ?? 0), () => {});
  }, []);
  const cancel = (e: React.MouseEvent) => {
    if (!e.isTrusted || busy) return;
    setBusy(true);
    setErr(null);
    void invoke('e2e_recover_cancel').then(onChanged, (x: unknown) => setErr(String(x))).finally(() => setBusy(false));
  };
  const h = hoursLeft(readyAt, Date.now());
  return (
    <div className="nw-box">
      <h3>{readyAt ? tr(`다시 시작까지 ${h}시간`, `${h}h until restart`) : tr('다시 시작을 기다려요', 'Waiting to restart')}</h3>
      <p>{tr('그 사이 옛 기기를 찾으면 그 기기에서 허용하세요. 대화가 이어져요. 요청은 내 다른 기기에도 보이고, 거기서 취소할 수 있어요', 'If you find your old device meanwhile, approve there. Your chats carry over. Your other devices see the request too and can cancel it.')}</p>
      <div className="nw-acts">
        <button className="btn" disabled={busy} onClick={cancel}>{tr('요청 취소', 'Cancel request')}</button>
        <button className="btn pri" disabled={busy} onClick={onLater}>{tr('계속 쓰기', 'Continue')}</button>
      </div>
      {err && <div className="su-error">{err}</div>}
    </div>
  );
}

/** 48시간이 찼다 — 마치기 */
export function RecoverReady({ onLater, onDone }: { onLater: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const finish = (e: React.MouseEvent) => {
    if (!e.isTrusted || busy) return;
    setBusy(true);
    setErr(null);
    void invoke('e2e_recover_finish').then(onDone, (x: unknown) => setErr(String(x))).finally(() => setBusy(false));
  };
  return (
    <>
      <h1>{tr('이제 다시 시작할 수 있어요', 'You can restart now')}</h1>
      <ul className="lg-list">
        <li>{tr('잃어버린 기기는 로그아웃돼요', 'Your lost devices are signed out')}</li>
        <li>{tr('팀원 화면에 내 보안 번호가 바뀌었다고 떠요', 'Teammates will see that your safety number changed')}</li>
        <li>{tr('지난 대화는 이 기기에서 바로 열리지 않아요 — 잠금 열쇠가 옛 기기에만 있었어요', "Past messages won't open here right away — their keys were only on your old devices")}</li>
      </ul>
      <div className="lg-acts">
        <button className="btn pri su-go" disabled={busy} onClick={finish}>{tr('다시 시작 마치기', 'Finish restart')}</button>
        <button className="btn su-go" disabled={busy} onClick={onLater}>{tr('나중에', 'Later')}</button>
      </div>
      {err && <div className="su-error">{err}</div>}
    </>
  );
}
