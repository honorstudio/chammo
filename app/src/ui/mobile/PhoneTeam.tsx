// 폰 팀 탭(시안 v2 C) — 맨 아래 탭바 참모 | 팀 중 팀. 위 팀 이름(꺾쇠) → 시트(팀 바꾸기·만들기·초대 링크), 그 아래 대화 | 보관함.
// 대화를 누르면 화면 전체가 그 대화(데스크톱과 같은 대화 칸 — 풍선 = 사람, 얼굴 + 맨 글 = 참모). 보내기는 사람 말(이 칸의 진짜 누름 뒤 1.5초)
// 읽기·쓰기는 TeamPhoneApi 하나로만 — 지금은 맥 폰 서버(/api/team*), 중계 직결이 생기면 그것만 바꾼다
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readLocker, type TeamPhoneApi } from '../../data/web';
import type { TeamFeed } from '../../data/teamApi';
import { sendAllowed } from '../../domain/remoteChat';
import { convos as buildConvos, roomConvos, markRead, unreadTotal, type Convo, type TeamItem } from '../../domain/teamChat';
import type { LockerItem } from '../../domain/locker';
import { IconCheck, IconChevronDown, IconCopy, IconShare } from '../Icons';
import { TeamConvo } from '../team/TeamConvo';
import { TeamMarkIcon } from '../team/TeamFaces';
import { TeamList } from '../team/TeamList';
import { BottomSheet } from './BottomSheet';
import { IconBtn } from './kit';
import { machine } from '../../i18n';
import '../team/team.css';

const READ_KEY = 'm.teamRead';
const HANDED_KEY = 'm.teamHanded';
const load = <T,>(k: string, d: T): T => { try { return (JSON.parse(localStorage.getItem(k) ?? '') as T) ?? d; } catch { return d; } };
const keep = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 이번만 */ } };

/** 팀 읽기 — 팀 탭을 보는 동안 4초, 아니면 30초(탭바 안 읽은 수만) */
export function usePhoneTeam(api: TeamPhoneApi, active: boolean) {
  const [feed, setFeed] = useState<TeamFeed | null>(null);
  const [read, setRead] = useState<Record<string, number>>(() => load(READ_KEY, {}));
  const refresh = useCallback(() => void api.feed().then(setFeed, () => {}), [api]);
  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, active ? 4000 : 30_000);
    return () => window.clearInterval(t);
  }, [refresh, active]);
  const view = feed?.view?.joined ? feed.view : null;
  const cs = useMemo(() => (view ? buildConvos(view.members, view.rooms, feed?.items ?? [], read) : []), [view, feed, read]);
  // 단톡방(보내기는 /api/team-say 의 room:<id> 주소) — 만들기·바꾸기는 데스크톱·참모에서
  const rs = useMemo(() => (view ? roomConvos(view.rooms, feed?.items ?? [], read) : []), [view, feed, read]);
  const markRoom = (room: string) => setRead((r) => { const n = markRead(r, room, feed?.items ?? []); if (n !== r) keep(READ_KEY, n); return n; });
  return { feed, cs, rs, unread: unreadTotal([...rs, ...cs]), refresh, markRoom };
}

/** open = 팀 메시지 알림을 눌러 왔다 — 그 방 대화를 연다(대화 목록이 아직 없으면 받은 뒤에) */
export function PhoneTeam({ api, t, orch, open }: { api: TeamPhoneApi; t: ReturnType<typeof usePhoneTeam>; orch: { id: string; name: string }; open?: { n: number; room: string } | null }) {
  const view = t.feed?.view ?? null;
  const [seg, setSeg] = useState<'chat' | 'locker'>('chat');
  const [sel, setSel] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
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
  const cur = [...t.rs, ...t.cs].find((c) => c.key === sel) ?? null;
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
  const say = (to: string, text: string, at: number) => (sendAllowed(at, Date.now()) && text.trim() ? api.say(to, text, cidFor(to, text)) : null);
  if (cur && view && t.feed) {
    return (
      <div className="m-team m-team-convo">
        <TeamConvo convo={cur} items={t.feed.items} team={view.team} myName={view.me} handed={handed} focused onRead={t.markRoom} onSent={t.refresh} safety={t.feed.safety} held={t.feed.held} phone members={view.members}
          onHanded={(it: TeamItem, to: string) => setHanded((h) => { const n = { ...h, [`${it.room}:${it.seq}`]: to }; keep(HANDED_KEY, n); return n; })}
          handoff={{ name: orch.name.split(' · ').pop() || orch.name, send: (text) => api.handoff(orch.id, text).then(() => {}) }} say={say} viewing={() => {}} back={() => setSel(null)} />
      </div>
    );
  }
  return (
    <div className="m-team">
      <header className="m-team-head">
        <button className="m-team-switch" onClick={() => setSheet(true)} aria-label="팀 바꾸기·만들기·초대">
          {view?.joined ? <><TeamMarkIcon name={view.team} size={30} /><b>{view.team}</b></> : <b>팀</b>}
          <IconChevronDown />
        </button>
      </header>
      {view?.joined && (
        <div className="m-seg" role="tablist">
          <button role="tab" aria-selected={seg === 'chat'} className={seg === 'chat' ? 'on' : ''} onClick={() => setSeg('chat')}>대화</button>
          <button role="tab" aria-selected={seg === 'locker'} className={seg === 'locker' ? 'on' : ''} onClick={() => setSeg('locker')}>보관함</button>
        </div>
      )}
      <div className="m-team-body">
        {!view?.joined ? <div className="tmx-none">{`아직 팀이 없어요 — 위 팀 이름을 눌러 만들거나, ${machine()} 설정 > 계정에서 Chammo 계정에 로그인해요`}</div>
          : seg === 'chat' ? <div className="tmx-list"><TeamList convos={t.cs} rooms={t.rs} sel={null} onPick={(c: Convo) => setSel(c.key)} /></div>
          : <PhoneTeamLocker teamId={view.teamId} />}
      </div>
      {sheet && <TeamSheet api={api} t={t} onClose={() => setSheet(false)} />}
    </div>
  );
}

