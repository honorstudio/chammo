import type { PopHead, PopRow } from '../domain/accounts';
import { usageLevel } from '../domain/usage';
import { tr } from '../i18n';
import { IconCheck, IconSettings } from './Icons';

export type PopBodyProps = {
  rows: PopRow[];
  head: PopHead;
  /** 자동 전환 켜짐 */
  auto: boolean;
  busy: boolean;
  error: string | null;
  /** 다른 계정 줄을 눌렀다 — 그 칸으로 바꾸고 고정 */
  onUse: (id: string) => void;
  onAuto: (on: boolean) => void;
  onSettings: () => void;
};

/**
 * 계정 팝오버 몸통(시안 v1 C안 + 자동 전환 토글, docs/design-drafts/account-pop) — 훅 없는 순수 화면.
 * 머리 = 지금 계정의 다가오는 초기화·다 쓰면 어디로 + 설정 아이콘, 줄 = 체크·이름·점·숫자 하나(둘 중 적은 쪽, 상세는 마우스 올림),
 * 아래 = 자동 전환 토글. 다른 계정 줄을 누르면 바꾼다(글자 버튼 없음)
 */
export function AccountPopBody({ rows, head, auto, busy, error, onUse, onAuto, onSettings }: PopBodyProps) {
  return (
    <>
      <div className="acct-pop-head">
        <span className="acct-pop-next">
          {head.next && <b className={head.warn ? 'acct-pop-warn' : undefined}>{head.next}</b>}
          {head.after && <span>{head.after}</span>}
        </span>
        <button type="button" className="acct-pop-icon" aria-label={tr('계정 설정', 'Account settings')} title={tr('계정 설정', 'Account settings')} onClick={onSettings}><IconSettings /></button>
      </div>
      <div className="acct-pop-list">
        {rows.map((r) => {
          const inner = (
            <>
              <span className="acct-pop-chk">{r.on && <IconCheck />}</span>
              <span className="acct-pop-name">{r.name}</span>
              <span className={`acct-pop-dot ${r.stop ? 'low' : r.left == null ? 'none' : usageLevel(r.left)}`}></span>
              <span className={r.stop ? 'acct-pop-val acct-pop-stop' : 'acct-pop-val'}>{r.stop ?? (r.left == null ? '—' : `${r.left}%`)}</span>
            </>
          );
          return r.on
            ? <div key={r.id} className="acct-pop-row acct-pop-cur" aria-current="true" title={r.tip}>{inner}</div>
            : <button key={r.id} type="button" className="acct-pop-row" disabled={busy} title={r.tip} aria-label={tr(`${r.name} 계정으로 바꾸기`, `Switch to ${r.name}`)} onClick={() => onUse(r.id)}>{inner}</button>;
        })}
      </div>
      {error && <div className="acct-pop-err">{error}</div>}
      <div className="acct-pop-foot">
        <span className="acct-pop-foot-label">{tr('자동 전환', 'Auto-switch')}</span>
        <button type="button" role="switch" aria-checked={auto} aria-label={tr('자동 전환', 'Auto-switch')} className="acct-pop-switch" disabled={busy} onClick={() => onAuto(!auto)}><i /></button>
      </div>
    </>
  );
}
