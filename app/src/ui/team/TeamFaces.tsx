// 메신저 얼굴 — 사람 = 둥근 프사(사진, 없으면 첫 글자), 참모 = 네모 얼굴(눈 둘, 주인과 같은 색 — 짝이 한눈에), 팀 = 둥근 네모 + 첫 글자(시안 v2)
// 사람 얼굴 오른쪽 아래 작은 점 = 상태(대화 가능·자리 비움·방해 금지 — 방해 금지는 가운데 흰 줄, 색을 못 가려도 모양으로). 시안 team-settings v1 S
import { useContext } from 'react';
import { teamMark } from '../../domain/teamChat';
import { lookOf, statusName, type Status } from '../../domain/teamProfile';
import { ProfilesCtx } from './useProfiles';
import './profile.css';

type S = React.CSSProperties;
const v = (c: string, s: number): S => ({ ['--c' as string]: c, ['--s' as string]: `${s}px` });

export const StatusDot = ({ status }: { status: Status | '' | undefined }) => (status ? <i className={`tmp-dot ${status}`} title={statusName(status)} /> : null);

export const Person = ({ name, color, size = 28, photo, status }: { name: string; color: string; size?: number; photo?: string; status?: Status | '' }) => (
  <span className={`tmx-pa ${photo ? 'tmp-ph' : ''}`} style={v(color, size)} aria-hidden="true">
    {photo ? <img src={photo} alt="" draggable={false} /> : ([...name.trim()][0] ?? '?')}
    <StatusDot status={status} />
  </span>
);

/** 팀 사람(멤버 id) 얼굴 — 프로필판(ProfilesCtx)에서 사진·상태를 찾아 그린다. 없으면 Person 그대로 */
export const PersonOf = ({ member, name, color, size }: { member: string; name: string; color: string; size?: number }) => {
  const l = lookOf(useContext(ProfilesCtx).board, member, name);
  return <Person name={l.name} color={color} size={size} photo={l.photo} status={l.status} />;
};

export const Face = ({ color, size = 28 }: { color: string; size?: number }) => <span className="tmx-face" style={v(color, size)} aria-hidden="true" />;

export const TeamMarkIcon = ({ name, size = 30, badge, on, img }: { name: string; size?: number; badge?: number; on?: boolean; /** 팀 아이콘 그림(data URL) — 없으면 첫 글자 */ img?: string }) => {
  const m = teamMark(name);
  return (
    <span className={`tmx-tm ${on ? 'on' : ''} ${img ? 'tmp-ph' : ''}`} style={v(m.color, size)} aria-hidden="true">
      {img ? <img src={img} alt="" draggable={false} /> : m.letter}{badge ? <i className="tmx-ur">{badge > 99 ? '99+' : badge}</i> : null}
    </span>
  );
};

/** 안 읽은 수 점 — 숫자 */
export const Unread = ({ n, inline }: { n: number; inline?: boolean }) => (n > 0 ? <i className={`tmx-ur ${inline ? 'in' : ''}`}>{n > 99 ? '99+' : n}</i> : null);
