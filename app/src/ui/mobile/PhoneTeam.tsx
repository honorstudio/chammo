// 폰 팀 탭(시안 v2 C) — 맨 아래 탭바 참모 | 팀 중 팀. 위 팀 이름(꺾쇠) → 시트(팀 바꾸기·만들기·초대 링크), 그 아래 대화 | 팀 홈 | 보관함.
// 별명·사진·상태는 데스크톱과 같은 프로필판(ProfilesCtx·lookOf) — 폰은 본 판 번호를 들고 4초마다 묻는다(그대로면 맥이 중계를 안 부른다).
// 팀 홈은 데스크톱 TeamHome 그대로, 글 길만 폰 것(새 글·팀장 고정만 — 고치기·고정 바꾸기·지우기는 데스크톱)
// 대화를 누르면 화면 전체가 그 대화(데스크톱과 같은 대화 칸 — 풍선 = 사람, 얼굴 + 맨 글 = 참모). 보내기는 사람 말(이 칸의 진짜 누름 뒤 1.5초)
// 읽기·쓰기는 TeamPhoneApi 하나로만 — 지금은 맥 폰 서버(/api/team*), 중계 직결이 생기면 그것만 바꾼다
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { teamThumbBlob, type TeamPhoneApi } from '../../data/web';
import { keepBoard, namedConvos, type ProfileBoard } from '../../domain/teamProfile';
import type { PostApi } from '../../domain/teamPosts';
import type { HomeApi, HomeSources } from '../../domain/teamHome';
import type { TeamFeed } from '../../data/teamApi';
import { sendAllowed } from '../../domain/remoteChat';
import { convos as buildConvos, roomConvos, markRead, unreadTotal, type Convo, type TeamItem } from '../../domain/teamChat';
import { mergedRead, pushRead } from '../../domain/teamReads';
import { IconCheck, IconChevronDown, IconCopy, IconShare } from '../Icons';
import { TeamConvo } from '../team/TeamConvo';
import { draftStore } from '../../domain/chatDraft';
import { TeamMarkIcon } from '../team/TeamFaces';
import { TeamHome, type HomeDialog } from '../team/TeamHome';
import { TeamCal } from '../team/TeamCal';
import { CalBlock } from '../team/CalBlock';
import { TeamList } from '../team/TeamList';
import { ProfilesCtx, type Profiles } from '../team/useProfiles';
import { BottomSheet, SheetHostProvider } from './BottomSheet';
import { IconBtn } from './kit';
import { BetaTag } from '../kit/BetaTag';
import { PhoneTeamLocker } from './PhoneTeamLocker';
import { machine, tr } from '../../i18n';
import '../team/team.css';
import { seenName } from '../../domain/session';
import { AgentsSection } from '../team/TeamAgents';
import { TeamAgentEdit, type AgentEditApi } from '../team/TeamAgentEdit';
import type { AgentList, AgentShown } from '../../domain/teamAgent';
import { IconBack } from '../Icons';

// 폰 입력칸 쓰던 글 — 대화를 오가는 동안만(메모리, 비밀이 폰 저장소에 남지 않게)
const phoneDrafts = draftStore(undefined, 'teamDraft:');

const READ_KEY = 'm.teamRead';
const HANDED_KEY = 'm.teamHanded';
const load = <T,>(k: string, d: T): T => { try { return (JSON.parse(localStorage.getItem(k) ?? '') as T) ?? d; } catch { return d; } };
const keep = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 이번만 */ } };

