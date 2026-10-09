// 계정 시트 — 대시보드 머리줄의 계정·사용량을 누르면 아래에서 올라온다. 계정마다 이름·5시간·주 남은 %·지금·쉬는 중,
// 다른 계정을 누르면 확인 한 번 → 맥이 데스크톱과 같은 길로 바꿔 끼운다(Rust accounts_cmd::phone_switch). 자동 전환 켜기·끄기.
// 지금 계정은 전체 테두리(왼쪽 띠 금지)
import { useEffect, useState } from 'react';
import { readAccounts, setAccountAuto, switchAccount } from '../../data/web';
import { readAuto } from '../../domain/accountAuto';
import { confirmText, phoneAccountError, phoneAccountRows, phoneAllOut, readPhoneAccounts, type PhoneAccountRow, type PhoneAccounts } from '../../domain/phoneAccounts';
import { usageLevel } from '../../domain/usage';
import { IconClose } from '../Icons';
import { machine } from '../../i18n';

function Bar({ label, left }: { label: string; left: number | null }) {
  return (
    <span className="m-acct-bar" aria-label={left == null ? `${label} 사용량 모름` : `${label} ${left}% 남음`}>
      <span className="m-acct-bar-label">{label}</span>
      <span className="m-acct-track">{left != null && <span className={`m-acct-fill m-${usageLevel(left)}`} style={{ width: `${Math.max(2, left)}%` }} />}</span>
      <b>{left == null ? '—' : `${left}%`}</b>
    </span>
  );
}

type Props = { text: string; onChanged: (text: string) => void; onClose: () => void };

export function AccountSheet({ text, onChanged, onClose }: Props) {
  const v: PhoneAccounts | null = readPhoneAccounts(text);
  const now = Date.now();
  const rows = v ? phoneAccountRows(v, now) : [];
  const auto = readAuto(v?.auto);
  const out = v ? phoneAllOut(v, now) : null;
  const [ask, setAsk] = useState<PhoneAccountRow | null>(null);
  const [busy, setBusy] = useState<'switch' | 'auto' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id); }, []);
  // 열 때 한 번 새로 — 대시보드는 30초마다라 그새 자동 전환이 바꿨을 수 있다
  useEffect(() => { readAccounts().then(onChanged, (e: Error) => { if (!text) setError(phoneAccountError(e.message)); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 바꾸는 중엔 못 닫는다 — 닫아도 맥은 끝까지 하지만, 결과를 못 보면 또 누른다
  const close = () => { if (busy) return; setShown(false); window.setTimeout(onClose, 220); };

  const act = async (kind: 'switch' | 'auto', f: () => Promise<string>) => {
    setBusy(kind);
    setError(null);
    try {
      onChanged(await f());
      setAsk(null);
    } catch (e) {
      setError(phoneAccountError((e as Error).message));
      // 응답만 못 받았을 수 있다(맥은 바꿨는데 전파가 끊김) — 맥 상태를 다시 읽어 보여 준다
      readAccounts().then(onChanged, () => {});
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="m-pick-wrap" role="dialog" aria-modal="true" aria-label="계정">
      <button type="button" className={shown ? 'm-pick-back m-on' : 'm-pick-back'} aria-label="닫기" onClick={close} />
      <div className="m-pick" style={{ transform: shown ? 'translateY(0)' : 'translateY(100%)' }}>
        <div className="m-pick-grab"><div className="m-handle" /></div>
        <div className="m-picker-head">
          <b>계정</b>
          <button type="button" className="m-icon" onClick={close} disabled={!!busy} aria-label="닫기" title="닫기"><IconClose /></button>
        </div>
        <div className="m-picker-list">
          {!v && !error && <p className="m-muted m-sm">{text ? '계정 칸을 못 읽었어요' : '불러오는 중…'}</p>}
          {v && !rows.length && <p className="m-muted m-sm">계정 칸이 없어요 — {machine()} 설정 &gt; 계정에서 지금 로그인을 보관하면 여기서 바꿀 수 있어요</p>}
          {ask ? (
            <div className="m-sleep-card" role="alertdialog" aria-label="계정 바꾸기 확인">
              <b>{confirmText(ask, auto.on).title}</b>
              {confirmText(ask, auto.on).lines.map((l) => <div key={l} className="m-muted m-sm">{l}</div>)}
              {busy === 'switch' && <div className="m-sm" role="status">{machine()}에서 바꾸는 중…</div>}
              {error && <div className="m-error m-flush" role="alert">{error}</div>}
              <div className="m-new-row">
                <button type="button" className="m-btn" disabled={busy === 'switch'} onClick={() => { setAsk(null); setError(null); }}>취소</button>
                <button type="button" className="m-send" disabled={busy === 'switch'} onClick={() => void act('switch', () => switchAccount(ask.id))}>바꾸기</button>
              </div>
            </div>
          ) : (
            <>
              {rows.map((r) => (
                <button key={r.id} type="button" className={r.on ? 'm-acct m-cur' : 'm-acct'} disabled={r.on || !!busy} aria-current={r.on ? 'true' : undefined}
                  onClick={() => { setError(null); setAsk(r); }}>
                  <span className="m-acct-top">
                    <b className="m-acct-name">{r.name || '이름 없음'}</b>
                    {r.on && <span className="st-tag t-work">지금</span>}
                    {r.pinned && <span className="st-tag t-done">{r.pinHint ? '고정 — 다 쓰면 넘어감' : '고정'}</span>}
                  </span>
                  <span className="m-acct-bars"><Bar label="5시간" left={r.five} /><Bar label="주" left={r.week} /></span>
                  {(r.rest || r.note) && <span className={r.rest ? 'm-acct-note m-rest' : 'm-acct-note'}>{r.rest ?? r.note}</span>}
                </button>
              ))}
              {rows.length === 1 && <p className="m-muted m-sm">다른 계정이 없어요 — {machine()} 설정 &gt; 계정에서 추가해요</p>}
              {v && !v.active && rows.length > 0 && <p className="m-muted m-sm">지금 로그인({v.liveName ?? '없음'})은 칸에 없어요</p>}
              {v?.switching && !busy && <p className="m-sm" role="status">{machine()}에서 계정을 바꾸는 중이에요 — 오래 이러면 계정을 한 번 눌러 마무리해요</p>}
              {out && <p className="m-sm m-rest">{out}</p>}
              {error && <div className="m-error m-flush" role="alert">{error}</div>}
              {rows.length > 1 && (
                <button type="button" role="switch" aria-checked={auto.on} className="m-acct-auto" disabled={!!busy} onClick={() => void act('auto', () => setAccountAuto(!auto.on))}>
                  <span>자동 전환</span>
                  <span className={auto.on ? 'm-toggle m-on' : 'm-toggle'} aria-hidden="true"><i /></span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
