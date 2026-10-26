// 팀 홈 = 팀 게시판(시안 team-space v1 H, 10-26 사용자 "추천대로") — 고정 공지 한 칸 + 글 목록 + 글쓰기 + 글 읽기.
// 글은 팀 보관함 봉투 길(kind post, Rust team_post) — 서버엔 평문 없음. 고정은 팀장만, 댓글 없이 '대화로'(팀챗 입력칸에 제목 한 줄)
import { useCallback, useEffect, useRef, useState } from 'react';
import { teamPostPin, teamPostRemove, teamPosts, teamPostWrite } from '../../data/teamPostApi';
import { teamProfileChanged } from '../../data/teamProfileApi';
import { personColor, stamp } from '../../domain/teamChat';
import { homeOf, postErr, quoteOf, type Post, type PostBoard } from '../../domain/teamPosts';
import { tr } from '../../i18n';
import { IconBack, IconChat, IconPencil, IconPin, IconPinOff, IconTrash } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { Confirm } from '../OrchDialogs';
import { every } from '../poll';
import { PersonOf, TeamMarkIcon } from './TeamFaces';
import { TeamDialog } from './TeamDialog';
import './team.css';

const SEEN_KEY = 'chammo.teamPostSeen';
const readSeen = (team: string) => { try { return new Set<string>((JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, string[]>)[team] ?? []); } catch { return new Set<string>(); } };
const keepSeen = (team: string, s: Set<string>) => { try { const all = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, string[]>; all[team] = [...s]; localStorage.setItem(SEEN_KEY, JSON.stringify(all)); } catch { /* 이번 실행만 */ } };

type Draft = { origin?: string; title: string; body: string; pin: boolean };