/** 팀 읽기 — 팀 탭을 보는 동안 4초, 아니면 30초(탭바 안 읽은 수만). 읽음은 이 폰 값과 같은 계정 다른 기기 값(feed.reads) 중 큰 것 */
export function usePhoneTeam(api: TeamPhoneApi, active: boolean) {
  const [feed, setFeed] = useState<TeamFeed | null>(null);
  const [local, setRead] = useState<Record<string, number>>(() => load(READ_KEY, {}));
  const read = useMemo(() => mergedRead(local, feed?.reads, feed?.view?.rooms ?? []), [local, feed]);
  const refresh = useCallback(() => void api.feed().then(setFeed, () => {}), [api]);
  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, active ? 4000 : 30_000);
    return () => window.clearInterval(t);
  }, [refresh, active]);
  const view = feed?.view?.joined ? feed.view : null;
  const cs = useMemo(() => (view ? buildConvos(view.members, view.rooms, feed?.items ?? [], read) : []), [view, feed, read]);
  // 단톡방(보내기는 /api/team-say 의 room:<id> 주소) — 만들기·바꾸기는 데스크톱·참모에서. 방 목록엔 모든 팀 방이 온다 — 이 팀 것만(데스크톱 useTeamMode 와 같게)
  const rs = useMemo(() => (view ? roomConvos(view.rooms.filter((r) => (r.team || view.teamId) === view.teamId), feed?.items ?? [], read) : []), [view, feed, read]);
  const markRoom = (room: string) => {
    setRead((r) => { const n = markRead(r, room, feed?.items ?? []); if (n !== r) keep(READ_KEY, n); return n; });
    // 맥(→ 중계)엔 폰 화면이 보일 때만 — 잠긴 폰·뒤로 간 탭은 읽음 아님
    const me = feed?.view?.rooms?.find((r) => r.id === room)?.me ?? '';
    const seq = feed && me ? pushRead(room, feed.items, feed.reads?.[room] ?? {}, me, document.visibilityState === 'visible') : null;
    if (seq) void api.read(room, seq).catch(() => {});
  };
  return { feed, cs, rs, unread: unreadTotal([...rs, ...cs]), refresh, markRoom };
}

/** 프로필판 — 본 판 번호(rev)를 들고 4초마다. 실패는 아는 판 둔 채 다음에 다시(맥 재시작 한 번에 기본값으로 굳지 않게) */
function usePhoneProfiles(api: TeamPhoneApi, teamId: string): Profiles {
  const [board, setBoard] = useState<ProfileBoard | null>(null);
  const known = useRef<ProfileBoard | null>(null);
  const rev = useRef(0);
  const busy = useRef(false);
  const read = useCallback(() => {
    if (!teamId || busy.current) return;
    busy.current = true;
    void api.profiles(teamId, rev.current).then((x) => {
      const n = keepBoard(known.current, x, teamId);
      if (!n || n === known.current) return;
      known.current = n;
      rev.current = n.rev;
      setBoard(n);
    }, () => {}).finally(() => { busy.current = false; });
  }, [api, teamId]);
  useEffect(() => {
    known.current = null;
    rev.current = 0;
    setBoard(null);
    read();
    const t = window.setInterval(read, 4000);
    return () => window.clearInterval(t);
  }, [read]);
  return useMemo(() => ({ board, reload: () => { rev.current = 0; read(); } }), [board, read]);
}

/** 팀 홈 글쓰기 — 폰은 아래 시트(데스크톱 TeamDialog 자리) */
const HomeSheet: HomeDialog = ({ label, onClose, children }) => <BottomSheet label={label} title={label} onClose={onClose} bodyClass="m-picker-list m-team-sheet-home">{children}</BottomSheet>;

