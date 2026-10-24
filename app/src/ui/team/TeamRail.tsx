// 띠의 메신저 칸(시안 v2 A) — 내 참모 프사 아래: 팀 표를 고르면 그 팀 DM 이 펼쳐지고, 누르면 가운데 칸이 그 대화.
// 메신저 전체를 따로 창으로 뗐으면 팀 줄 전부가 말풍선 아이콘 하나(안 읽은 수)로 접힌다 — 누르면 그 창을 앞으로.
// 칸들은 띠(.lk-strip) 바로 아래 형제 — 띠의 고른 자리 이음(.lk-av.on)·호버 카드(data-tip)를 그대로 쓴다
import { orchVars } from '../../domain/orchTheme';
import { previewOf, type Convo } from '../../domain/teamChat';
import { tr } from '../../i18n';
import { IconChat, IconPlus, IconWindowOut } from '../Icons';
import { Person, TeamMarkIcon, Unread } from './TeamFaces';
import './team.css';

export function TeamRail({ team, convos, sel, open, detached, unread, wide, onTeam, onPick, onDetachAll, onFront, onStart, dimmed, noAdd = false }: {
  /** 팀 만들기·초대 + 를 안 그린다 — 참모 띠 + 메뉴가 대신(띠 RA, 2026-10-24) */
  noAdd?: boolean;
  /** 팀 이름(없으면 팀이 없다 — + 만) */
  team: string | null;
  convos: Convo[];
  sel: string | null;
  open: boolean;
  /** 메신저 전체가 따로 창에 */
  detached: boolean;
  unread: number;
  wide: boolean;
  onTeam: () => void;
  onPick: (c: Convo) => void;
  /** 메신저 전체 따로 창으로 — 모니터가 하나면 안 준다(아이콘 숨김) */
  onDetachAll?: () => void;
  onFront: () => void;
  onStart: (e: React.MouseEvent) => void;
  /** 대화 하나만 떼어 낸 방들 — 앱 안에선 흐리게, 누르면 그 창을 앞으로 */
  dimmed: Set<string>;
}) {
  if (detached) {
    return (
      <>
        <i className="far-sep" aria-hidden="true" />
        <button className="lk-av tmx tmx-rail-msg" onClick={onFront} aria-label={tr('메신저 — 따로 창에 열려 있음', 'Messenger — open in its own window')}
          data-tip={tr('메신저', 'Messenger')} data-tip-sub={tr('따로 창에 열려 있음', 'Open in its own window')}>
          <span className="lk-av-pic"><IconChat /><Unread n={unread} /></span>
        </button>
      </>
    );
  }
  return (
    <>
      <i className="far-sep" aria-hidden="true" />
      {team && (
        <button className="lk-av tmx tmx-rail-team" onClick={onTeam} aria-expanded={open} aria-label={team} data-tip={team} data-tip-sub={open ? tr('팀 — 누르면 접기', 'Team — click to fold') : tr('팀 — 누르면 펼치기', 'Team — click to unfold')}>
          <span className="lk-av-pic"><TeamMarkIcon name={team} size={30} on={open} badge={open ? 0 : unread} /></span>
          {wide && <span className="lk-av-tx"><b>{team}</b><span>{tr(`대화 ${convos.length}`, `${convos.length} chats`)}</span></span>}
        </button>
      )}
      {team && open && convos.map((c) => (
        <button key={c.key} className={`lk-av tmx tmx-rail-dm ${sel === c.key ? 'on' : ''} ${dimmed.has(c.room) ? 'dim' : ''}`} style={orchVars(c.color) as React.CSSProperties}
          onClick={() => onPick(c)} aria-current={sel === c.key || undefined} aria-label={c.unread ? tr(`${c.name} — 안 읽은 말 ${c.unread}`, `${c.name} — ${c.unread} unread`) : c.name}
          data-tip={c.name} data-tip-sub={previewOf(c.last)}>
          <span className="lk-av-pic"><Person name={c.name} color={c.color} size={28} /><Unread n={c.unread} /></span>
          {wide && <span className="lk-av-tx"><b>{c.name}</b><span>{previewOf(c.last)}</span></span>}
        </button>
      ))}
      {team && open && onDetachAll && (
        <button className="tmx-rail-out" onClick={onDetachAll} aria-label={tr('메신저 따로 창으로', 'Open the messenger in its own window')} data-tip={tr('메신저 따로 창으로', 'Messenger in its own window')}><IconWindowOut /></button>
      )}
      {!noAdd && <button className="tmx-rail-add" onClick={onStart} aria-label={team ? tr('팀 초대', 'Invite to team') : tr('팀 만들기', 'Make a team')} data-tip={team ? tr('팀 초대', 'Invite to team') : tr('팀 만들기', 'Make a team')}><IconPlus /></button>}
    </>
  );
}
