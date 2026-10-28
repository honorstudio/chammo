// 메신저 따로 창(messenger.html?c=all&r=<방>) — 메인 창 팀 모드와 같은 조각(10-26 사용자 "참모만 안 뜨면 돼"):
// 팀 표 줄 | 대화 목록 + 대화 | 팀 홈·팀 보관함·연 파일 탭(useTeamMode alone). 좁은 창이면 오른쪽 칸을 접고 아이콘으로 연다.
// 대화 하나를 떼도 이 창에서 그 대화를 고른다(r=, 옛 주소 c=<방> 도). 붙이기 = 머리 붙이기 아이콘(team_window_close) 또는 창 닫기(Rust 가 메인 창에 알린다). 보내기는 메인 창과 같은 사람 문
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { teamUse } from '../../data/teamApi';
import { tr } from '../../i18n';
import { quietContextMenu } from '../../domain/teamSettings';
import { IconPanelRight, IconPlus } from '../Icons';
import { CONVO, TEAM_LIST_W, winFit } from '../../domain/teamLayout';
import { Grip } from '../TaskPanel';
import { ContextMenu } from '../OrchDialogs';
import { IconButton } from '../kit/IconButton';
import { type Handoff } from './TeamConvo';
import { TeamMarkIcon } from './TeamFaces';
import { TeamFile } from './TeamFile';
import { teamMenu } from './TeamSettings';
import { useTeamMode } from './useTeamMode';
import { CraftOpenAsk } from '../craft/openInCraft';
import './team.css';

/** 이 창의 오른쪽 클릭은 웹뷰 기본 메뉴(다시 로드·요소 검사) 대신 — 글 칸·고른 글 위에서만 기본(붙여넣기·복사). 팀 아이콘은 우리 메뉴(10-24 사용자) */
function useQuietMenu() {
  useEffect(() => {
    const f = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      const editable = !!t?.closest('input, textarea, [contenteditable="true"]');
      if (quietContextMenu({ editable, selection: String(window.getSelection() ?? '') })) e.preventDefault();
    };
    document.addEventListener('contextmenu', f);
    return () => document.removeEventListener('contextmenu', f);
  }, []);
}

/** 넘길 내 참모(고른 참모 to, 없으면 받은 팀 말을 받는 그 참모) — 한 번 묻고, 보내기는 team_handoff 한 길 */
function useHandoff(): Handoff | undefined {
  const [handTo, setHandTo] = useState('');
  useEffect(() => { void invoke<string>('team_handoff', { text: '', dry: true }).then(setHandTo, () => {}); }, []);
  return handTo ? { name: handTo, send: (text, to) => invoke<string>('team_handoff', { text, dry: false, to }).then(() => {}) } : undefined;
}

/** win = 주소 c(늘 'all', 옛 판은 방 id) · room = 주소 r(고를 방) */
export function MessengerApp({ win, room = '' }: { win: string; room?: string }) {
  useQuietMenu();
  return <MessengerTeam room={win === 'all' ? room : win} />;
}

function MessengerTeam({ room }: { room: string }) {
  const handoff = useHandoff();
  const tm = useTeamMode({ handoff: () => handoff, wide: false, alone: true, room });
  const view = tm.data.feed?.view ?? null;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // 창 폭 → 대화 폭·좁은 창(domain/teamLayout winFit) — 오른쪽 팀 칸은 늘 SIDE_MIN 이상, 안 되면 접고 아이콘으로
  const [win, setWin] = useState(() => window.innerWidth);
  const [side, setSide] = useState(false);
  useEffect(() => {
    const f = () => setWin(window.innerWidth);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  const folded = tm.fold && !!tm.space;
  const fit = winFit(win, tm.convo, folded);
  const narrow = fit.narrow;
  // 좁은 창에서 파일을 누르면 오른쪽 칸을 연다(연 탭이 늘면)
  const files = tm.tabs.files.length;
  const [seenFiles, setSeenFiles] = useState(files);
  if (files !== seenFiles) { setSeenFiles(files); if (files > seenFiles) setSide(true); }
  useEffect(() => { document.title = view?.team || tr('메신저', 'Messenger'); }, [view?.team]);
  const showSide = !narrow || side;
  // 크게 보기 — 오른쪽 칸을 창 전체로(대화·팀 표 줄을 잠깐 내린다). 다시 누르거나 Esc·다른 탭이면 되돌림(10-28 사용자 "크게 봐야 하는 경우")
  const [big, setBig] = useState(false);
  useEffect(() => setBig(false), [tm.tabs.cur]);
  useEffect(() => {
    if (!big) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setBig(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [big]);
  // 대화 칸 폭을 정해 두는 건 팀 칸이 옆에 같이 있을 때만(좁은 창·팀 없음은 가운데가 창 전체)
  const sized = !narrow && !!tm.space && !!tm.chat;
  const chatW = TEAM_LIST_W + fit.convo;
  const team = view?.joined ? view.team : '';
  const send = (text: string) => (handoff ? handoff.send(text) : Promise.reject(new Error(tr('넘길 참모가 없어요', 'No assistant to hand to'))));
  return (
    <div className={`tmx-win tmw ${narrow ? 'tmw-narrow' : ''} ${showSide ? 'tmw-open' : ''} ${folded ? 'tmw-fold' : ''} ${big ? 'tmw-big' : ''}`}>
      <CraftOpenAsk />
      <nav className="tmx-win-teams" aria-label={tr('팀', 'Teams')}>
        {view?.joined && (
          <button aria-label={view.team} title={view.team} aria-haspopup="menu"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: Math.round(r.right + 6), y: Math.round(r.top) }); }}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}>
            <TeamMarkIcon name={view.team} size={34} on img={tm.icon} />
          </button>
        )}
        <IconButton size="l" label={view?.joined ? tr('팀 초대', 'Invite to team') : tr('팀 만들기', 'Make a team')}
          onClick={() => tm.openPop(view?.joined ? 'link' : 'start')}><IconPlus /></IconButton>
        {narrow && view?.joined && <IconButton size="l" label={tr('팀 홈·보관함', 'Team home and locker')} pressed={side} onClick={() => setSide((x) => !x)}><IconPanelRight /></IconButton>}
      </nav>
      {!folded && (
        <div className={`tmw-chat ${sized ? 'sized' : ''}`} style={sized ? { flex: `0 0 ${chatW}px` } : undefined}>
          {sized && <Grip side="right" width={chatW} onWidth={(w) => tm.setConvo(w - TEAM_LIST_W)} min={TEAM_LIST_W + CONVO.min} max={TEAM_LIST_W + fit.max} />}
          {tm.chat ?? <div className="tmx-win-main"><div className="tmx-win-empty">{view ? tr('아직 든 팀이 없어요 — + 로 팀을 만들거나 초대 링크로 들어와요', 'No team yet — make one with + or join with an invite link') : tr('불러오는 중…', 'Loading…')}</div></div>}
        </div>
      )}
      {showSide && tm.space && <div className="tmw-side">{tm.space.view((p) => <TeamFile path={p} team={team} send={send} big={big} onBig={() => setBig((b) => !b)} />, narrow ? () => setSide(false) : undefined)}</div>}
      {tm.pop}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={teamMenu(view, (kind) => tm.openPop(kind), (t) => void teamUse(t).then(() => tm.data.refresh(), () => {}))} onClose={() => setMenu(null)} />}
    </div>
  );
}

