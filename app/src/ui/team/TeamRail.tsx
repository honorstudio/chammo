// 띠의 팀 칸(시안 team-space v1 A) — 참모 프사 아래 구분선 밑에 내 팀이 위아래로(11-02 팀 여러 개, 시안 team-add v1 A: 슬랙·디스코드 줄), 맨 아래 + 하나.
// 지금 팀 칸을 누르면 팀 모드(화면 전체가 팀), 다른 팀 칸을 누르면 그 팀으로 바뀐다. 줄 순서는 teamStack(서버 순서) — 바꿔도 칸 자리가 안 움직인다.
// 방·DM 프사를 띠에 펼치지 않는다 — 목록은 팀 모드 가운데(TeamList). 칸은 띠(.lk-strip) 바로 아래 형제 — 고른 표시(.lk-av.on)·호버 카드(data-tip)를 그대로 쓴다
// 고른 표시는 참모 칸과 같은 그림 둘레 테두리 하나, 색만 팀 색(팀 홈에서 고른 색, 없으면 이름 색 — 10-29 사용자)
import type { ReactNode } from 'react';
import { tr } from '../../i18n';
import { teamMark } from '../../domain/teamChat';
import type { MenuItem } from '../OrchDialogs';
import { IconPeople, IconPlus } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { TeamMarkIcon } from './TeamFaces';
import './team.css';

type Stacked = { id: string; name: string; current: boolean };

export function TeamRail({ icon, color, chats, on, wide, stack, unreadOf, onTeam, onMenu, onPickTeam, onAdd, onIntro }: {
  /** 지금 팀 아이콘 그림(data URL, 팀 설정에서 팀장이 바꾼다) — 다른 팀은 첫 글자 */
  icon?: string;
  /** 지금 팀 색(팀 홈 판) — 없으면 이름 색 */
  color?: string;
  /** 지금 팀 대화 수(넓은 띠 둘째 줄) */
  chats: number;
  /** 팀 모드 — 고른 칸 표시 */
  on: boolean;
  wide: boolean;
  /** 내 팀(domain/teamAdd teamStack) — 비면 + 하나만 */
  stack: Stacked[];
  unreadOf: (id: string) => number;
  onTeam: () => void;
  /** 지금 팀 칸 오른쪽 누르기 — 팀 초대·팀 설정 메뉴(웹뷰 기본 메뉴 대신, 10-24) */
  onMenu?: (e: React.MouseEvent) => void;
  onPickTeam: (id: string) => void;
  /** 맨 아래 + — 새 팀 만들기·초대 링크로 들어가기 두 줄(addMenu) */
  onAdd: (at: { x: number; y: number }) => void;
  /** 팀이 없고 만들 권한이 없거나 로그인 전 — + 대신 '팀' 칸, 누르면 소개 판(시안 team-lock v1 C, chammo-relay ADR 0015) */
  onIntro?: () => void;
}) {
  return (
    <>
      <i className="far-sep" aria-hidden="true" />
      {stack.map((t) => {
        const unread = unreadOf(t.id);
        if (t.current) {
          const sub = unread ? tr(`안 읽은 말 ${unread}`, `${unread} unread`) : tr(`대화 ${chats}`, `${chats} chats`);
          return (
            <button key={t.id} className={`lk-av tmx tmx-rail-team ${on ? 'on' : ''}`} onClick={onTeam} onContextMenu={onMenu ? (e) => { e.preventDefault(); onMenu(e); } : undefined}
              aria-current={on || undefined} aria-label={unread ? tr(`${t.name} — 안 읽은 말 ${unread}`, `${t.name} — ${unread} unread`) : t.name} data-tip={t.name} data-tip-sub={sub}
              style={{ '--rail-on': color ?? teamMark(t.name).color } as React.CSSProperties}>
              <span className="lk-av-pic"><TeamMarkIcon name={t.name} size={30} badge={unread} img={icon} /></span>
              {wide && <span className="lk-av-tx"><b>{t.name}</b><span>{sub}</span></span>}
            </button>
          );
        }
        const sub = unread ? tr(`안 읽은 말 ${unread}`, `${unread} unread`) : undefined;
        return (
          <button key={t.id} className="lk-av tmx tmx-rail-team tmx-rail-other" onClick={() => onPickTeam(t.id)}
            aria-label={unread ? tr(`${t.name} — 안 읽은 말 ${unread}`, `${t.name} — ${unread} unread`) : t.name} data-tip={t.name} data-tip-sub={sub}
            style={{ '--rail-on': teamMark(t.name).color } as React.CSSProperties}>
            <span className="lk-av-pic"><TeamMarkIcon name={t.name} size={30} badge={unread} /></span>
            {wide && <span className="lk-av-tx"><b>{t.name}</b>{sub && <span>{sub}</span>}</span>}
          </button>
        );
      })}
      {/* 팀 추가 + — 넓어도 아이콘만(익숙한 동작, 아이콘+글자 줄 금지). 참모 + 와 같은 모양, 구분선과 툴팁으로 가른다 */}
      {onIntro && !stack.length
        ? <IconButton size="l" className="rail-new tmx-rail-add tml-rail-team" label={tr('팀', 'Team')} title="" data-tip={tr('팀', 'Team')} onClick={onIntro}><IconPeople /></IconButton>
        : <IconButton size="l" className="rail-new tmx-rail-add" label={tr('팀 추가', 'Add a team')} title="" data-tip={tr('팀 추가', 'Add a team')}
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onAdd({ x: r.right + 6, y: r.top }); }}><IconPlus /></IconButton>}
    </>
  );
}

/** + 메뉴 — 글자 두 줄(새 팀 만들기 / 초대 링크로 들어가기). 칩 ▾ 메뉴 끝에도 같은 두 줄 */
export const addMenu = (make: () => void, join: () => void): MenuItem[] => [
  { label: tr('새 팀 만들기', 'Create a team'), run: make },
  { label: tr('초대 링크로 들어가기', 'Join with an invite link'), run: join },
];

/** 목록 머리 팀 이름 칩 ▾(보조, 시안 C) — 내 팀 줄(지금 팀 점) + 구분선 + 같은 두 줄 */
export function teamListMenu(stack: Stacked[], unreadOf: (id: string) => number, pick: (id: string) => void, make: () => void, join: () => void): MenuItem[] {
  const rows: MenuItem[] = stack.map((t) => {
    const n = unreadOf(t.id);
    const node: ReactNode = (
      <span className="tmx-menu-team"><TeamMarkIcon name={t.name} size={22} /><b>{t.name}</b>{n > 0 && <i className="tmx-ur in">{n > 99 ? '99+' : n}</i>}</span>
    );
    return { label: t.name, node, checked: t.current, run: t.current ? undefined : () => pick(t.id) };
  });
  // sep 은 다음 줄 위에 긋는 표시(OrchDialogs ContextMenu) — 두 줄 중 첫 줄에
  const [first, ...rest] = addMenu(make, join);
  return [...rows, { ...first!, sep: true }, ...rest];
}
