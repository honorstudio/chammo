// 폰 머리 종 = 알림 보기(시안 docs/design-drafts/phone-nav v1 N, 2026-10-24 사용자 "알림은 알림 보는 기능도 아니고 껐다 켜는 거라서 잘못됐고").
// 위 '답 기다림' = 이 참모가 물은 결정(WaitCard, 참모 시트와 같은 카드)·직접 답하기 카드, 아래 '최근' = 맡긴 일 끝남·물음(domain/phoneAlerts).
// 켜고 끄기는 더보기 시트(MoreSheet)
import type { ReactNode } from 'react';
import type { AlertRow } from '../../domain/phoneAlerts';
import { agoText } from '../../domain/lockerShots';
import { IconChevron } from '../Icons';
import { BottomSheet } from './kit';

type Props = {
  /** 답 기다림 카드들(없으면 null) */
  waiting: ReactNode | null;
  rows: AlertRow[];
  /** 줄 대상 세션 이름 */
  nameOf: (target: string) => string;
  /** 줄을 누르면 그 세션 엿보기 */
  onOpen: (r: AlertRow) => void;
  onClose: () => void;
};

export function AlertsSheet({ waiting, rows, nameOf, onOpen, onClose }: Props) {
  const now = Date.now();
  return (
    <BottomSheet label="알림" title="알림" onClose={onClose}>
      {waiting && (
        <>
          <div className="m-al-sec">답 기다림</div>
          <div className="m-al-wait">{waiting}</div>
        </>
      )}
      <div className="m-al-sec">최근</div>
      {rows.length ? (
        <div className="m-mo-list">
          {rows.map((r) => (
            <button key={r.key} type="button" className="m-mo-row m-al-row" onClick={() => { onClose(); onOpen(r); }}
              aria-label={`${nameOf(r.target)} — ${r.kind === 'ask' ? '물음' : '끝남'} — ${r.line}`}>
              {r.kind === 'ask' && <i className="m-al-dot" aria-hidden="true" />}
              <span className="m-al-txt"><b>{nameOf(r.target)}</b><span>{r.line}</span></span>
              <span className="m-al-ago">{agoText(r.at, now)}</span>
              <IconChevron />
            </button>
          ))}
        </div>
      ) : (
        <p className="m-muted m-sm m-al-empty">최근 3일 맡긴 일 소식이 없어요</p>
      )}
    </BottomSheet>
  );
}
