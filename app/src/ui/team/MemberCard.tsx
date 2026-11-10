// 팀원 자세히 보기 — 팀 설정 팀원 줄(남의 줄)·대화 회색 줄 '번호 비교'가 연다(11-09 사용자 "너무 복잡": 번호 비교는 여기 안에만).
// 보안 번호는 접힌 한 줄(확인함 날짜·바뀐 한 줄) — 펼치면 번호 판. 바뀐 줄을 눌러 열면 처음부터 펼친다. 동작은 ADR 0007 그대로(SafetyCompare)
import { useState } from 'react';
import { safetyFlag, verifiedText, type SafetyPerson } from '../../domain/e2eSafety';
import type { Status } from '../../domain/teamProfile';
import { tr } from '../../i18n';
import { SafetyCompare } from '../e2e/Safety';
import { IconChevronUp } from '../Icons';
import { IconButton } from '../kit/IconButton';
import '../e2e/e2e.css';
import { Card, type At } from './MyProfile';
import { Person } from './TeamFaces';

export function MemberCard({ name, color, photo, status, sub, p, at, compare = false, readOnly, onClose, onDone }: {
  name: string; color: string; photo?: string; status?: Status | '';
  /** 머리 둘째 줄(역할 · 기기 · 상태 글) */ sub: string;
  /** 보안 번호 사람(team_feed safety) — 없으면 그 줄이 없다(나·사슬 없는 사람) */ p?: SafetyPerson;
  at: At; compare?: boolean; readOnly?: boolean; onClose: () => void;
  /** 같아요·막아 두기 등이 끝났다 — 부르는 쪽이 닫고 목록을 새로 */ onDone: () => void;
}) {
  const [open, setOpen] = useState(compare);
  const note = p && (safetyFlag(p, Date.now()) ?? verifiedText(p));
  return (
    <Card at={at} onClose={onClose} label={tr(`${name} 자세히 보기`, `About ${name}`)}>
      <div className="tmp-card-h"><Person name={name} color={color} size={40} photo={photo} status={status} /><span className="tmp-card-tx"><b>{name}</b>{sub && <small>{sub}</small>}</span></div>
      {p && (
        <>
          <div className="tmp-sep" />
          <div className="sn-row">
            <span className="sn-row-tx"><b>{tr('보안 번호', 'Safety number')}</b>{note && <small>{note}</small>}</span>
            {open
              ? <IconButton label={tr('접기', 'Hide')} aria-expanded onClick={() => setOpen(false)}><IconChevronUp /></IconButton>
              : <button className="tmx-btn tmx-sm" aria-expanded={false} onClick={() => setOpen(true)}>{tr('비교', 'Compare')}</button>}
          </div>
          {open && <SafetyCompare p={p} readOnly={readOnly} onDone={onDone} />}
        </>
      )}
    </Card>
  );
}
