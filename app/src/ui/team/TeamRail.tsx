// 띠의 팀 칸(시안 team-space v1 A) — 참모 프사 아래 팀 표 하나. 누르면 팀 모드(화면 전체가 팀), 안 읽은 수는 팀 표 하나에 합친다.
// 방·DM 프사를 띠에 펼치지 않는다 — 목록은 팀 모드 가운데(TeamList). 칸은 띠(.lk-strip) 바로 아래 형제 — 고른 표시(.lk-av.on)·호버 카드(data-tip)를 그대로 쓴다
// 고른 표시는 참모 칸과 같은 그림 둘레 테두리 하나, 색만 팀 색(팀 홈에서 고른 색, 없으면 이름 색 — 10-29 사용자)
import { tr } from '../../i18n';
import { teamMark } from '../../domain/teamChat';
import { TeamMarkIcon } from './TeamFaces';
import './team.css';

export function TeamRail({ icon, team, color, chats, on, unread, wide, onTeam, onMenu, others = [], onPickTeam }: {
  /** 팀 아이콘 그림(data URL, 팀 설정에서 팀장이 바꾼다) */
  icon?: string;
  team: string;
  /** 팀 색(팀 홈 판) — 없으면 이름 색 */
  color?: string;
  /** 대화 수(넓은 띠 둘째 줄) */
  chats: number;
  /** 팀 모드 — 고른 칸 표시 */
  on: boolean;
  unread: number;
  wide: boolean;
  onTeam: () => void;
  /** 팀 칸 오른쪽 누르기 — 팀 초대·팀 설정 메뉴(웹뷰 기본 메뉴 대신, 10-24) */
  onMenu?: (e: React.MouseEvent) => void;
  /** 내 다른 팀 — 칸마다 팀 표만(이름은 aria-label·호버 카드), 안 읽은 수는 지금 팀과 같은 모양(11-01 QA: 우클릭 메뉴로만 갔다) */
  others?: { id: string; name: string; unread: number }[];
  onPickTeam?: (id: string) => void;
}) {
  const sub = unread ? tr(`안 읽은 말 ${unread}`, `${unread} unread`) : tr(`대화 ${chats}`, `${chats} chats`);
  return (
    <>
      <i className="far-sep" aria-hidden="true" />
      <button className={`lk-av tmx tmx-rail-team ${on ? 'on' : ''}`} onClick={onTeam} onContextMenu={onMenu ? (e) => { e.preventDefault(); onMenu(e); } : undefined}
        aria-current={on || undefined} aria-label={unread ? tr(`${team} — 안 읽은 말 ${unread}`, `${team} — ${unread} unread`) : team} data-tip={team} data-tip-sub={sub}
        style={{ '--rail-on': color ?? teamMark(team).color } as React.CSSProperties}>
        <span className="lk-av-pic"><TeamMarkIcon name={team} size={30} badge={unread} img={icon} /></span>
        {wide && <span className="lk-av-tx"><b>{team}</b><span>{sub}</span></span>}
      </button>
      {others.map((t) => (
        <button key={t.id} className="lk-av tmx tmx-rail-team tmx-rail-other" onClick={() => onPickTeam?.(t.id)}
          aria-label={t.unread ? tr(`${t.name} — 안 읽은 말 ${t.unread}`, `${t.name} — ${t.unread} unread`) : t.name} data-tip={t.name} data-tip-sub={t.unread ? tr(`안 읽은 말 ${t.unread}`, `${t.unread} unread`) : undefined}
          style={{ '--rail-on': teamMark(t.name).color } as React.CSSProperties}>
          <span className="lk-av-pic"><TeamMarkIcon name={t.name} size={30} badge={t.unread} /></span>
        </button>
      ))}
    </>
  );
}
