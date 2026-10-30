// 팀 홈 = 팀 게시판(시안 team-space v1 H) + 꾸민 판(ADR 0018 — 머리띠·타일 블록, 팀장이 꾸미고 완료 때 한 판).
// 글은 팀 보관함 봉투 길(kind post, Rust team_post) — 서버엔 평문 없음. 고정은 팀장만, 댓글 없이 '대화로'(팀챗 입력칸에 제목 한 줄).
// 고정 공지·글 목록은 판의 블록으로 그리고(판이 없으면 지금 그대로), 글 읽기·쓰기 창은 판과 상관없이 여기서
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { desktopHome, desktopSources, homeMemo } from '../../data/teamHomeApi';
import { desktopPosts } from '../../data/teamPostApi';
import type { AgentShown } from '../../domain/teamAgent';
import { postPlaces, type HomeApi, type HomeBlock, type HomeBoard as Board, type HomeSources } from '../../domain/teamHome';
import type { LockerItem } from '../../domain/teamLocker';
import { personColor, stamp } from '../../domain/teamChat';
import { homeOf, pinFailed, postErr, quoteOf, type Post, type PostApi, type PostBoard } from '../../domain/teamPosts';
import { keepBoard, lookOf } from '../../domain/teamProfile';
import { needFetch, teamViewMemo } from '../../domain/teamViewMemo';
import { tr } from '../../i18n';
import { IconBack, IconChat, IconPencil, IconPin, IconPinOff, IconTrash } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { Confirm } from '../OrchDialogs';
import { every } from '../poll';
import { DataBlock } from './HomeBlocks';
import { HomeBoard, type ModeChoice } from './HomeBoard';
import { PersonOf } from './TeamFaces';
import { TeamDialog } from './TeamDialog';
import { ProfilesCtx } from './useProfiles';
import './team.css';

const SEEN_KEY = 'chammo.teamPostSeen';
const readSeen = (team: string) => { try { return new Set<string>((JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, string[]>)[team] ?? []); } catch { return new Set<string>(); } };
const keepSeen = (team: string, s: Set<string>) => { try { const all = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, string[]>; all[team] = [...s]; localStorage.setItem(SEEN_KEY, JSON.stringify(all)); } catch { /* 이번 실행만 */ } };

/** 팀마다 마지막 글판 — 보관함 탭을 갔다 오면 화면이 내려가서, 없으면 다시 붙을 때마다 '불러오는 중'에 목록 전체를 다시 받았다(10-28 사용자).
 *  데스크톱·폰이 같은 TeamHome 이라 둘 다 이 창 메모리에만 */
const boardMemo = teamViewMemo<PostBoard>();

type Draft = { origin?: string; title: string; body: string; pin: boolean };
/** 글쓰기 겹창 — 데스크톱은 창 가운데 TeamDialog, 폰은 아래 시트(kit BottomSheet) */
export type HomeDialog = (p: { label: string; onClose: () => void; children: React.ReactNode }) => React.ReactNode;