/** open = 팀 메시지 알림을 눌러 왔다 — 그 방 대화를 연다(대화 목록이 아직 없으면 받은 뒤에) */
/** kb = 키보드가 떠 있나(시트 자리가 키보드 위에 시트를 놓는다) */
export function PhoneTeam({ api, t, orch, open, kb }: { api: TeamPhoneApi; t: ReturnType<typeof usePhoneTeam>; orch: { id: string; name: string }; open?: { n: number; room: string } | null; kb: boolean }) {
  const view = t.feed?.view ?? null;
  const teamId = view?.joined ? view.teamId : '';
  const profiles = usePhoneProfiles(api, teamId);
  // 사람 대화 이름은 프로필 별명(데스크톱 목록·팀 설정과 같게)
  const cs = useMemo(() => namedConvos(t.cs, profiles.board), [t.cs, profiles.board]);
  const posts: PostApi = useMemo(() => ({
    board: (team, seen) => api.posts(team, seen ?? 0),
    write: async (team, title, body, _origin, pin) => {
      const r = await api.post(team, title, body, pin);
      if (r.pinError) throw new Error(`pin: ${r.pinError}`);
      return r.id;
    },
    edit: false,
  }), [api]);
  // 팀 홈 판(ADR 0018) — 같은 판을 맥이 읽고 쓴다. 커버는 데스크톱만, 파일은 이름만(여는 건 보관함 칸)
  const homeApi: HomeApi = useMemo(() => ({
    board: (team, seen) => api.home(team, seen ?? 0),
    save: (team, home) => api.homeSave(team, home),
    content: (team, block, c) => api.homeContent(team, block, c),
  }), [api]);
  const homeSources: HomeSources = useMemo(() => ({
    agents: (team) => api.agents(team).then((l) => l.agents),
    files: (team) => api.locker(team, 0).then((v) => ('items' in v ? v.items : [])),
    openUrl: (url) => { window.open(url, '_blank', 'noopener'); },
  }), [api]);
  const [seg, setSeg] = useState<'chat' | 'home' | 'cal' | 'locker'>('chat');
  const [sel, setSel] = useState<string | null>(null);
  // 폰 화면이 보일 때만 읽음(잠금·다른 앱으로 간 동안 온 말은 돌아와 보일 때 읽음)
  const [shown, setShown] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const f = () => setShown(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);
  const [sheet, setSheet] = useState(false);
  // 팀 참모 화면(ADR 0017 — 폰은 팀 시트에서 연다). edit = 고치는 참모(a null = 새로)
  const [agentPage, setAgentPage] = useState<{ edit?: { a: AgentShown | null; list: AgentList }; key: number } | null>(null);
  const [opened, setOpened] = useState(0);
  useEffect(() => {
    if (!open || open.n === opened) return;
    const c = [...t.rs, ...t.cs].find((x) => x.room === open.room);
    if (!c) return;
    setOpened(open.n);
    setSheet(false);
    setSeg('chat');
    setSel(c.key);
  }, [open, t.cs, opened]);
  const [handed, setHanded] = useState<Record<string, string>>(() => load(HANDED_KEY, {}));
  const cur = [...t.rs, ...cs].find((c) => c.key === sel) ?? null;
  // 같은 말을 2분 안에 다시 보내면(실패 뒤 다시 누름) 같은 cid — 맥·서버가 한 번만 저장한다
  const lastCid = useRef<{ key: string; cid: string; at: number } | null>(null);
  const cidFor = (to: string, text: string) => {
    const key = `${to}\n${text}`;
    const l = lastCid.current;
    if (l && l.key === key && Date.now() - l.at < 120_000) return l.cid;
    const cid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    lastCid.current = { key, cid, at: Date.now() };
    return cid;
  };
  const say = (to: string, text: string, at: number, extra?: { re?: number }) => (sendAllowed(at, Date.now()) && text.trim() ? api.say(to, text, cidFor(to, text), extra?.re) : null);
  // 팀 참모(ADR 0017) — 맥 폰 서버 길. 마지막 목록 캐시는 맥에만 있어서 둘 다 새로 받는다
  const agentsApi = useMemo(() => ({ cached: () => Promise.reject(new Error('no cache on phone')), fresh: (team: string) => api.agents(team), confirm: (team: string, id: string) => api.agentConfirm(team, id).then(() => {}), usage: (room: string) => api.agentUsage(room) }), [api]);
  const agentEdit: AgentEditApi = useMemo(() => ({ save: (team, def, origin) => api.agentSave(team, def, origin), remove: (team, id) => api.agentRemove(team, id), tryRun: (team, room, def, ask, prev) => api.agentTry(team, room, def, ask, prev), refs: (team) => api.agentRefs(team) }), [api]);
  if (agentPage && view?.joined) {
    // 팀 참모 — 목록 → 정의 한 장 + 아래 시험 서랍(시안 섞음 2, 좁은 칸이라 TeamAgentEdit 가 서랍 모양)
    const rooms = view.rooms.filter((r) => (r.kind === 'group' || r.kind === 'dm') && (!r.team || r.team === view.teamId)).map((r) => ({ id: r.id, name: r.name || r.with }));
    return (
      <SheetHostProvider kb={kb}>
      <div className="m-team m-team-agents">
        {agentPage.edit
          ? <TeamAgentEdit team={view.teamId} list={agentPage.edit.list} editing={agentPage.edit.a} people={view.members.map((m) => m.name)} rooms={rooms} api={agentEdit}
              onBack={() => setAgentPage((p) => p && { key: p.key })} onSaved={() => setAgentPage((p) => ({ key: (p?.key ?? 0) + 1 }))} />
          : <>
              <header className="m-team-head"><IconBtn label={tr('뒤로', 'Back')} onClick={() => setAgentPage(null)}><IconBack /></IconBtn><b>{tr('팀 참모', 'Team agents')}</b></header>
              <div className="m-team-body m-agents"><AgentsSection key={agentPage.key} team={view.teamId} load={api.agents} onEdit={(a, list) => setAgentPage((p) => ({ key: p?.key ?? 0, edit: { a, list } }))} /></div>
            </>}
      </div>
      </SheetHostProvider>
    );
  }
  if (cur && view && t.feed) {
    return (
      <ProfilesCtx.Provider value={profiles}>
      <SheetHostProvider kb={kb}>
      <div className="m-team m-team-convo">
        <TeamConvo convo={cur} items={t.feed.items} team={view.team} myName={view.me} handed={handed} drafts={phoneDrafts} agentsApi={agentsApi} focused={shown} onRead={t.markRoom} reads={t.feed.reads} onSent={t.refresh} safety={t.feed.safety} held={t.feed.held} phone members={view.members}
          onHanded={(it: TeamItem, to: string) => setHanded((h) => { const n = { ...h, [`${it.room}:${it.seq}`]: to }; keep(HANDED_KEY, n); return n; })}
          handoff={{ name: seenName(orch.name), send: (text) => api.handoff(orch.id, text).then(() => {}) }} say={say} viewing={() => {}} back={() => setSel(null)}
          teamId={view.teamId} thumb={teamThumbBlob} />
      </div>
      </SheetHostProvider>
      </ProfilesCtx.Provider>
    );
  }
  return (
    <ProfilesCtx.Provider value={profiles}>
    {/* 시트 자리 — 팀 시트·팀 홈 글쓰기가 칸(.tmh position:relative) 안에 갇히지 않게 */}
    <SheetHostProvider kb={kb}>
    <div className="m-team">
      <header className="m-team-head">
        <button className="m-team-switch" onClick={() => setSheet(true)} aria-label={tr('팀 바꾸기·만들기·초대', 'Switch, create or invite to a team')}>
          {view?.joined ? <><TeamMarkIcon name={view.team} size={30} img={profiles.board?.teamIcon || undefined} /><b>{view.team}</b></> : <b>{tr('팀', 'Team')}</b>}
          <IconChevronDown />
        </button>
        <BetaTag className="m-team-beta" />
      </header>
      {view?.joined && (
        <div className="m-seg" role="tablist">
          <button role="tab" aria-selected={seg === 'chat'} className={seg === 'chat' ? 'on' : ''} onClick={() => setSeg('chat')}>{tr('대화', 'Chats')}</button>
          <button role="tab" aria-selected={seg === 'home'} className={seg === 'home' ? 'on' : ''} onClick={() => setSeg('home')}>{tr('팀 홈', 'Team home')}</button>
          <button role="tab" aria-selected={seg === 'cal'} className={seg === 'cal' ? 'on' : ''} onClick={() => setSeg('cal')}>{tr('캘린더', 'Calendar')}</button>
          <button role="tab" aria-selected={seg === 'locker'} className={seg === 'locker' ? 'on' : ''} onClick={() => setSeg('locker')}>{tr('보관함', 'Locker')}</button>
        </div>
      )}
      <div className="m-team-body">
        {!view?.joined ? <div className="tmx-none">{tr(`아직 팀이 없어요 — 위 팀 이름을 눌러 만들거나, ${machine()} 설정 > 계정에서 Chammo 계정에 로그인해요`, `No team yet — tap the team name above to create one, or sign in to your Chammo account in ${machine()} Settings > Account`)}</div>
          : seg === 'chat' ? <div className="tmx-list"><TeamList convos={cs} rooms={t.rs} sel={null} onPick={(c: Convo) => setSel(c.key)} /></div>
          : seg === 'home' ? <div className="m-team-home"><TeamHome teamId={view.teamId} team={view.team} members={view.members} icon={profiles.board?.teamIcon || undefined} api={posts} Dialog={HomeSheet} homeApi={homeApi} sources={homeSources} phone
              calBlock={(_b, editing) => <CalBlock teamId={view.teamId} wide={false} editing={editing} api={api.cal} onOpen={() => setSeg('cal')} />} /></div>
          : seg === 'cal' ? <div className="m-team-cal"><TeamCal key={view.teamId} teamId={view.teamId} members={view.members} api={api.cal} Dialog={HomeSheet} phone /></div>
          : <PhoneTeamLocker api={api} teamId={view.teamId} />}
      </div>
      {sheet && <TeamSheet api={api} t={t} onClose={() => setSheet(false)} onAgents={() => { setSheet(false); setAgentPage({ key: 0 }); }} />}
    </div>
    </SheetHostProvider>
    </ProfilesCtx.Provider>
  );
}

