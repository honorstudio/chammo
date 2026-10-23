// 메신저 따로 창(messenger.html?c=all|<방>) — 시안 v2 C: 팀 표 줄 | 목록 | 대화 한 창, 대화 하나만 뗐으면 그 대화만.
// 붙이기 = 머리 붙이기 아이콘(team_window_close) 또는 창 닫기(Rust 가 메인 창에 알린다). 보내기는 메인 창과 같은 사람 문
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';
import { teamWindowClose } from '../../data/teamApi';
import { convos as buildConvos, type Convo } from '../../domain/teamChat';
import { tr } from '../../i18n';
import { IconDockIn, IconPlus } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { TeamConvo, type Handoff } from './TeamConvo';
import { TeamMarkIcon } from './TeamFaces';
import { TeamList } from './TeamList';
import { TeamStart } from './TeamStart';
import { useTeam } from './useTeam';
import './team.css';

export function MessengerApp({ win }: { win: string }) {
  const data = useTeam();
  const view = data.feed?.view ?? null;
  const [sel, setSel] = useState<string | null>(null);
  const [start, setStart] = useState(false);
  const [focused, setFocused] = useState(() => document.hasFocus());
  const [handTo, setHandTo] = useState('');
  useEffect(() => {
    const f = () => setFocused(document.hasFocus() && !document.hidden);
    window.addEventListener('focus', f);
    window.addEventListener('blur', f);
    return () => { window.removeEventListener('focus', f); window.removeEventListener('blur', f); };
  }, []);
  // 넘길 내 참모 이름(받은 팀 말을 받는 그 참모) — 한 번
  useEffect(() => { void invoke<string>('team_handoff', { text: '', dry: true }).then(setHandTo, () => {}); }, []);
  const cs: Convo[] = useMemo(() => (view?.joined ? buildConvos(view.members, view.rooms, data.feed?.items ?? [], data.read) : []), [view, data.feed, data.read]);
  const one = win !== 'all';
  const cur = one ? cs.find((c) => c.room === win) ?? null : cs.find((c) => c.key === sel) ?? cs[0] ?? null;
  const dock = () => void teamWindowClose(win);
  const handoff: Handoff | undefined = handTo ? { name: handTo, send: (text) => invoke<string>('team_handoff', { text, dry: false }).then(() => {}) } : undefined;
  useEffect(() => { document.title = one && cur ? cur.name : view?.team || tr('메신저', 'Messenger'); }, [one, cur, view?.team]);
  const convo = cur && view && data.feed ? (
    <TeamConvo key={cur.key} convo={cur} items={data.feed.items} team={view.team} myName={view.me} handed={data.handed} focused={focused}
      onRead={data.markRoom} onHanded={data.markHanded} onSent={data.refresh} handoff={handoff} dock={one ? dock : undefined} />
  ) : null;
  if (one) return <div className="tmx-win"><div className="tmx-win-main">{convo ?? <div className="tmx-win-empty">{tr('이 대화를 찾는 중…', 'Finding this chat…')}</div>}</div></div>;
  return (
    <div className="tmx-win">
      <nav className="tmx-win-teams" aria-label={tr('팀', 'Teams')}>
        {view?.joined && <button aria-label={view.team} title={view.team}><TeamMarkIcon name={view.team} size={34} on /></button>}
        <IconButton size="l" label={view?.joined ? tr('팀 초대', 'Invite to team') : tr('팀 만들기', 'Make a team')} onClick={() => setStart((x) => !x)}><IconPlus /></IconButton>
      </nav>
      <div className="tmx-win-list">
        <div className="tmx-list-h"><b>{view?.team || tr('메신저', 'Messenger')}</b>
          <IconButton className="tmx-win-dock" label={tr('앱에 붙이기', 'Dock into the app')} onClick={dock}><IconDockIn /></IconButton>
        </div>
        {start ? <div className="tmx-win-start"><TeamStart view={view} onDone={() => { setStart(false); data.refresh(); }} /></div>
          : <div className="tmx-list"><TeamList convos={cs} sel={cur?.key ?? null} onPick={(c) => setSel(c.key)} /></div>}
      </div>
      <div className="tmx-win-main">{convo ?? <div className="tmx-win-empty">{tr('대화를 골라 줘', 'Pick a chat')}</div>}</div>
    </div>
  );
}
