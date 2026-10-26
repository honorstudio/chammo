// 대화 목록(팀 모드 가운데·메신저 따로 창·폰 팀 탭) — 시안 msg-rooms A 두 묶음: 위 팀챗(여러 사람), 아래 DM(1:1) — 용어 10-26 사용자
// 한 줄: 얼굴(방은 방 표) · 이름 · 마지막 말 · 시각 · 안 읽은 수. 안 읽은 줄은 굵게. 묶음 머리를 누르면 접는다
import { useState } from 'react';
import { previewOf, stamp, type Convo } from '../../domain/teamChat';
import { tr } from '../../i18n';
import { IconPlus } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { PersonOf, TeamMarkIcon, Unread } from './TeamFaces';
import './team.css';

type Menu = (e: React.MouseEvent, c: Convo) => void;

// 우클릭은 메뉴만 — 맥 ctrl+클릭은 메뉴라 열기(왼클릭)를 같이 부르지 않는다(보관함 끌기 dragPath 와 같은 규칙)
function Row({ c, sel, onPick, onMenu, now }: { c: Convo; sel: string | null; onPick: (c: Convo) => void; onMenu?: Menu; now: number }) {
  return (
    <button className={`tmx-li ${sel === c.key ? 'on' : ''} ${c.unread ? 'unread' : ''}`} onClick={(e) => { if (e.ctrlKey) return; onPick(c); }}
      onContextMenu={onMenu ? (e) => { e.preventDefault(); e.stopPropagation(); onMenu(e, c); } : undefined} aria-current={sel === c.key || undefined}>
      {c.kind === 'group' ? <TeamMarkIcon name={c.name} size={30} /> : <PersonOf member={c.peer} name={c.name} color={c.color} size={30} />}
      <span className="tmx-tx"><b>{c.name}</b><span>{previewOf(c.last)}</span></span>
      <span className="tmx-r">{c.last ? stamp(c.last.at, now) : ''}<Unread n={c.unread} inline /></span>
    </button>
  );
}

export function TeamList({ convos, rooms = [], sel, onPick, onMenu, onInvite, onNewRoom }: {
  convos: Convo[];
  /** 단톡방(roomConvos) — 없으면 방 묶음을 안 그린다(폰 옛 화면) */
  rooms?: Convo[];
  sel: string | null;
  onPick: (c: Convo) => void;
  /** 줄 우클릭 — 팀챗 이름·사람·나가기·지우기, DM 숨기기(useRoomMenu) */
  onMenu?: Menu;
  /** 빈 화면의 '초대 링크 만들기' — 메신저 창 */
  onInvite?: () => void;
  /** 방 묶음 머리 + — 단톡방 만들기 */
  onNewRoom?: () => void;
}) {
  const now = Date.now();
  const [fold, setFold] = useState<{ rooms?: boolean; people?: boolean }>({});
  if (!convos.length && !rooms.length) return (
    <div className="tmx-none">{tr('아직 팀에 다른 사람이 없어요 — 초대 링크를 보내 봐요', 'Nobody else in the team yet — send an invite link')}
      {onInvite && <div><button className="tmx-btn pri" onClick={onInvite}>{tr('초대 링크 만들기', 'Make an invite link')}</button></div>}
    </div>
  );
  const head = (k: 'rooms' | 'people', label: string, extra?: React.ReactNode) => (
    <div className="tmx-grp">
      <button className="tmx-grp-h" aria-expanded={!fold[k]} onClick={() => setFold((f) => ({ ...f, [k]: !f[k] }))}>{label}</button>
      {extra}
    </div>
  );
  const showRooms = !!onNewRoom || rooms.length > 0;
  return (
    <>
      {showRooms && head('rooms', tr('팀챗', 'Team chats'), onNewRoom && <IconButton size="s" label={tr('팀챗 만들기', 'New team chat')} onClick={onNewRoom}><IconPlus /></IconButton>)}
      {showRooms && !fold.rooms && rooms.map((c) => <Row key={c.key} c={c} sel={sel} onPick={onPick} onMenu={onMenu} now={now} />)}
      {showRooms && !fold.rooms && !rooms.length && <div className="tmx-none tmx-sm">{tr('아직 팀챗이 없어요', 'No team chats yet')}</div>}
      {showRooms && head('people', tr('DM', 'DMs'))}
      {!fold.people && convos.map((c) => <Row key={c.key} c={c} sel={sel} onPick={onPick} onMenu={onMenu} now={now} />)}
    </>
  );
}
