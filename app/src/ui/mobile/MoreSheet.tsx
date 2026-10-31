// 폰 머리 '더보기'(점 셋) 시트 — 시안 docs/design-drafts/phone-nav v1 B(2026-10-24 사용자 "더보기가 좋은데").
// 세션 수·예약·계정 줄(글자 줄 + 오른쪽 숫자·꺾쇠, 줄마다 아이콘 안 붙임) + 폰 알림 켜기·끄기 토글(머리 종은 이제 알림 보기)
import type { Push } from './usePush';
import { IconChevron } from '../Icons';
import { BottomSheet } from './kit';
import { tr } from '../../i18n';

type Props = {
  /** 일하거나 묻는 하위 세션 수 */
  busy: number;
  /** 도는 예약 수 */
  routines: number;
  /** 계정 남은 % (고리와 같은 값), 계정 기능이 없으면 null */
  left: number | null;
  push: Push;
  onSessions: () => void;
  onRoutines: () => void;
  onAccount: () => void;
  /** 폰 알림 토글 — 켜기·끄기 확인·안내는 OrchDash 의 기존 길 그대로(끄기 확인·안내는 대시보드 위에 떠서 시트를 먼저 닫는다) */
  onPush: () => void;
  onClose: () => void;
};

export function MoreSheet({ busy, routines, left, push, onSessions, onRoutines, onAccount, onPush, onClose }: Props) {
  const row = (name: string, aria: string, right: React.ReactNode, go: () => void) => (
    <button type="button" className="m-mo-row" aria-label={aria} onClick={() => { onClose(); go(); }}>
      <b>{name}</b><span className="m-mo-right">{right}</span><IconChevron />
    </button>
  );
  return (
    <BottomSheet label={tr('더보기', 'More')} title={tr('더보기', 'More')} onClose={onClose}>
      <div className="m-mo-list">
        {row(tr('세션', 'Sessions'), tr(`세션${busy ? ` — 일하거나 묻는 세션 ${busy}` : ''}`, `Sessions${busy ? ` — ${busy} working or asking` : ''}`), busy > 0 ? <span className="m-mo-n">{busy}</span> : null, onSessions)}
        {row(tr('예약', 'Scheduled'), tr(`예약${routines ? ` — 도는 중 ${routines}` : ''}`, `Scheduled${routines ? ` — ${routines} running` : ''}`), routines > 0 ? tr(`${routines}개 도는 중`, `${routines} running`) : null, onRoutines)}
        {left !== null && row(tr('계정', 'Account'), tr(`계정 — 남은 양 ${left}%`, `Account — ${left}% left`), tr(`${left}% 남음`, `${left}% left`), onAccount)}
      </div>
      <div className="m-mo-list">
        {push.can === 'unsupported' ? (
          <div className="m-mo-row m-mo-static"><b>{tr('폰 알림', 'Phone notifications')}</b><span className="m-mo-right">{tr('이 브라우저는 못 받아요', "This browser can't receive them")}</span></div>
        ) : (
          <button type="button" role="switch" aria-checked={push.on} className="m-mo-row" disabled={push.busy}
            onClick={() => { if (push.on || push.can !== 'ok') onClose(); onPush(); }}
            aria-label={push.on ? tr('폰 알림 켜짐 — 끄기', 'Phone notifications on — turn off') : tr('폰 알림 꺼짐 — 켜기', 'Phone notifications off — turn on')}>
            <b>{tr('폰 알림', 'Phone notifications')}</b><span className="m-mo-right">{push.on ? tr('켜짐', 'On') : tr('꺼짐', 'Off')}</span>
            <span className={push.on ? 'm-toggle m-on' : 'm-toggle'} aria-hidden="true"><i /></span>
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
