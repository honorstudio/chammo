// 메신저 앱 안 자리(시안 v2 A + C) 한 덩어리 — App 은 넘겨받은 조각(띠 칸·가운데 대화·스페이스 팀 탭·팝오버)만 끼운다(useFarMode 와 같은 모양).
// - 띠: 팀 표 → DM 펼침 → 누르면 가운데 칸이 그 대화. 메신저 전체를 떼면 띠는 말풍선 하나(안 읽은 수)
// - 떼기 아이콘은 모니터가 둘 이상일 때만(모니터 하나면 뗀 창이 스페이스를 가린다 — 시안 남은 고민, 10-23 이렇게 정함)
// - 스페이스 팀 탭은 고른 팀을 따라간다(고리로 끄고 켬, localStorage)
import { useEffect, useMemo, useState } from 'react';
import { teamWindowClose, teamWindowOpen, teamWindowState } from '../../data/teamApi';
import { convos as buildConvos, unreadTotal, windowKey, type Convo } from '../../domain/teamChat';
import { lockerApi } from '../space/useLocker';
import { every } from '../poll';
import { TeamConvo, type Handoff } from './TeamConvo';
import { TeamLocker } from './TeamLocker';
import { TeamRail } from './TeamRail';
import { TeamStart } from './TeamStart';
import { onTeamDock, useTeam } from './useTeam';
import { tr } from '../../i18n';

const FOLLOW_KEY = 'chammo.teamFollow';
const readFollow = () => { try { return localStorage.getItem(FOLLOW_KEY) !== '0'; } catch { return true; } };

export type TeamSpace = { name: string; follow: boolean; nonce: number; page: (open: (path: string) => void) => React.ReactNode };

export function useTeamMode(o: { handoff: () => Handoff | undefined; onLogin: () => void; wide: boolean }) {
  const data = useTeam();
  const { feed } = data;
  const view = feed?.view ?? null;
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [shown, setShown] = useState<string[]>([]);
  const [screens, setScreens] = useState(1);
  const [follow, setFollowState] = useState(readFollow);
  const [nonce, setNonce] = useState(0);
  const [pop, setPop] = useState<{ left: number; top: number } | null>(null);
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const f = () => setFocused(document.hasFocus() && !document.hidden);
    window.addEventListener('focus', f);
    window.addEventListener('blur', f);
    document.addEventListener('visibilitychange', f);
    return () => { window.removeEventListener('focus', f); window.removeEventListener('blur', f); document.removeEventListener('visibilitychange', f); };
  }, []);
  const cs: Convo[] = useMemo(() => (view?.joined ? buildConvos(view.members, view.rooms, feed?.items ?? [], data.read) : []), [view, feed, data.read]);
  const cur = cs.find((c) => c.key === sel) ?? null;
  const detached = shown.includes('all');
  const dimmed = useMemo(() => new Set(shown.filter((k) => k !== 'all')), [shown]);

  // 모니터 수·떼어 둔 창 — 켤 때 한 번은 지난번 뗀 창을 그 모니터가 있을 때만 다시 연다(없으면 앱 안으로)
  useEffect(() => {
    let first = true;
    const tick = () => void teamWindowState().then((s) => {
      setScreens(s.screens);
      setShown(s.shown);
      if (first && s.open.length && s.spotAlive && s.screens > 1) for (const k of s.open) void teamWindowOpen(k).catch(() => {});
      else if (first && s.open.length) for (const k of s.open) void teamWindowClose(k).catch(() => {}); // 기록만 지운다(앱 안으로)
      first = false;
    }, () => {});
    tick();
    const stop = every(tick, 30_000);
    const off = onTeamDock(({ key, place }) => setShown((x) => (place === 'window' ? (x.includes(key) ? x : [...x, key]) : x.filter((k) => k !== key))));
    return () => { stop(); off(); };
  }, []);
  // 메신저 전체를 뗐으면 앱 안 대화는 내려놓는다(가운데는 다시 내 참모)
  useEffect(() => { if (detached) setSel(null); }, [detached]);

  const setFollow = (on: boolean) => { setFollowState(on); try { localStorage.setItem(FOLLOW_KEY, on ? '1' : '0'); } catch { /* 이번 실행만 */ } };
  const pick = (c: Convo) => {
    if (c.room && dimmed.has(c.room)) { void teamWindowOpen(c.room, c.name); return; } // 대화 하나만 떼어 둔 방 — 그 창을 앞으로
    setSel(c.key);
    setNonce((n) => n + 1);
  };
  const openRoom = (room: string) => {
    if (detached) { void teamWindowOpen('all'); return; }
    if (dimmed.has(room)) { void teamWindowOpen(room); return; }
    const c = cs.find((x) => x.room === room);
    if (c) pick(c);
  };
  const handoff = o.handoff();
  const canDetach = screens > 1;
  const team = view?.joined ? view.team : null;

  return {
    data,
    railOn: cur ? cur.key : null,
    color: cur?.color,
    rail: (
      <TeamRail team={team} convos={cs} sel={sel} open={open} detached={detached} unread={unreadTotal(cs)} wide={o.wide} dimmed={dimmed}
        onTeam={() => { setOpen((x) => !x); setNonce((n) => n + 1); }} onPick={pick}
        onDetachAll={canDetach ? () => void teamWindowOpen('all', team ?? '') : undefined}
        onFront={() => void teamWindowOpen('all', team ?? '')}
        onStart={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setPop((p) => (p ? null : { left: Math.round(r.right + 8), top: Math.round(r.top) })); }} noAdd />
    ),
    // 팀 만들기·초대 — 팀 칸의 + 대신 참모 띠 + 메뉴에서(띠 RA '+ 하나', 2026-10-24 사용자). at = 띠 + 단추 오른쪽 위
    add: { label: team ? tr('팀 초대', 'Invite to team') : tr('팀 만들기', 'Make a team'), open: (at: { x: number; y: number }) => setPop({ left: Math.round(at.x), top: Math.round(at.y) }) },
    chat: cur && view && feed ? (
      <TeamConvo key={cur.key} convo={cur} items={feed.items} team={view.team} myName={view.me} handed={data.handed} focused={focused}
        onRead={data.markRoom} onHanded={data.markHanded} onSent={data.refresh} handoff={handoff}
        detach={canDetach ? () => { const k = windowKey(cur.room); if (cur.room) { setSel(null); void teamWindowOpen(k, cur.name); } } : undefined} />
    ) : null,
    space: team && view ? {
      name: team, follow, nonce,
      page: (openFile: (p: string) => void) => <TeamLocker teamId={view.teamId} team={team} people={view.members.length} follow={follow} onFollow={setFollow}
        onOpen={(p, dir) => (dir ? void lockerApi.reveal(p) : openFile(p))} />,
    } satisfies TeamSpace : undefined,
    pop: pop ? (
      <>
        <div className="tmx-pop-scrim" onClick={() => setPop(null)} />
        <div className="tmx-pop-at" style={{ left: pop.left, top: pop.top }}>
          <TeamStart view={view} onDone={() => { setPop(null); data.refresh(); }} onLogin={() => { setPop(null); o.onLogin(); }} />
        </div>
      </>
    ) : null,
    leave: () => setSel(null),
    openRoom,
  };
}
