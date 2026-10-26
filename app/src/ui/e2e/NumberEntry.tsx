// 허용 기기 쪽 — 새 기기 화면의 6자리를 넣어야 허용(시안 e2e-approve v1). 털린 서버가 카드 속 열쇠를 바꿔치기하면 숫자가 달라진다(chammo-relay ADR 0007).
// 카드가 보이면 이 기기가 난수(nM)를 낸다 — 사람이 카드를 연 뒤에만. 숫자는 이 기기만 셈하고 화면엔 안 보인다(넣은 값과 견주기만)
// 맞으면 새 기기에 넣을 4자리를 띄운다(시안 v2, ADR 0007 R7) — 서버는 이 4자리를 모른다
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { cellsOf, digits6, parseCardOpen, type CardMode, type NumberApi } from '../../domain/e2eNumber';
import { tr } from '../../i18n';
import { IconClose } from '../Icons';
import { IconButton } from '../kit/IconButton';
import '../chat/directCard.css';
import './e2e.css';

export type { NumberApi };

/** 데스크톱 메인 창 명령(e2e_cmd) */
export const desktopNumber: NumberApi = {
  open: (dev) => invoke<unknown>('e2e_card_open', { dev }).then(parseCardOpen),
  ready: (dev) => invoke<boolean>('e2e_card_ready', { dev }),
  approve: (dev, digits) => invoke<string>('e2e_card_approve', { dev, digits }),
  op: (dev, op) => invoke<void>('e2e_card_op', { dev, op }),
};

/** 카드 갈래 — number(숫자 넣기) / wait(새 컴퓨터 숫자 준비 전 — 다시 묻는다) / click(열쇠 없는 폰·사슬 전 계정만) / code(허용했고 4자리를 띄우는 중) / loading. 못 물으면 wait(누르기를 띄우지 않는다) */
export function useCardNumber(dev: string | undefined, api: NumberApi) {
  const [mode, setMode] = useState<'loading' | CardMode>(dev ? 'loading' : 'click');
  const [code, setCode] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!dev) return;
    let live = true;
    const ask = () => void api.open(dev).then((m) => { if (!live) return; setMode(m.mode); setCode(m.code); }, () => live && setMode('wait'));
    ask();
    return () => { live = false; };
  }, [dev, api]);
  // 숫자 준비 전(wait) — 새 기기가 봉인을 올릴 때까지 2초마다 다시 연다
  useEffect(() => {
    if (!dev || mode !== 'wait') return;
    let live = true;
    const t = window.setInterval(() => void api.open(dev).then((m) => { if (live && m.mode !== 'wait') { setMode(m.mode); setCode(m.code); } }, () => {}), 2000);
    return () => { live = false; window.clearInterval(t); };
  }, [dev, mode, api]);
  useEffect(() => {
    if (!dev || mode !== 'number' || ready) return;
    let live = true;
    const look = () => void api.ready(dev).then((r) => live && setReady(r), () => {});
    look();
    const t = window.setInterval(look, 2000);
    return () => { live = false; window.clearInterval(t); };
  }, [dev, mode, ready, api]);
  return { mode, ready, code };
}

/** 이 기기가 사슬 밖일 때 — 버튼 대신 안내(누르면 403 만 뜨던 것, 리뷰 B 회귀) */
export const outsideHint = () => tr('이 기기는 아직 숫자 확인 전이라 허용·거절할 수 없어요 — 처음 시작한 기기나 숫자 확인을 마친 기기에서', 'This device has not been verified yet, so it cannot allow or decline — use the first device or one that finished the number check');

export function NumberEntry({ dev, api, ready, decline, onDone, code: shown = '' }: {
  dev: string; api: NumberApi; ready: boolean;
  /** 거절 단추 — 카드의 거절 길(예전 그대로) */ decline: (e: React.MouseEvent) => void;
  /** 4자리 카드를 닫았거나 그 기기를 끊었다 */ onDone?: () => void;
  /** 이미 허용하고 띄운 4자리(카드를 다시 열었을 때) */ code?: string;
}) {
  const [v, setV] = useState('');
  const [code, setCode] = useState(shown);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (shown) setCode(shown); }, [shown]);
  const fail = (x: unknown) => setErr(x instanceof Error ? x.message : String(x));
  const allow = (e: React.MouseEvent) => {
    if (!e.isTrusted || busy || v.length !== 6) return; // 사람 클릭만
    setBusy(true);
    setErr('');
    void api.approve(dev, v).then(setCode, fail).finally(() => setBusy(false));
  };
  const after = (e: React.MouseEvent, op: 'close' | 'cut') => {
    if (!e.isTrusted || busy) return;
    setBusy(true);
    setErr('');
    void api.op(dev, op).then(() => onDone?.(), fail).finally(() => setBusy(false));
  };
  if (code) {
    return (
      <>
        <div>
          <div className="dc-q">{tr('숫자가 맞아요 — 마지막으로 새 기기에 이 4자리를 넣어 주세요', 'The number matches — finally, enter these 4 digits on the new device')}</div>
          <div className="dc-muted">{tr('넣으면 끝나요 · 이 4자리는 서버에 안 가요', "That's the last step · these 4 digits never reach the server")}</div>
        </div>
        <div className="dc-code k4" aria-live="polite">{code}</div>
        {err && <div className="dc-err" role="alert" style={{ textAlign: 'center' }}>{err}</div>}
        <div className="dc-acts">
          <button className="dc-btn dc-no" disabled={busy} onClick={(e) => after(e, 'cut')}>{tr('거절', 'Decline')}</button>
          <IconButton size="l" tone="line" className="dc-ib" label={tr('닫기', 'Close')} disabled={busy} onClick={(e) => after(e, 'close')}><IconClose /></IconButton>
        </div>
      </>
    );
  }
  const cells = cellsOf(v);
  return (
    <>
      <div className={`dc-pin${err ? ' bad' : ''}`} onClick={() => input.current?.focus()}>
        {cells.slice(0, 3).map((c, i) => <span key={i} className={c.cur ? 'cur' : ''}>{c.ch}</span>)}
        <span className="gap" aria-hidden />
        {cells.slice(3).map((c, i) => <span key={i + 3} className={c.cur ? 'cur' : ''}>{c.ch}</span>)}
        <input ref={input} inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={v} disabled={busy}
          aria-label={tr('새 기기 화면의 숫자 6자리', 'The 6-digit number on the new device')}
          onChange={(e) => { setV(digits6(e.target.value)); setErr(''); }} />
      </div>
      {err
        ? <div className="dc-err" role="alert" style={{ textAlign: 'center' }}>{err}</div>
        : <div className="dc-hint">{ready ? tr('새 기기 화면에 뜬 숫자', 'The number on the new device') : tr('새 기기 화면에 숫자가 뜨길 기다려요', 'Waiting for the number on the new device')}</div>}
      <div className="dc-acts">
        <button className="dc-btn dc-no" disabled={busy} onClick={decline}>{tr('거절', 'Decline')}</button>
        <button className="dc-btn dc-go" disabled={busy || !ready || v.length !== 6} onClick={allow}>{tr('허용', 'Allow')}</button>
      </div>
    </>
  );
}