export function TeamHome({ teamId, team, members, icon, onTalk }: {
  teamId: string;
  team: string;
  members: { id: string; name: string }[];
  icon?: string;
  /** '대화로' — 팀챗 입력칸에 넣을 첫 줄 */
  onTalk: (text: string) => void;
}) {
  const [b, setB] = useState<PostBoard | null>(null);
  const [err, setErr] = useState('');
  const [seen, setSeen] = useState(() => readSeen(teamId));
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [rm, setRm] = useState<Post | null>(null);
  const rev = useRef(0);
  /** 읽는 중 — 3초 폴링이 읽는 중에 또 부르지 않게 */
  const busyLoad = useRef(false);
  const load = useCallback(() => {
    busyLoad.current = true;
    void teamPosts(teamId).then((x) => { if (x.team !== teamId) return; rev.current = x.rev; setB(x); setErr(''); }, (e: unknown) => setErr(postErr('read', String(e)))).finally(() => { busyLoad.current = false; });
  }, [teamId]);
  useEffect(() => {
    setB(null);
    setOpen(null);
    setSeen(readSeen(teamId));
    rev.current = 0;
    load();
    // 보관함 바뀜 알림(소켓 {t:"locker"})으로 판이 오르면 다시 — 프로필판과 같은 판 번호
    return every(() => { if (!busyLoad.current) void teamProfileChanged(teamId, rev.current).then((c) => { if (c) load(); }, () => {}); }, 3_000);
  }, [teamId, load]);

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? tr('나간 사람', 'Former member');
  const face = (id: string, size = 26) => <PersonOf member={id} name={nameOf(id)} color={personColor(nameOf(id))} size={size} />;
  const read = (p: Post) => {
    setOpen(p.id);
    if (!seen.has(p.id)) { const s = new Set(seen).add(p.id); setSeen(s); keepSeen(teamId, s); }
  };
  const run = (f: () => Promise<unknown>) => { setBusy(true); void f().then(() => load(), (e: unknown) => setErr(postErr('write', String(e)))).finally(() => setBusy(false)); };
  const save = () => {
    if (!draft || !draft.title.trim()) return;
    const d = draft;
    run(async () => {
      const id = await teamPostWrite(teamId, d.title, d.body, d.origin);
      if (b?.owner && d.pin !== (b.pinned === id)) await teamPostPin(teamId, d.pin ? id : '');
      setDraft(null);
    });
  };

  const h = b ? homeOf(b, seen) : null;
  const cur = open && b ? b.posts.find((x) => x.id === open) ?? null : null;
  const meta = (p: Post) => `${nameOf(p.by)} · ${stamp(p.created, Date.now())}${p.edited ? tr(' · 고침', ' · edited') : ''}`;

  return (
    <div className="lk-doc-body tmh">
      {cur ? (
        <article className="tmh-read">
          <div className="tmh-bar">
            <IconButton label={tr('글 목록', 'All posts')} onClick={() => setOpen(null)}><IconBack /></IconButton>
            <span className="tmh-sp" />
            {b?.owner && <IconButton label={b.pinned === cur.id ? tr('고정 풀기', 'Unpin') : tr('고정 공지로', 'Pin as notice')} disabled={busy}
              onClick={() => run(() => teamPostPin(teamId, b.pinned === cur.id ? '' : cur.id))}>{b.pinned === cur.id ? <IconPinOff /> : <IconPin />}</IconButton>}
            {cur.mine && <IconButton label={tr('고치기', 'Edit')} onClick={() => setDraft({ origin: cur.id, title: cur.title, body: cur.body, pin: b?.pinned === cur.id })}><IconPencil /></IconButton>}
            {(cur.mine || b?.owner) && <IconButton label={tr('지우기', 'Delete')} onClick={() => setRm(cur)}><IconTrash /></IconButton>}
            <IconButton label={tr('대화로 — 팀챗에서 이 글로 이야기', 'Talk about it in the team chat')} onClick={() => onTalk(quoteOf(cur))}><IconChat /></IconButton>
          </div>
          <h1>{cur.title}</h1>
          <div className="tmh-meta">{face(cur.by, 22)}<span>{meta(cur)}</span></div>
          <div className="tmh-body">{cur.body}</div>
        </article>
      ) : (
        <>
          <div className="tmh-head">
            <TeamMarkIcon name={team} size={28} img={icon} />
            <b>{team}</b><span>{tr(`${members.length}명`, `${members.length} people`)}</span>
            <span className="tmh-sp" />
            <IconButton tone="pri" label={tr('글쓰기', 'New post')} onClick={() => setDraft({ title: '', body: '', pin: false })}><IconPencil /></IconButton>
          </div>
          {err && <div className="tmh-err" role="alert">{err}</div>}
          {h?.pinned && (
            <button className="tmh-pin" onClick={() => read(h.pinned!)}>
              <span className="tmh-pin-h">{tr('고정 공지', 'Pinned notice')}</span>
              <b>{h.pinned.title}</b>
              <span className="tmh-pin-b">{h.pinned.body}</span>
              <span className="tmh-pin-m">{meta(h.pinned)}</span>
            </button>
          )}
          {h && h.list.length > 0 && (
            <div className="tmh-list">
              {h.list.map((p) => (
                <button key={p.id} className={`tmh-post ${h.unread.has(p.id) ? 'unread' : ''}`} onClick={() => read(p)}>
                  {face(p.by)}
                  <span className="tmh-tx"><b>{p.title}{h.unread.has(p.id) && <i className="tmh-new" aria-label={tr('안 읽음', 'Unread')} />}</b><span>{p.body.split('\n')[0]}</span></span>
                  <span className="tmh-at">{stamp(p.created, Date.now())}</span>
                </button>
              ))}
            </div>
          )}
          {b && !h?.pinned && !h?.list.length && <div className="tmh-empty">{tr('아직 글이 없어요', 'No posts yet')}</div>}
          {!b && !err && <div className="tmh-empty">{tr('글을 불러오는 중…', 'Loading posts…')}</div>}
        </>
      )}
      {draft && (
        <TeamDialog label={draft.origin ? tr('글 고치기', 'Edit post') : tr('글쓰기', 'New post')} onClose={() => !busy && setDraft(null)}>
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
        </TeamDialog>
      )}
      {rm && (
        <Confirm danger title={tr('글 지우기', 'Delete post')} body={tr(`'${rm.title}' 을(를) 팀 홈에서 지워요. 30일 동안 팀 보관함 휴지통에 남아요.`, `Removes '${rm.title}' from the team home. It stays in the team locker trash for 30 days.`)}
          ok={tr('지우기', 'Delete')} onCancel={() => setRm(null)} onOk={() => { const p = rm; setRm(null); setOpen(null); run(() => teamPostRemove(teamId, p.id)); }} />
      )}
    </div>
  );
}
