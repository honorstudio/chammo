// 폰 머리 '더보기'(점 셋) 시트 — 시안 docs/design-drafts/phone-nav v1 B(2026-10-24 사용자 "더보기가 좋은데").
// 세션 수·예약·계정 줄(글자 줄 + 오른쪽 숫자·꺾쇠, 줄마다 아이콘 안 붙임) + 이 기기 알림 켜기·끄기 토글(머리 종은 이제 알림 보기)
import { useEffect, useState } from 'react';
import type { Push } from './usePush';
import { enterKidsPad, readDefaultModel, setDefaultModel } from '../../data/web';
import { effortOptions, fixEffort, modelOptions, type DefaultModelView } from '../../domain/defaultModel';
import { IconChevron } from '../Icons';
import { BottomSheet } from './kit';
import { machine, tr } from '../../i18n';

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
  /** 이 기기 알림 토글 — 켜기·끄기 확인·안내는 OrchDash 의 기존 길 그대로(끄기 확인·안내는 대시보드 위에 떠서 시트를 먼저 닫는다) */
  onPush: () => void;
  onClose: () => void;
  /** 이 참모가 키즈 참모면 — 맨 위 '아이 화면으로'(이 기기를 아이 화면으로 바꾼다. 돌아오기는 아이 화면 구석 3초 + 부모 숫자) */
  kidsKey?: string;
};

export function MoreSheet({ busy, routines, left, push, onSessions, onRoutines, onAccount, onPush, onClose, kidsKey }: Props) {
  const [kidsErr, setKidsErr] = useState<string | null>(null);
  const row = (name: string, aria: string, right: React.ReactNode, go: () => void) => (
    <button type="button" className="m-mo-row" aria-label={aria} onClick={() => { onClose(); go(); }}>
      <b>{name}</b><span className="m-mo-right">{right}</span><IconChevron />
    </button>
  );
  return (
    <BottomSheet label={tr('더보기', 'More')} title={tr('더보기', 'More')} onClose={onClose}>
      {kidsKey && (
        <div className="m-mo-list">
          <button type="button" className="m-mo-row" onClick={() => void enterKidsPad(kidsKey).catch((e: unknown) => setKidsErr((e as Error).message === 'no lock' ? tr(`먼저 ${machine()} 설정 > 키즈 모드에서 부모 잠금을 정해 주세요`, `Set a parent lock in Settings > Kids mode on your ${machine()} first`) : String(e)))}>
            <b>{tr('아이 화면으로', 'Open kids screen')}</b><IconChevron />
          </button>
          {kidsErr && <div className="m-error" role="alert">{kidsErr}</div>}
        </div>
      )}
      <div className="m-mo-list">
        {row(tr('세션', 'Sessions'), tr(`세션${busy ? ` — 일하거나 묻는 세션 ${busy}` : ''}`, `Sessions${busy ? ` — ${busy} working or asking` : ''}`), busy > 0 ? <span className="m-mo-n">{busy}</span> : null, onSessions)}
        {row(tr('예약', 'Scheduled'), tr(`예약${routines ? ` — 도는 중 ${routines}` : ''}`, `Scheduled${routines ? ` — ${routines} running` : ''}`), routines > 0 ? tr(`${routines}개 도는 중`, `${routines} running`) : null, onRoutines)}
        {left !== null && row(tr('계정', 'Account'), tr(`계정 — 남은 양 ${left}%`, `Account — ${left}% left`), tr(`${left}% 남음`, `${left}% left`), onAccount)}
      </div>
      <DefaultModelRow />
      <div className="m-mo-list">
        {push.can === 'unsupported' ? (
          <div className="m-mo-row m-mo-static"><b>{tr('이 기기 알림', 'Device notifications')}</b><span className="m-mo-right">{tr('이 브라우저는 못 받아요', "This browser can't receive them")}</span></div>
        ) : (
          <button type="button" role="switch" aria-checked={push.on} className="m-mo-row" disabled={push.busy}
            onClick={() => { if (push.on || push.can !== 'ok') onClose(); onPush(); }}
            aria-label={push.on ? tr('이 기기 알림 켜짐 — 끄기', 'Device notifications on — turn off') : tr('이 기기 알림 꺼짐 — 켜기', 'Device notifications off — turn on')}>
            <b>{tr('이 기기 알림', 'Device notifications')}</b><span className="m-mo-right">{push.on ? tr('켜짐', 'On') : tr('꺼짐', 'Off')}</span>
            <span className={push.on ? 'm-toggle m-on' : 'm-toggle'} aria-hidden="true"><i /></span>
          </button>
        )}
      </div>
    </BottomSheet>
  );
}

/** 새 세션 기본 모델·노력값 — 맥 설정 > 참모와 같은 칸(맥 config). 바꾸면 바로 저장, 옛 맥 앱(길 없음)이면 줄을 안 그린다 */
function DefaultModelRow() {
  const [v, setV] = useState<DefaultModelView | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void readDefaultModel().then(setV, () => {}); }, []);
  if (!v) return null;
  const save = (model: string, effort: string) => {
    const was = v;
    setV({ ...v, model, effort });
    setBusy(true);
    void setDefaultModel(model, effort).then(setV, () => setV(was)).finally(() => setBusy(false));
  };
  return (
    <div className="m-mo-list">
      <div className="m-mo-row m-mo-static m-mo-model">
        <b>{tr('새 세션 모델', 'New session model')}</b>
        <span className="m-mo-right">
          <select aria-label={tr('모델', 'Model')} disabled={busy} value={v.model} onChange={(e) => save(e.target.value, fixEffort(e.target.value, v.effort))}>
            {modelOptions(v).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select aria-label={tr('노력값', 'Effort')} disabled={busy} value={v.effort} onChange={(e) => save(v.model, e.target.value)}>
            {effortOptions(v, v.model).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </span>
      </div>
    </div>
  );
}