/** 팀 보관함 — 맥 보관함의 그 팀 폴더(폰 서버가 거른 것만) */
function PhoneTeamLocker({ teamId }: { teamId: string }) {
  const [items, setItems] = useState<LockerItem[] | null>(null);
  // 팀 폴더는 주인 id(team-<팀 id>, 데스크톱 TeamLocker teamOwner)로 — 이름으로 고르면 같은 이름의 참모 폴더가 섞였다(보안 검토 10-23)
  useEffect(() => {
    void readLocker().then((v) => {
      const name = Object.entries(v.ids ?? {}).find(([, id]) => id === `team-${teamId}`)?.[0];
      setItems(name ? v.items.filter((i) => i.owner === name) : []);
    }, () => setItems([]));
  }, [teamId]);
  if (!items) return null;
  if (!items.length) return <div className="tmx-none">팀 보관함이 비었어요</div>;
  return (
    <div className="tmx-lk-rows m-team-lk">
      {items.map((i) => {
        const name = i.name || i.path.split('/').pop() || '';
        const ext = name.includes('.') ? name.split('.').pop()!.slice(0, 4) : '파일';
        return <div key={i.path} className="tmx-lk-row"><span className="tmx-ext">{ext}</span><b>{name}</b><span className="d">{i.rel?.includes('/') ? i.rel.split('/')[0] : ''}</span></div>;
      })}
    </div>
  );
}

/** 팀 시트 — 팀 바꾸기(지금은 팀 하나)·팀 만들기·초대 링크(팀장만) */
function TeamSheet({ api, t, onClose }: { api: TeamPhoneApi; t: ReturnType<typeof usePhoneTeam>; onClose: () => void }) {
  const view = t.feed?.view ?? null;
  const [link, setLink] = useState<string | null>(null);
  /** 실패 — 화면엔 한국어 한 줄(msg), 원문은 이름표(raw) */
  const [err, setErr] = useState<{ msg: string; raw: string } | null>(null);
  const [making, setMaking] = useState(false);
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (view?.joined && view.role === 'owner') void api.invite().then((l) => setLink(l.link), (e: unknown) => setErr({ msg: '초대 링크를 못 만들었어요', raw: String(e) })); }, [api, view?.joined, view?.role]);
  return (
    <BottomSheet label="팀" title="팀" onClose={onClose}>
      <div className="m-team-sheet">
        {view?.joined && (
          <div className="m-ts-row on"><TeamMarkIcon name={view.team} size={36} /><span className="tmx-tx"><b>{view.team}</b><span>사람 {view.members.length}</span></span><i className="m-ts-ck"><IconCheck /></i></div>
        )}
        {!view?.joined && (making
          ? <div className="m-ts-make"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="팀 이름" aria-label="팀 이름" autoFocus />
              <button className="tmx-btn pri" disabled={!name.trim()} onClick={() => void api.create(name).then(() => { t.refresh(); onClose(); }, (e: unknown) => setErr({ msg: '팀을 못 만들었어요', raw: String(e) }))}>만들기</button></div>
          : <button className="m-ts-act" onClick={() => setMaking(true)}>팀 만들기</button>)}
        {view?.joined && <span className="m-ts-sec">{view.team} 초대 링크</span>}
        {view?.joined && view.role !== 'owner' && <span className="tmx-hint">초대 링크는 팀장 기기에서 만들어요</span>}
        {link && (
          <>
            <div className="tmx-lnk"><code>{link}</code>
              <IconBtn label={copied ? '복사했어요' : '복사'} onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true), () => {})}><IconCopy /></IconBtn>
              {'share' in navigator && <IconBtn label="공유" onClick={() => void navigator.share({ text: link }).catch(() => {})}><IconShare /></IconBtn>}
            </div>
            <span className="tmx-hint">24시간 · 한 사람만 들어와요</span>
          </>
        )}
        {err && <span className="tmx-hint" role="alert" title={err.raw}>{err.msg}</span>}
      </div>
    </BottomSheet>
  );
}