/** 팀 시트 — 팀 바꾸기(지금은 팀 하나)·팀 만들기·초대 링크(팀장만) */
function TeamSheet({ api, t, onClose, onAgents }: { api: TeamPhoneApi; t: ReturnType<typeof usePhoneTeam>; onClose: () => void; onAgents: () => void }) {
  const view = t.feed?.view ?? null;
  const [link, setLink] = useState<string | null>(null);
  /** 실패 — 화면엔 한국어 한 줄(msg), 원문은 이름표(raw) */
  const [err, setErr] = useState<{ msg: string; raw: string } | null>(null);
  const [making, setMaking] = useState(false);
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (view?.joined && view.role === 'owner') void api.invite().then((l) => setLink(l.link), (e: unknown) => setErr({ msg: tr('초대 링크를 못 만들었어요', "Couldn't make the invite link"), raw: String(e) })); }, [api, view?.joined, view?.role]);
  return (
    <BottomSheet label={tr('팀', 'Team')} title={tr('팀', 'Team')} onClose={onClose}>
      <div className="m-team-sheet">
        {view?.joined && (
          <div className="m-ts-row on"><TeamMarkIcon name={view.team} size={36} /><span className="tmx-tx"><b>{view.team}</b><span>{tr(`사람 ${view.members.length}`, `${view.members.length} people`)}</span></span><i className="m-ts-ck"><IconCheck /></i></div>
        )}
        {!view?.joined && (making
          ? <div className="m-ts-make"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('팀 이름', 'Team name')} aria-label={tr('팀 이름', 'Team name')} autoFocus />
              <button className="tmx-btn pri" disabled={!name.trim()} onClick={() => void api.create(name).then(() => { t.refresh(); onClose(); }, (e: unknown) => setErr({ msg: tr('팀을 못 만들었어요', "Couldn't create the team"), raw: String(e) }))}>{tr('만들기', 'Create')}</button></div>
          : <button className="m-ts-act" onClick={() => setMaking(true)}>{tr('팀 만들기', 'Make a team')}</button>)}
        {view?.joined && <button className="m-ts-act" onClick={onAgents}>{tr('팀 참모', 'Team agents')}</button>}
        {view?.joined && <span className="m-ts-sec">{tr(`${view.team} 초대 링크`, `${view.team} invite link`)}</span>}
        {view?.joined && view.role !== 'owner' && <span className="tmx-hint">{tr('초대 링크는 팀장 기기에서 만들어요', 'Only the team owner can make invite links')}</span>}
        {link && (
          <>
            <div className="tmx-lnk"><code>{link}</code>
              <IconBtn label={copied ? tr('복사했어요', 'Copied') : tr('복사', 'Copy')} onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true), () => {})}><IconCopy /></IconBtn>
              {'share' in navigator && <IconBtn label={tr('공유', 'Share')} onClick={() => void navigator.share({ text: link }).catch(() => {})}><IconShare /></IconBtn>}
            </div>
            <span className="tmx-hint">{tr('24시간 · 한 사람만 들어와요', '24 hours · one person can join')}</span>
          </>
        )}
        {err && <span className="tmx-hint" role="alert" title={err.raw}>{err.msg}</span>}
      </div>
    </BottomSheet>
  );
}