export function TeamHome({ teamId, team, members, icon, onTalk, api = desktopPosts, Dialog = TeamDialog, homeApi = desktopHome, sources = desktopSources, phone, modeChoices, modeBlock, calBlock }: {
  teamId: string;
  team: string;
  members: { id: string; name: string }[];
  icon?: string;
  /** '대화로' — 팀챗 입력칸에 넣을 첫 줄. 없으면 그 단추를 안 그린다 */
  onTalk?: (text: string) => void;
  /** 글 길 — 기본 데스크톱(Tauri 명령), 폰은 맥 폰 서버 */
  api?: PostApi;
  Dialog?: HomeDialog;
  /** 판 길·블록 출처 — 기본 데스크톱, 폰은 맥 폰 서버 */
  homeApi?: HomeApi;
  sources?: HomeSources;
  phone?: boolean;
  /** 모드 칸(데스크톱만 — 이 기기 가벼운 모드). 없으면 모드 칸은 한 줄 안내 */
  modeChoices?: ModeChoice[];
  modeBlock?: (b: HomeBlock, editing: boolean) => React.ReactNode;
  /** 팀 캘린더 칸(relay ADR 0011) — 데스크톱·폰이 각자 길로 */
  calBlock?: (b: HomeBlock, editing: boolean) => React.ReactNode;
}) {
  const [b, setB] = useState<PostBoard | null>(null);
  const [err, setErr] = useState('');
  const [seen, setSeen] = useState(() => readSeen(teamId));
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [rm, setRm] = useState<Post | null>(null);
  const rev = useRef(0);
  /** 지금 문구가 읽기 실패인가 — 다시 읽기가 되면 읽기 실패만 지운다(쓰기 실패 문구는 다시 읽어도 남긴다) */
  const readErr = useRef(false);
  /** 읽는 중 — 3초 폴링이 읽는 중에 또 부르지 않게 */
  const busyLoad = useRef(false);
  /** seen = 본 판(null = 꼭 새로) — 그대로면 아무것도 안 바꾼다. 읽기 실패는 아는 글판 둔 채 문구만 */
  const load = useCallback((seen: number | null) => {
    busyLoad.current = true;
    void api.board(teamId, seen).then((x) => {
      const n = keepBoard<PostBoard>(null, x, teamId);
      if (!n) return;
      boardMemo.put(teamId, n);
      rev.current = n.rev;
      setB(n);
      if (readErr.current) { readErr.current = false; setErr(''); }
    }, (e: unknown) => { if (seen === null) { readErr.current = true; setErr(postErr('read', String(e))); } }).finally(() => { busyLoad.current = false; });
  }, [teamId, api]);
  // 다시 붙으면 기억한 글판을 바로 — 기억이 있고 오래되지 않았으면 본 판을 들고 묻는다(그대로면 망 없음)
  useEffect(() => {
    const m = boardMemo.get(teamId);
    setB(m?.v ?? null);
    setOpen(null);
    setSeen(readSeen(teamId));
    rev.current = m?.v.rev ?? 0;
    load(m && !needFetch(m, 0) ? m.v.rev : null);
    // 보관함 바뀜 알림(소켓 {t:"locker"})으로 판이 오르면 다시 — 프로필판과 같은 판 번호
    return every(() => { if (!busyLoad.current) load(rev.current); }, 3_000);
  }, [teamId, load]);

  // 판 — 글판과 같은 판 번호(보관함 바뀜)로 다시 읽는다. 읽기 실패는 판 없이 글 목록 그대로(문구는 글판 몫)
  const [hb, setHb] = useState<Board | null>(null);
  const hrev = useRef(0);
  const busyHome = useRef(false);
  const loadHome = useCallback((seen: number | null) => {
    busyHome.current = true;
    void homeApi.board(teamId, seen).then((x) => {
      const n = keepBoard<Board>(null, x, teamId);
      if (!n) return;
      homeMemo.put(teamId, n);
      hrev.current = n.rev;
      setHb(n);
    }, () => {}).finally(() => { busyHome.current = false; });
  }, [teamId, homeApi]);
  useEffect(() => {
    const m = homeMemo.get(teamId);
    setHb(m?.v ?? null);
    hrev.current = m?.v.rev ?? 0;
    loadHome(m && !needFetch(m, 0) ? m.v.rev : null);
    return every(() => { if (!busyHome.current) loadHome(hrev.current); }, 3_000);
  }, [teamId, loadHome]);
  // 블록이 읽는 것 — 그 블록이 판에 있을 때만, 보관함 판이 오르면 다시
  const [agents, setAgents] = useState<AgentShown[]>([]);
  const [files, setFiles] = useState<LockerItem[]>([]);
  const kinds = new Set(hb?.home?.blocks.map((x) => x.k) ?? []);
  const wantAgents = kinds.has('agents');
  const wantFiles = kinds.has('files');
  const filesRev = useRef(-1);
  useEffect(() => { if (wantAgents) void sources.agents(teamId).then(setAgents, () => {}); }, [teamId, wantAgents, hb?.rev, sources]);
  useEffect(() => {
    if (!wantFiles) return;
    const fresh = filesRev.current >= 0;
    filesRev.current = hb?.rev ?? 0;
    void sources.files(teamId, fresh).then(setFiles, () => {});
  }, [teamId, wantFiles, hb?.rev, sources]);

  // 글쓴이 = 프로필 별명(목록·대화와 같은 lookOf, 없으면 명부 이름). 색은 명부 이름 — 별명을 바꿔도 사람 색은 그대로
  const { board } = useContext(ProfilesCtx);
  const roster = (id: string) => members.find((m) => m.id === id)?.name ?? tr('나간 사람', 'Former member');
  const nameOf = (id: string) => lookOf(board, id, roster(id)).name;
  const face = (id: string, size = 26) => <PersonOf member={id} name={roster(id)} color={personColor(roster(id))} size={size} />;
  const read = (p: Post) => {
    setOpen(p.id);
    if (!seen.has(p.id)) { const s = new Set(seen).add(p.id); setSeen(s); keepSeen(teamId, s); }
  };
  // 실패해도 다시 읽는다 — 폰은 글이 올라가고 고정만 실패할 수 있다
  const run = (f: () => Promise<unknown>) => {
    setBusy(true);
    void f().then(() => { readErr.current = false; setErr(''); load(null); }, (e: unknown) => { readErr.current = false; setErr(postErr('write', String(e))); load(null); }).finally(() => setBusy(false));
  };
  const save = () => {
    if (!draft || !draft.title.trim()) return;
    const d = draft;
    run(async () => {
      let id: string;
      try {
        id = await api.write(teamId, d.title, d.body, d.origin, d.pin);
      } catch (e) {
        // 글은 올라가고 고정만 실패 — 창을 닫는다(열어 두면 다시 눌러 같은 글이 또 올라간다)
        if (pinFailed(String(e)) !== null) setDraft(null);
        throw e;
      }
      setDraft(null);
      if (api.pin && b?.owner && d.pin !== (b.pinned === id)) await api.pin(teamId, d.pin ? id : '');
    });
  };

  const h = b ? homeOf(b, seen) : null;
  const places = postPlaces(hb?.home ?? null);
  const shown = h ? (places.pinInList && h.pinned ? [h.pinned, ...h.list] : h.list) : [];
  const cur = open && b ? b.posts.find((x) => x.id === open) ?? null : null;
  const meta = (p: Post) => `${nameOf(p.by)} · ${stamp(p.created, Date.now())}${p.edited ? tr(' · 고침', ' · edited') : ''}`;

  const pinBox = h?.pinned ? (
    <button className="hb-pinbtn" onClick={() => read(h.pinned!)}>
      <span className="hb-ph">{tr('고정 공지', 'Pinned notice')}</span>
      <b>{h.pinned.title}</b>
      <span className="hb-pb">{h.pinned.body}</span>
      <span className="hb-pm">{meta(h.pinned)}</span>
    </button>
  ) : null;
  const list = h && shown.length > 0 ? (
    <div className="tmh-list">
      {shown.map((p) => (
        <button key={p.id} className={`tmh-post ${h.unread.has(p.id) ? 'unread' : ''}`} onClick={() => read(p)}>
          {face(p.by)}
          <span className="tmh-tx"><b>{p.title}{h.unread.has(p.id) && <i className="tmh-new" aria-label={tr('안 읽음', 'Unread')} />}</b><span>{p.body.split('\n')[0]}</span></span>
          <span className="tmh-at">{stamp(p.created, Date.now())}</span>
        </button>
      ))}
    </div>
  ) : null;
  const postState = !b && !err ? tr('글을 불러오는 중…', 'Loading posts…') : b && !h?.pinned && !h?.list.length ? tr('아직 글이 없어요', 'No posts yet') : '';
  // 판이 없을 때 — 지금 팀 홈 그대로(공지 칸 + 글 목록)
  const postList = (
    <>
      {pinBox && <div className="hb-b pin" style={{ marginBottom: 14 }}>{pinBox}</div>}
      {list}
      {postState && <div className="tmh-empty">{postState}</div>}
    </>
  );
  const data = { members, agents, files, content: hb?.content ?? {}, onTalk, openUrl: sources.openUrl, nameOf,
    openFile: sources.openFile ? (i: LockerItem) => sources.openFile!(teamId, i) : undefined,
    saveContent: (block: string, c: Parameters<HomeApi['content']>[2]) => homeApi.content(teamId, block, c).then(() => loadHome(null)) };
  const block = (x: HomeBlock, editing: boolean): React.ReactNode => {
    if (x.k === 'pin') return pinBox && !editing ? pinBox : <div className="hb-ph"><IconPin />{tr('고정 공지', 'Pinned notice')}{!editing && <span className="hb-s2">{tr(' · 팀장이 글을 고정하면 여기에', ' · Shows the post the owner pins')}</span>}</div>;
    if (x.k === 'posts') return <><div className="hb-bh">{tr('글', 'Posts')}</div>{editing ? null : list ?? (postState && <div className="tmh-empty">{postState}</div>)}</>;
    if (x.k === 'cal') return calBlock ? calBlock(x, editing) : <><div className="hb-bh">{tr('팀 캘린더', 'Team calendar')}</div><div className="hb-none">{tr('캘린더 탭에서 봐요', 'Open the calendar tab')}</div></>;
    if (x.k === 'mode') return modeBlock ? modeBlock(x, editing) : <><div className="hb-bh">{tr('참모 모드', 'Chammo mode')}</div><div className="hb-none">{tr('모드 칸은 맥 앱에서 보여요', 'Mode blocks show in the Mac app')}</div></>;
    return <DataBlock b={x} d={data} editing={editing} />;
  };

  return (
    <div className={`lk-doc-body tmh ${cur ? '' : 'hbw'}`}>
      {cur ? (
        <article className="tmh-read">
          <div className="tmh-bar">
            <IconButton label={tr('글 목록', 'All posts')} onClick={() => setOpen(null)}><IconBack /></IconButton>
            <span className="tmh-sp" />
            {api.pin && b?.owner && <IconButton label={b.pinned === cur.id ? tr('고정 풀기', 'Unpin') : tr('고정 공지로', 'Pin as notice')} disabled={busy}
              onClick={() => run(() => api.pin!(teamId, b.pinned === cur.id ? '' : cur.id))}>{b.pinned === cur.id ? <IconPinOff /> : <IconPin />}</IconButton>}
            {api.edit && cur.mine && <IconButton label={tr('고치기', 'Edit')} onClick={() => setDraft({ origin: cur.id, title: cur.title, body: cur.body, pin: b?.pinned === cur.id })}><IconPencil /></IconButton>}
            {api.remove && (cur.mine || b?.owner) && <IconButton label={tr('지우기', 'Delete')} onClick={() => setRm(cur)}><IconTrash /></IconButton>}
            {onTalk && <IconButton label={tr('대화로 — 팀챗에서 이 글로 이야기', 'Talk about it in the team chat')} onClick={() => onTalk(quoteOf(cur))}><IconChat /></IconButton>}
          </div>
          <h1>{cur.title}</h1>
          <div className="tmh-meta">{face(cur.by, 22)}<span>{meta(cur)}</span></div>
          <div className="tmh-body">{cur.body}</div>
        </article>
      ) : (
        <HomeBoard teamId={teamId} team={team} icon={icon} people={members.length} board={hb} phone={phone} api={homeApi} modeChoices={modeChoices}
          nameOf={nameOf} onWrite={() => setDraft({ title: '', body: '', pin: false })} onSaved={() => loadHome(null)} Dialog={Dialog}
          renderBlock={(x, editing) => block(x, editing)}
          below={places.listBelow && list ? <><div className="hb-bh">{tr('글', 'Posts')}</div>{list}</> : null}
          fallback={<>{err && <div className="tmh-err" role="alert">{err}</div>}{postList}</>} />
      )}
      {draft && (
        <Dialog label={draft.origin ? tr('글 고치기', 'Edit post') : tr('글쓰기', 'New post')} onClose={() => !busy && setDraft(null)}>
          <div className="tmh-compose">
            <input className="tmh-title" autoFocus placeholder={tr('제목', 'Title')} maxLength={120} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <textarea className="tmh-text" placeholder={tr('팀에 알릴 내용', 'What the team should know')} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            <div className="tmh-foot">
              {b?.owner && <label className="tmp-sw tmh-sw"><span>{tr('고정 공지', 'Pinned notice')}</span>
                <input type="checkbox" role="switch" checked={draft.pin} onChange={(e) => setDraft({ ...draft, pin: e.target.checked })} /></label>}
              <span className="tmh-sp" />
              <button className="tmx-btn" disabled={busy} onClick={() => setDraft(null)}>{tr('취소', 'Cancel')}</button>
              {/* 팀 모두에게 바로 보이는 일이라 글자 단추 */}
              <button className="tmx-btn pri" disabled={busy || !draft.title.trim()} onClick={save}>{draft.origin ? tr('고친 글 올리기', 'Save changes') : tr('올리기', 'Post')}</button>
            </div>
            {err && <div className="tmh-err" role="alert">{err}</div>}
          </div>
        </Dialog>
      )}
      {rm && (
        <Confirm danger title={tr('글 지우기', 'Delete post')} body={tr(`'${rm.title}' 을(를) 팀 홈에서 지워요. 30일 동안 팀 보관함 휴지통에 남아요.`, `Removes '${rm.title}' from the team home. It stays in the team locker trash for 30 days.`)}
          ok={tr('지우기', 'Delete')} onCancel={() => setRm(null)} onOk={() => { const p = rm; setRm(null); setOpen(null); if (api.remove) run(() => api.remove!(teamId, p.id)); }} />
      )}
    </div>
  );
}
