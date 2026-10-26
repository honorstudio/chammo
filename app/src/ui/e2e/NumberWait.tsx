// 새 기기 쪽 — 허용을 기다리는 동안 숫자 상자(시안 e2e-approve v1 '카드를 열기 전' → '카드를 연 뒤 숫자').
// 숫자는 내 다른 기기에서 카드를 연 뒤에야 생긴다(봉해 두고 여는 순서, chammo-relay ADR 0007) — 2초마다 묻는다
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState, type ReactNode } from 'react';
import { cellsOf, digits4, fmtSas } from '../../domain/e2eNumber';
import { tr } from '../../i18n';
import '../chat/directCard.css';
import './e2e.css';

export function NumberWait({ children }: { children?: ReactNode }) {
  const [n, setN] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const look = () => void invoke<number | null>('e2e_self_number').then((x) => live && setN(x ?? null), () => {});
    look();
    const t = window.setInterval(look, 2000);
    return () => { live = false; window.clearInterval(t); };
  }, []);
  const renew = (e: React.MouseEvent) => {
    if (!e.isTrusted || busy) return;
    setBusy(true);
    void invoke('e2e_renew').then(() => setN(null), () => {}).finally(() => setBusy(false));
  };
  return (
    <div className="nw-box">
      <h3>{n === null ? tr('허용을 기다려요', 'Waiting for approval') : tr('내 다른 기기에서 숫자를 넣어 주세요', 'Enter this number on your other device')}</h3>
      <div className={`nw-big${n === null ? ' off' : ''}`} aria-live="polite" aria-label={n === null ? tr('아직 숫자 없음', 'No number yet') : tr(`확인 숫자 ${fmtSas(n)}`, `Check number ${fmtSas(n)}`)}>{n === null ? '––– –––' : fmtSas(n)}</div>
      <p>{n === null
        ? tr("로그인해 둔 맥·윈도우·폰에 '새 기기' 카드가 떴어요. 카드를 열면 여기 숫자가 떠요", "A 'new device' card appeared on your signed-in Mac, Windows or phone. Open it and a number shows here")
        : tr("로그인해 둔 맥·윈도우·폰의 '새 기기' 카드에 넣어요", "Type it into the 'new device' card on your other device")}</p>
      <div className="nw-acts">
        {n !== null && <button className="btn" disabled={busy} onClick={renew}>{tr('숫자 다시', 'New number')}</button>}
        {children}
      </div>
    </div>
  );
}

/** 새 기기 쪽 — 허용된 뒤 다른 기기에 뜬 4자리 넣기(시안 e2e-approve v2, ADR 0007 R7). 틀리면 다시 넣기 없이 처음부터 */
export function CodeEntry({ failed, onAgain, onCancel, onOk, onDone }: {
  /** 이미 한 번 틀린 흐름 */ failed: boolean;
  /** 처음부터 — 로그아웃 뒤 다시 로그인 */ onAgain: () => void;
  /** 로그인 취소 — 로그아웃 */ onCancel: () => void;
  /** 4자리가 맞았다(끝 화면을 띄우는 동안 게이트가 안 닫히게) */ onOk: () => void;
  /** 끝 화면에서 계속 쓰기 */ onDone: () => void;
}) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState(failed);
  const [err, setErr] = useState('');
  const [doneAt, setDoneAt] = useState<Date | null>(null);
  useEffect(() => { if (failed) setBad(true); }, [failed]);
  const put = (raw: string) => {
    const d = digits4(raw);
    setV(d);
    setErr('');
    if (d.length !== 4 || busy) return;
    setBusy(true);
    void invoke('e2e_self_code', { code: d }).then(
      () => { setDoneAt(new Date()); onOk(); },
      (x) => { const m = String(x); if (/달라요|처음부터/.test(m)) setBad(true); else { setErr(m); setV(''); } },
    ).finally(() => setBusy(false));
  };
  if (doneAt) {
    return (
      <div className="nw-box">
        <div className="dc-mini"><span className="dc-av" aria-hidden="true">C</span><div className="dc-t"><b>{tr('이 기기가 내 기기가 됐어요', 'This device is now yours')}</b>
          <div className="dc-muted">{tr(`두 기기 모두 확인함 · ${doneAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })} · 이제 내 메시지를 읽어요`, 'Both devices checked · you can read your messages now')}</div></div></div>
        <div className="nw-acts"><button className="btn pri" onClick={onDone}>{tr('계속 쓰기', 'Continue')}</button></div>
      </div>
    );
  }
  const cells = cellsOf(bad && !v ? '' : v, 4);
  return (
    <div className="nw-box">
      <h3>{tr('다른 기기에 뜬 4자리를 넣어 주세요', 'Enter the 4 digits shown on your other device')}</h3>
      <label className={`dc-pin k4${bad ? ' bad' : ''}`}>
        {cells.map((c, i) => <span key={i} className={c.cur && !bad ? 'cur' : ''}>{c.ch}</span>)}
        <input inputMode="numeric" autoComplete="one-time-code" maxLength={5} value={v} disabled={busy || bad} autoFocus
          aria-label={tr('다른 기기에 뜬 4자리', 'The 4 digits on your other device')} onChange={(e) => put(e.target.value)} />
      </label>
      {bad
        ? <div className="dc-err" role="alert">{tr('4자리가 달라요 — 안전하게 처음부터 다시 해요', "The digits don't match — let's start over to be safe")}</div>
        : err ? <div className="dc-err" role="alert">{err}</div> : <p>{tr('숫자를 넣은 기기 카드에 떠 있어요', 'It is on the card where you typed the number')}</p>}
      <div className="nw-acts">
        {bad && <button className="btn pri" onClick={onAgain}>{tr('처음부터', 'Start over')}</button>}
        <button className="btn" onClick={onCancel}>{tr('로그인 취소', 'Cancel sign-in')}</button>
      </div>
    </div>
  );
}
