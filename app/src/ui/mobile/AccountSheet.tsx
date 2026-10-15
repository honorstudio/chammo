// 계정 시트 — 대시보드 머리줄의 계정·사용량을 누르면 아래에서 올라온다. 계정마다 이름·5시간·주 남은 %·지금·쉬는 중,
// 다른 계정을 누르면 확인 한 번 → 맥이 데스크톱과 같은 길로 바꿔 끼운다(Rust accounts_cmd::phone_switch). 자동 전환 켜기·끄기.
// 계정 둘을 나란히 두고 칸 하나를 고른다(시안 phone-dash S3) — 지금 계정 = 채운 면 + 체크(글자 칩 없음), 숫자 하나(5시간·주 중 적은 쪽)와 그 칸이 다시 차는 때만.
// 두 숫자·고정 여부는 칸 aria 와 데스크톱 계정 창에. 왼쪽 띠 금지
import { useEffect, useState } from 'react';
import { readAccounts, setAccountAuto, switchAccount } from '../../data/web';
import { readAuto } from '../../domain/accountAuto';
import { confirmText, phoneAccountError, phoneAccountRows, phoneAllOut, readPhoneAccounts, type PhoneAccountRow, type PhoneAccounts } from '../../domain/phoneAccounts';
import { usageLevel } from '../../domain/usage';
import { IconCheck } from '../Icons';
import { machine } from '../../i18n';
import { BottomSheet } from './kit';

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
  // 열 때 한 번 새로 — 대시보드는 30초마다라 그새 자동 전환이 바꿨을 수 있다
  useEffect(() => { readAccounts().then(onChanged, (e: Error) => { if (!text) setError(phoneAccountError(e.message)); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    // 바꾸는 중엔 못 닫는다 — 닫아도 맥은 끝까지 하지만, 결과를 못 보면 또 누른다
    <BottomSheet label="계정" title="계정" onClose={onClose} closeDisabled={!!busy}>
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
          <div className="m-acct-tiles">
            {rows.map((r) => (
              <button key={r.id} type="button" className={r.on ? 'm-acct-tile m-cur' : 'm-acct-tile'} disabled={r.on || !!busy} aria-current={r.on ? 'true' : undefined}
                aria-label={`${r.name || '이름 없음'}${r.on ? ' — 지금 쓰는 계정' : ''}${r.five != null ? ` · 5시간 ${r.five}% 남음` : ''}${r.week != null ? ` · 주 ${r.week}% 남음` : ''}${r.pinned ? ' · 고정' : ''}${r.rest ? ` · ${r.rest}` : ''}`}
                onClick={() => { setError(null); setAsk(r); }}>
                <span className="m-acct-ck" aria-hidden="true">{r.on && <IconCheck />}</span>
                <b className="m-acct-name">{r.name || '이름 없음'}</b>
                <span className={`m-acct-big${r.left != null ? ` m-${usageLevel(r.left)}` : ''}`}>{r.left == null ? '—' : `${r.left}%`}</span>
                <span className="m-acct-track" aria-hidden="true">{r.left != null && <span className={`m-acct-fill m-${usageLevel(r.left)}`} style={{ width: `${Math.max(2, r.left)}%` }} />}</span>
                <span className={r.rest ? 'm-acct-note m-rest' : 'm-acct-note'}>{r.rest ?? r.soon ?? ''}</span>
              </button>
            ))}
          </div>
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
    </BottomSheet>
  );
}
