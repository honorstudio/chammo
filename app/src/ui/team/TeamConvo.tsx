// 메신저 대화 칸 — 앱 안 가운데 칸·메신저 따로 창·대화 하나 창이 같이 쓴다(시안 v2).
// 모양: 풍선 = 사람(내 말은 오른쪽), 얼굴 + 맨 글 = 참모(남의 참모는 '하린의 참모' 꼬리표). 남의 말 위에 올리면 '내 참모에게' → 카드로 넘긴다.
// 보내기는 사람 말(team_human_say) — 이 칸 안의 진짜(isTrusted) 키·클릭 뒤 1.5초 안만(HUMAN_POSTS 와 같은 문, teamApi)
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { forgetTeamThumb, teamClipFiles, teamFileAttach, teamFileOpen, teamFileSave, teamFileThumb, teamHumanSay, teamPickFiles, teamViewing, type HeldMsg, type SayExtra } from '../../data/teamApi';
import { rekeyNotices, rekeyText, slotNotices, type SafetyPerson } from '../../domain/e2eSafety';
import { SafetyPanel } from '../e2e/Safety';
import '../e2e/e2e.css';
import { toMineText, unseenCount, atQuery, dayLabel, pasteName, pasteTakes, handoffText, lineOf, mentionList, mentionParts, mentionsMe, personColor, reactionsOf, roomItems, sayTarget, stamp, withMyReacts, type Convo, type MentionPick, type Reaction, type TeamFile, type TeamItem } from '../../domain/teamChat';
import { tr } from '../../i18n';
import { IconBack, IconChevronDown, IconChevronUp, IconClose, IconEnter, IconFolder, IconPencil, IconPlus, IconWindowOut } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { JumpBottom } from '../kit/JumpBottom';
import { farFromBottom, keepTop, nearBottom, stickBottom } from '../../domain/mobile';
import { ContextMenu, type MenuItem } from '../OrchDialogs';
import { openTeamFile } from './openTeamFile';
import { openWebLink } from '../followLink';
import { mdToHtmlTeam } from '../md';
import { Face, PersonOf, TeamMarkIcon } from './TeamFaces';
import { dndNotice, lookOf, statusLine } from '../../domain/teamProfile';
import { echoOfSent, enterAction } from '../../domain/enterSend';
import { clickFocusesInput } from '../../domain/chat';
import type { draftStore } from '../../domain/chatDraft';
import { teamDrafts } from '../../data/drafts';
import { ProfilesCtx } from './useProfiles';
import './profile.css';
import { Attachments, FileBubbles, HelperFace, MentionMenu, MentionText, ReactAdd, Reacts } from './RoomBits';
import { TEAM_DROP_EVENT } from './teamDrop';
import { giveIds, giveMenu, useRoster } from './teamGive';
import { OrchPickList, rememberPick } from './OrchPick';
import type { RosterOrch } from '../../domain/teamGive';
import { readersAt, roomPeople, unreadCounts, type Reads } from '../../domain/teamReads';
import './team.css';
import { teamAgentConfirm, teamAgents, teamAgentsCached, teamAgentUsage } from '../../data/teamAgentApi';
import { calledAgent, foldLong, modelLabel, needsConfirm, tokensLabel, type AgentList } from '../../domain/teamAgent';
import { AgentConfirm, AgentFace } from './TeamAgents';

/** 이 말을 아직 안 읽은 사람 수(카톡처럼) — 0 이면 안 그린다 */
const ReadLeft = ({ n }: { n: number }) => (n > 0 ? <b className="tmx-rd" title={tr(`안 읽은 사람 ${n}`, `${n} not read yet`)} aria-label={tr(`안 읽은 사람 ${n}`, `${n} not read yet`)}>{n}</b> : null);

type Att = { key: string; name: string; size?: number; busy?: boolean; err?: string; ref?: TeamFile };

// 참모 말 마크다운 → HTML 은 한 번 바꾼 걸 기억한다 — 팀 피드를 다시 읽을 때마다 말 수십 개를 다시 바꾸지 않게(참모 채팅 mdCache 와 같은 까닭)
const mdCache = new Map<string, string>();
const agentHtml = (text: string, names: string[], myName: string, newTab: boolean) => {
  const key = `${newTab ? 1 : 0}\u0000${myName}\u0000${names.join('\u0001')}\u0000${text}`;
  const hit = mdCache.get(key);
  if (hit !== undefined) return hit;
  const html = mdToHtmlTeam(text, { newTab, mention: (s) => mentionParts(s, names, myName) });
  if (mdCache.size > 1000) mdCache.clear();
  mdCache.set(key, html);
  return html;
};
// 말 누르기(폰 '내 참모에게' 고르기)는 그 말 속 링크를 누를 땐 안 한다
const onLinkEl = (e: React.MouseEvent) => !!(e.target as HTMLElement).closest('a');

/** 내 참모에게 — name = 고르기 목록이 없을 때(폰) 넘길 참모, send(글, 고른 참모 세션 id) — 길은 Rust team_handoff 하나 */
export type Handoff = { name: string; send: (text: string, to?: string) => Promise<void> };

export function TeamConvo({ convo, items, team, myName, handed, onRead, onHanded, onSent, handoff, detach, onFiles, focused = true, say = teamHumanSay, viewing = teamViewing, back, safety, held, phone, people, onEditRoom, seed = '', onSeeded, teamId = '', members = [], reads, drafts = teamDrafts, files = { attach: teamFileAttach, open: teamFileOpen, save: teamFileSave, pick: teamPickFiles, clip: teamClipFiles }, thumb = teamFileThumb, agentsApi = { cached: teamAgentsCached, fresh: teamAgents, confirm: teamAgentConfirm, usage: teamAgentUsage } }: {
  convo: Convo;
  items: TeamItem[];
  team: string;
  myName: string;
  handed: Record<string, string>;
  onRead: (room: string) => void;
  onHanded: (it: TeamItem, to: string) => void;
  onSent: () => void;
  /** 내 참모(지금 채팅 칸 참모)에게 넘기기 — 없으면 '내 참모에게'가 안 보인다 */
  handoff?: Handoff;
  /** 이 대화를 따로 창으로(모니터가 둘 이상일 때만 준다) */
  detach?: () => void;
  /** 이 대화 파일 보기 — 스페이스에 그 방에 붙인 파일 목록(팀 보관함엔 안 섞는다, 10-28 사용자). 방이 있을 때만 */
  onFiles?: () => void;
  /** 이 창이 앞에 있나 — 앞일 때만 읽음 처리 */
  focused?: boolean;
  /** 읽음 자리(feed.reads) — 말마다 안 읽은 사람 수(카톡처럼). 없으면 숫자 없음 */
  reads?: Reads;
  /** 쓰던 글 — 대화마다(데스크톱 <데이터>/drafts.json, 폰은 메모리). 보내면 비운다 */
  drafts?: Pick<ReturnType<typeof draftStore>, 'load' | 'save'>;
  /** 보내기 길 — 데스크톱은 team_human_say, 폰은 맥 폰 서버(/api/team-say). 둘 다 진짜 키·클릭 뒤 1.5초 안만(null = 문 밖) */
  say?: (to: string, text: string, trustedAt: number, extra?: SayExtra) => Promise<unknown> | null;
  /** 지금 보는 대화를 알리는 길(데스크톱 알림 판단) — 폰은 없음 */
  viewing?: (room: string) => void;
  /** 폰 — 머리 맨 앞 뒤로 */
  back?: () => void;
  /** 보안 번호 사람 상태(team_feed safety) — 상대가 바뀜·갈림이면 대화 위 알림(시안 e2e-safety v1) */
  safety?: SafetyPerson[];
  /** 보안 번호가 바뀌어 멈춘 말(team_feed held) — 받아들이면 보낸다 */
  held?: HeldMsg[];
  /** 폰 웹 — 보안 번호 패널은 보기만(받아들이기는 폰 결정 대기함 카드) */
  phone?: boolean;
  /** 단톡방 사람 이름(멤버 id → 이름) — 방 머리 얼굴 묶음 */
  people?: Record<string, string>;
  /** 단톡방 이름·사람 바꾸기 */
  onEditRoom?: () => void;
  /** 입력칸 첫 글(팀 홈 글 '대화로' — key 가 바뀔 때만 다시 읽는다) */
  seed?: string;
  /** 첫 글(seed)을 입력칸에 넣었다 — 부른 쪽이 비워 다시 그릴 때 또 안 들어가게 */
  onSeeded?: () => void;
  /** 팀 id — 파일 붙이기(팀 보관함) */
  teamId?: string;
  /** 팀 사람(부르기 목록·이름 칩) — 단톡방은 방 사람만, DM 은 상대만 목록에 */
  members?: { id: string; name: string; me: boolean }[];
  /** 파일 길(팀 보관함 명령) — 시험이 바꿔 끼운다 */
  files?: { attach: typeof teamFileAttach; open: typeof teamFileOpen; save: typeof teamFileSave; pick: typeof teamPickFiles; clip: typeof teamClipFiles };
  /** 말풍선 썸네일 주소 — 데스크톱은 풀어 둔 그림·PDF 첫 장, 폰은 맥이 줄인 JPEG(teamThumbBlob). 못 그리면 null */
  thumb?: (team: string, id: string, name: string, size: number) => Promise<string | null>;
  /** 팀 참모(ADR 0017) 길 — 시험·폰이 바꿔 끼운다. 폰은 아직 없음(null) */
  agentsApi?: { cached: typeof teamAgentsCached; fresh: typeof teamAgents; confirm: typeof teamAgentConfirm; usage: typeof teamAgentUsage } | null;
}) {
  const group = convo.kind === 'group';
  const { board } = useContext(ProfilesCtx);
  // 반응·파일은 데스크톱만(폰 /api/team-say 는 글만)
  const rich = !phone;
  const got = useMemo(() => (convo.room ? reactionsOf(items, convo.room) : new Map<number, Reaction[]>()), [items, convo.room]);
  // 보낸 뒤 서버 답을 기다리는 내 반응 — 누르자마자 얹고(withMyReacts), 받은 목록이 따라잡으면 뗀다. 실패하면 떼고 알린다
  const [pendReact, setPendReact] = useState<{ seq: number; mark: string; on: boolean }[]>([]);
  const reacts = useMemo(() => withMyReacts(got, pendReact, myName), [got, pendReact, myName]);
  useEffect(() => { setPendReact((x) => { const n = x.filter((p) => !!got.get(p.seq)?.find((r) => r.mark === p.mark)?.mine !== p.on); return n.length === x.length ? x : n; }); }, [got]);
  const names = useMemo(() => members.map((m) => m.name), [members]);
  // 팀 참모 — 마지막 목록(망 없이) 먼저, 뒤에서 새로 받는다. 부르기 메뉴·말풍선 얼굴·보내기 전 확인 장이 같이 쓴다
  const [agents, setAgents] = useState<AgentList | null>(null);
  useEffect(() => {
    if (!agentsApi || !teamId) return;
    let live = true;
    void agentsApi.cached(teamId).then((l) => { if (live) setAgents((x) => x ?? l); }, () => {});
    void agentsApi.fresh(teamId).then((l) => { if (live) setAgents(l); }, () => {});
    return () => { live = false; };
  }, [teamId, agentsApi]);
  const forMention = useMemo(() => (agents?.agents ?? []).map((a) => ({ id: a.id, name: a.def.name, blurb: a.def.blurb, model: modelLabel(a.def.model), color: a.def.color, clash: a.clash })), [agents]);
  // 이어 묻기 — 고른 팀 참모 답(seq·이름). 보낼 때 글에 그 이름 멘션이 남아 있으면 re 로 싣는다
  const [follow, setFollow] = useState<{ seq: number; name: string } | null>(null);
  // 보내기 전 확인 장(처음·바뀐 판) — 확인하면 보낸다
  const [confirming, setConfirming] = useState<{ id: string; t: string } | null>(null);
  // 펼친 긴 답(seq)
  const [unfold, setUnfold] = useState<Record<number, boolean>>({});
  // 이 기기에서 부른 팀 참모 답의 토큰(seq → [모델, 토큰]) — 부른 사람 화면에만
  const [usage, setUsage] = useState<Record<string, [string, number]>>({});
  const callable = useMemo(() => members.filter((m) => (group ? (convo.members ?? []).includes(m.id) : m.id === convo.peer || m.me)), [members, group, convo.members, convo.peer]);
  const [atts, setAtts] = useState<Att[]>([]);
  const [dropOver, setDropOver] = useState(false);
  const [menu, setMenu] = useState<{ start: number; q: string; sel: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // 내 참모(이 맥 참모 목록 — 메인 창이 내놓은 것, 폰엔 없다). @ 메뉴 '내 참모'·넘기기 고르기가 같이 쓴다
  const roster = useRoster();
  const mine = handoff ? roster : [];
  const picks: MentionPick[] = menu ? mentionList(menu.q, callable, mine, forMention).slice(0, 10) : [];
  // @ 메뉴에서 고른 내 참모 — 보낼 때 글에 '@별명'이 남아 있으면 그 말은 팀이 아니라 그 참모 입력칸으로(사람 이름과 같아도 고른 것만)
  const aimed = useRef<RosterOrch | null>(null);
  const [toMine, setToMine] = useState<{ id: number; text: string; to: string; sending?: boolean }[]>([]);
  const lines = convo.room ? roomItems(items, convo.room) : [];
  // 쓰던 글 — 화면을 나갔다 와도·앱을 다시 켜도(10-28 팀원 — 대화하다 나가면 쓰던 글이 지워졌다). 팀 홈 '대화로' 글은 그 뒤에 잇는다
  const [text, setText] = useState(() => { const was = drafts.load(convo.key).text; return seed ? (was.trim() ? `${was}\n${seed}` : seed) : was; });
  useEffect(() => { drafts.save(convo.key, { text, refs: [] }); }, [text, convo.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // 첫 글은 한 번만 — 참모 화면 다녀오기·팀 모드 다시 켜기로 이 칸이 다시 붙어도 또 안 넣는다(10-26 사용자)
  useEffect(() => { if (seed) onSeeded?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [handing, setHanding] = useState<TeamItem | null>(null);
  // 넘기는 중인 말(방:번호 → 받는 참모) — 참모 입력칸에 치기까지 1~3초(10-29 실측), 그동안 그 말 밑에 한 줄·단추 숨김
  const [handPend, setHandPend] = useState<Record<string, string>>({});
  const handFly = useRef(new Set<string>());
  // 엔터 즉시 내 풍선 — 서버 seq 를 받아 기록에 같은 seq 가 보이면 지운다(기록 다시 읽기는 onSent)
  const [sending, setSending] = useState<{ id: number; text: string; seq?: number }[]>([]);
  // 폰 — 말을 누르면 그 말에만 '내 참모에게'(데스크톱은 올리면 보인다)
  const [picked, setPicked] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const peer = safety?.find((p) => p.member === convo.peer);
  const stopped = !!peer && (peer.state === 'changed' || peer.state === 'forked');
  const [check, setCheck] = useState(false);
  // 보안 번호가 바뀌어 저절로 받아들인 사람 — 그 때 자리에 회색 줄(사용자 10-29 '팀원 바뀜은 묻지 않는다'), 번호 비교는 누를 때만
  const rekeys = slotNotices(lines.map((it) => it.at), rekeyNotices(safety, group ? (convo.members ?? []) : convo.peer ? [convo.peer] : []));
  const [cmp, setCmp] = useState<string | null>(null);
  const rekeyLine = (p: SafetyPerson) => (
    <div key={`rk-${p.account}`}>
      <div className="tmx-sys"><span className="tmx-pill">{rekeyText(p.name)}
        <button aria-expanded={cmp === p.account} onClick={() => setCmp((c) => (c === p.account ? null : p.account))}>{tr('번호 비교', 'Compare number')}</button></span></div>
      {cmp === p.account && <SafetyPanel p={p} teamName={team} readOnly={phone} onDone={() => { setCmp(null); onSent(); }} />}
    </div>
  );
  const paused = (held ?? []).filter((h) => h.room && h.room === convo.room);
  // 바뀜·갈림 말 — 펼친 줄(seq)
  const [opened, setOpened] = useState<Record<number, boolean>>({});
  const trustedAt = useRef(0);
  // 방금 보낸 글 — 입력기가 비운 칸에 그 글을 통째로 되살리면 버린다(domain/enterSend, 10-28 '해결해결')
  const lastSent = useRef<{ text: string; at: number } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const top = lines[lines.length - 1]?.seq ?? 0;
  // 말마다 아직 안 읽은 사람 수 — 방 사람 중 보낸 사람 빼고 읽은 자리가 그 말 앞인 사람(같은 사람 여러 기기는 하나)
  const meId = members.find((m) => m.me)?.id ?? '';
  const unread = reads && convo.room ? unreadCounts(roomPeople({ kind: group ? 'group' : 'dm', peer: convo.peer, members: convo.members }, meId), readersAt(reads, convo.room, items), lines) : new Map<number, number>();

  // 지금 보는 대화를 Rust 에 — 그 대화 새 말엔 안 울린다(창이 앞일 때만, Rust 가 창에 묻는다)
  useEffect(() => { viewing(convo.room); }, [convo.room]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { viewing(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focused && convo.room && top) onRead(convo.room); }, [focused, convo.room, top]); // eslint-disable-line react-hooks/exhaustive-deps
  // 맨 아래 붙어 있기 — 맨 아래(80px 안)를 보던 중이면 창·칸 크기가 바뀌어도(글줄이 다시 감김)·그림이 늦게 그려져도·새 말이 와도 맨 아래.
  // 올려 읽던 중이면 읽던 말(칸 위에 걸린 첫 줄)을 같은 자리에. 맥 웹뷰는 크롬의 스크롤 고정이 없어 손으로 한다(10-28 사용자 "줄일 때 가장 아래로 고정")
  const inner = useRef<HTMLDivElement>(null);
  const near = useRef(true);
  const pin = useRef<{ el: Element; off: number } | null>(null);
  const topNow = useRef(top);
  topNow.current = top;
  const [off, setOff] = useState(false); // 맨 아래를 벗어남 — 새 말이 오면 단추에 수
  const [far, setFar] = useState(false); // 400px 넘게 올림 — 새 말 없어도 단추(참모 채팅과 같은 기준)
  const [seen, setSeen] = useState(top);
  const unseen = off ? unseenCount(lines.map((it) => it.seq), seen) : 0;
  const toBottom = () => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; };
  // 맨 아래를 벗어났다는 판단은 사람이 움직였을 때만(휠·터치·키·누르기 1초 안). 창을 넓히면 레이아웃이 두 번 바뀌는데(옆 칸이 늦게 붙음)
  // 그 사이 브라우저가 낸 스크롤 이벤트가 바뀐 뒤 높이로 읽혀 '올려 읽는 중'이 됐다(하네스 1000×520). 참모 채팅(ChatView)과 같은 규칙
  const handAt = useRef(0);
  const hand = () => { handAt.current = Date.now(); };
  const measure = () => {
    const el = list.current;
    if (!el) return;
    if (nearBottom(el.scrollHeight, el.scrollTop, el.clientHeight)) near.current = true;
    else if (Date.now() - handAt.current < 1000) near.current = false;
    setOff(!near.current);
    setFar(!near.current && farFromBottom(el.scrollHeight, el.scrollTop, el.clientHeight));
    if (near.current) setSeen(topNow.current);
    const box = el.getBoundingClientRect().top;
    const first = [...(inner.current?.children ?? [])].find((c) => c.getBoundingClientRect().top >= box);
    pin.current = first ? { el: first, off: first.getBoundingClientRect().top - box } : null;
  };
  useEffect(() => {
    const el = list.current;
    if (!el || !inner.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const p = pin.current;
      const box = el.getBoundingClientRect().top;
      const t = keepTop({ near: near.current, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, anchor: p?.el.isConnected ? { was: p.off, now: p.el.getBoundingClientRect().top - box } : undefined });
      if (t !== null) el.scrollTop = t;
    });
    ro.observe(el);
    ro.observe(inner.current);
    return () => ro.disconnect();
  }, []);
  // 대화를 바꾸면 늘 맨 아래
  useLayoutEffect(() => { near.current = true; toBottom(); setSeen(topNow.current); }, [convo.key]);
  // 새 말 — 맨 아래를 보던 중이었거나 내가 막 보냈으면 맨 아래, 올려 읽던 중이면 그대로(단추에 새 말 수)
  const sentN = sending.length + toMine.length;
  const sentWas = useRef(sentN);
  useLayoutEffect(() => {
    const sentMine = sentN > sentWas.current;
    sentWas.current = sentN;
    if (stickBottom({ wasNear: near.current, sentMine })) { near.current = true; toBottom(); }
  }, [top, sentN, paused.length]);
  useEffect(() => { setHanding(null); setErr(null); setSending([]); setPendReact([]); setToMine([]); aimed.current = null; setFollow(null); setConfirming(null); }, [convo.key]);
  useEffect(() => { if (agentsApi && convo.room && lines.some((it) => it.via === 'helper')) void agentsApi.usage(convo.room).then(setUsage, () => {}); }, [convo.room, top, agentsApi]); // eslint-disable-line react-hooks/exhaustive-deps

  const mark = (e: React.SyntheticEvent) => { trustedAt.current = e.nativeEvent.isTrusted ? Date.now() : 0; };
  const ready = atts.filter((a) => a.ref).map((a) => a.ref!);
  const uploading = atts.some((a) => a.busy);
  // 파일 붙이기 — 팀 보관함에 방 사람 기기마다 봉투로 올리고(team_locker) 참조만 말에 싣는다. 새 DM(방 아직 없음)은 첫 말 뒤에
  const attach = (paths: string[]) => {
    if (!paths.length || !rich) return;
    if (!convo.room || !teamId) { setErr(tr('첫 말을 보낸 뒤에 파일을 붙일 수 있어요', 'Send a first message, then attach files')); return; }
    const added = paths.map((p) => ({ key: `${p}#${Math.random()}`, name: p.split(/[\\/]/).pop() || p, busy: true }));
    setAtts((a) => [...a, ...added]);
    void files.attach(teamId, convo.room, paths).then((refs) => {
      setAtts((a) => a.map((x) => { const i = added.findIndex((y) => y.key === x.key); const r = i >= 0 ? refs[i] : undefined; return r ? { ...x, busy: false, size: r.size, name: r.name, ref: r } : x; }));
    }, (e: unknown) => setAtts((a) => a.map((x) => (added.some((y) => y.key === x.key) ? { ...x, busy: false, err: String(e) } : x))));
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const f = (e: Event) => {
      const d = (e as CustomEvent<{ over?: boolean; paths?: string[]; refs?: TeamFile[] }>).detail;
      // refs = 팀 보관함에서 끌어 온 이미 있는 파일(다시 안 올리고 그 파일을 가리킨다 — TeamLocker 가 가른다)
      if (d.refs) { setDropOver(false); if (rich && convo.room) setAtts((a) => [...a, ...d.refs!.filter((r) => !a.some((x) => x.ref?.id === r.id)).map((r) => ({ key: `${r.id}#${Math.random()}`, name: r.name, size: r.size, ref: r }))]); } else if (d.paths) { setDropOver(false); attach(d.paths); } else setDropOver(!!d.over);
    };
    el.addEventListener(TEAM_DROP_EVENT, f);
    return () => el.removeEventListener(TEAM_DROP_EVENT, f);
  });
  const react = (seq: number, markKey: string, on: boolean) => {
    if (pendReact.some((x) => x.seq === seq && x.mark === markKey)) return; // 보내는 중에 또 누름 — 한 번만
    const p = say(sayTarget(convo), '', trustedAt.current, { react: { seq, mark: markKey, on } });
    if (!p) return;
    const mine = { seq, mark: markKey, on };
    setPendReact((x) => [...x, mine]);
    void p.then(() => onSent(), (e: unknown) => { setPendReact((x) => x.filter((y) => y !== mine)); setErr(tr(`반응을 못 달았어요 — ${String(e)}`, `Reaction not sent — ${String(e)}`)); });
  };
  // 썸네일 — 파일은 그 팀(f.team) 보관함에 봉해져 있다(다른 팀 방 파일도 그 팀 열쇠로)
  const thumbOf = useMemo(() => ({ get: (f: TeamFile) => thumb(f.team || teamId, f.id, f.name, f.size), forget: (f: TeamFile) => forgetTeamThumb(f.team || teamId, f.id) }), [thumb, teamId]);
  // 파일 풍선 — 누르면 스페이스(보관함과 같은 openTeamFile 길), 오른쪽 클릭 = 다른 앱으로 열기·이 기기에 저장
  const fileFail = (e: unknown) => setErr(tr(`파일을 못 열었어요 — ${String(e)}`, `Could not open the file — ${String(e)}`));
  const openFile = (f: TeamFile, app = false) => void openTeamFile((external) => files.open(f.team || teamId, f.id, external), f.name, app).catch(fileFail);
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const onFileMenu = (e: React.MouseEvent, f: TeamFile) => setFileMenu({ x: e.clientX, y: e.clientY, items: [
    { label: tr('열기', 'Open'), run: () => openFile(f) },
    { label: tr('다른 앱으로 열기', 'Open with default app'), run: () => openFile(f, true) },
    { label: tr('이 기기에 저장', 'Save to this Mac'), sep: true, run: () => void files.save(f.team || teamId, f.id).catch(fileFail) },
    // 내 참모에게 — 보관함 메뉴와 같은 줄(프사 + 이름), 고른 참모 보관함에 풀어 그 참모 채팅에 붙인다(보내기는 사람이)
    ...(mine.length ? [giveMenu(mine, (o) => void giveIds(f.team || teamId, [f.id], o).catch(fileFail))] : []),
  ] });
  const typed = (v: string, caret: number) => {
    setText(v);
    const q = atQuery(v, caret);
    setMenu(q ? { ...q, sel: 0 } : null);
  };
  const pickMention = (m: MentionPick) => {
    if (!menu) return;
    const v = `${text.slice(0, menu.start)}${m.insert} ${text.slice(menu.start + 1 + menu.q.length)}`;
    setText(v);
    setMenu(null);
    if (m.kind === 'mine' && m.orch) { aimed.current = m.orch; rememberPick(m.orch.id); }
    const at = menu.start + m.insert.length + 1;
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(at, at); });
  };
  // @ 메뉴에서 고른 내 참모에게 — 내 말로 그 참모 입력칸에(팀엔 안 간다). 이 칸에서 직접 친 것만
  const sendMine = (o: RosterOrch, t: string) => {
    if (!handoff) return;
    if (ready.length || atts.length) { setErr(tr('내 참모에게 보내는 말엔 파일을 못 붙여요 — 파일을 빼거나 참모 이름을 지워 줘', "Files can't go to your assistant from here — remove them or the assistant mention")); return; }
    const body = toMineText(t, o.label, convo.name);
    if (!body) { setErr(tr(`${o.label}에게 보낼 말이 비었어요`, `Nothing to send to ${o.label}`)); return; }
    if (!trustedAt.current) { setErr(tr('이 칸에서 직접 친 말만 보내요 — 다시 쳐 줘', 'Only what you type here is sent — type it again')); return; }
    trustedAt.current = 0;
    const id = Date.now() + Math.random();
    setText('');
    lastSent.current = { text: t, at: Date.now() };
    setMenu(null);
    setErr(null);
    aimed.current = null;
    // 줄은 바로 — 참모 입력칸에 치기까지 1~3초 걸린다(10-29 실측)
    setToMine((x) => [...x, { id, text: body.split('\n\n')[0]!, to: o.label, sending: true }]);
    void handoff.send(body, o.id).then(() => setToMine((x) => x.map((m) => (m.id === id ? { ...m, sending: false } : m))), (e: unknown) => {
      setToMine((x) => x.filter((m) => m.id !== id));
      lastSent.current = null;
      setText((cur) => cur || t);
      setErr(tr(`${o.label}에게 못 보냈어요 — ${String(e)}`, `Not sent to ${o.label} — ${String(e)}`));
    });
  };
  const send = (checked = '') => {
    const t = text.trim();
    if ((!t && !ready.length) || busy || uploading) return;
    const o = aimed.current;
    if (o && t.includes(`@${o.label}`)) { sendMine(o, t); return; }
    // 팀 참모를 부르는 말 — 처음·바뀐 판이면 확인 장부터(확인 안 하면 Rust 가 안 돌린다, P2)
    const ag = agents ? calledAgent(t, agents.agents) : null;
    if (ag && checked !== ag.id && needsConfirm(ag, agents!.seen)) { setConfirming({ id: ag.id, t }); return; }
    const re = follow && t.includes(`@${follow.name}`) ? follow.seq : 0;
    const extra: SayExtra = { ...(ready.length ? { files: ready } : {}), ...(re ? { re } : {}) };
    const p = ready.length || re ? say(sayTarget(convo), t, trustedAt.current, extra) : say(sayTarget(convo), t, trustedAt.current);
    trustedAt.current = 0;
    if (!p) { setErr(tr('이 칸에서 직접 친 말만 보내요 — 다시 쳐 줘', 'Only what you type here is sent — type it again')); return; }
    const id = Date.now() + Math.random();
    setSending((s) => [...s, { id, text: t || ready.map((f) => f.name).join(', ') }]);
    setText('');
    lastSent.current = t ? { text: t, at: Date.now() } : null;
    setAtts([]);
    setMenu(null);
    setErr(null);
    setFollow(null);
    setBusy(true);
    void p.then((r) => {
      const seq = (r as { seq?: number } | null)?.seq;
      setSending((s) => s.map((x) => (x.id === id ? { ...x, seq } : x)));
      onSent();
    }, (e: unknown) => {
      setSending((s) => s.filter((x) => x.id !== id));
      lastSent.current = null;
      // 보안 번호가 바뀌어 멈춘 말 — '멈춤' 풍선으로 보여 준다(받아들이면 보낸다)
      if (String(e).includes('멈춤')) { onSent(); return; }
      setText((cur) => cur || t);
      setErr(tr(`못 보냈어요 — ${String(e)}`, `Not sent — ${String(e)}`));
    }).finally(() => setBusy(false));
  };
  // 입력기가 아직 글을 넣는 Enter(229)는 다음 차례에 — 그때의 send(새 글을 본)를 부른다
  const sendNow = useRef(send);
  sendNow.current = send;
  const handOver = (o?: RosterOrch) => {
    if (!handing || !handoff) return;
    const it = handing;
    const key = `${it.room}:${it.seq}`;
    const to = o?.label ?? handoff.name;
    if (handFly.current.has(key)) return; // 넘기는 중에 또 누름 — 한 번만(10-28 기록: 3초 간격으로 4번 갔다)
    handFly.current.add(key);
    const text = handoffText(it, team, note);
    const kept = note;
    // 누르는 즉시 카드를 닫고 그 말 밑에 '넘기는 중' — 참모 입력칸에 치기까지 1~3초(10-29 실측), 그동안 가만있어서 또 눌렀다
    setHanding(null);
    setNote('');
    setErr(null);
    setHandPend((p) => ({ ...p, [key]: to }));
    void handoff.send(text, o?.id).then(() => onHanded(it, to), (e: unknown) => {
      setErr(tr(`못 넘겼어요 — ${String(e)}`, `Not handed off — ${String(e)}`));
      setHanding((h) => h ?? it);
      setNote((n) => n || kept);
    }).finally(() => {
      handFly.current.delete(key);
      setHandPend((p) => { const n = { ...p }; delete n[key]; return n; });
    });
  };

  let prevAt: number | null = null;
  const now = Date.now();
  // 상대 프로필(사진·상태·상태 글) — DM 만. 방해 금지면 입력칸 위 한 줄(시안 team-settings v1 S)
  const look = group ? null : lookOf(board, convo.peer, convo.name);
  // 말 위 보낸 사람 이름도 프로필 별명으로(목록·머리와 같게)
  const nameOf = (member: string, roster: string) => lookOf(board, member, roster).name;
  const dnd = look ? dndNotice(look) : null;
  return (
    <div className="tmx-convo" ref={box} data-team-drop={rich && convo.room ? '' : undefined} data-team-room={convo.room || undefined} onKeyDownCapture={mark} onClickCapture={mark}>
      <header className="tmx-head">
        {back && <IconButton size="l" label={tr('뒤로', 'Back')} onClick={back}><IconBack /></IconButton>}
        {group ? <TeamMarkIcon name={convo.name} size={28} /> : <PersonOf member={convo.peer} name={convo.name} color={convo.color} size={28} />}
        <span className="tmx-head-tx"><b>{convo.name}</b><span>{group ? tr(`${convo.people ?? 0}명 · 참모도 이 팀챗에서 답해요`, `${convo.people ?? 0} people · assistants answer here too`) : (look && statusLine(look)) || tr(`${convo.name}의 참모도 이 대화에서 답해요`, `${convo.name}'s assistant answers here too`)}</span></span>
        {group && people && <span className="tmx-room-ppl">{(convo.members ?? []).slice(0, 5).map((m) => <PersonOf key={m} member={m} name={people[m] ?? '?'} color={personColor(people[m] ?? '?')} size={22} />)}</span>}
        {group && onEditRoom && <IconButton label={tr('팀챗 이름·사람 바꾸기', 'Edit team chat')} onClick={onEditRoom}><IconPencil /></IconButton>}
        {onFiles && <IconButton label={tr('이 대화 파일', 'Files in this chat')} onClick={onFiles}><IconFolder /></IconButton>}
        {detach && <IconButton label={tr('이 대화 따로 창으로', 'Open this chat in its own window')} onClick={detach}><IconWindowOut /></IconButton>}
      </header>
      {/* 빈 데를 누르면 입력칸으로 — 참모 채팅과 같은 판단(글 고르기·단추·링크는 그대로). 폰은 키보드가 튀어나와 뺀다 */}
      <div className="tmx-msgs" onClick={phone ? undefined : openWebLink} ref={list}
        onMouseUp={phone ? undefined : (e) => { const t = e.target as HTMLElement; if (clickFocusesInput({ interactive: !!t.closest('button, a, input, textarea, select, summary, [contenteditable="true"], [role="button"]'), selected: window.getSelection()?.toString() ?? '' })) input.current?.focus(); }} onScroll={measure} onWheel={hand} onTouchMove={hand} onKeyDown={hand} onPointerDown={hand}>
        <div className="tmx-msgs-in" ref={inner}>
        {stopped && peer && (
          <div className="tmx-sys"><span className="tmx-pill"><b>{peer.state === 'forked' ? tr(`${convo.name}의 기기 목록이 다르게 보여요`, `${convo.name}'s device list looks different`) : tr(`${convo.name}의 보안 번호가 바뀌었어요`, `${convo.name}'s safety number changed`)}</b>
            <button aria-expanded={check} onClick={() => setCheck((c) => !c)}>{tr('확인', 'Check')}</button></span></div>
        )}
        {stopped && peer && check && <SafetyPanel p={peer} teamName={team} readOnly={phone} onDone={() => { setCheck(false); onSent(); }} />}
        {lines.length === 0 && !sending.length && <div className="tmx-empty">{group ? tr(`${convo.name} 팀챗에 첫 말을 보내 봐요`, `Say hi in ${convo.name}`) : tr(`${convo.name}에게 첫 말을 보내 봐요`, `Say hi to ${convo.name}`)}</div>}
        {lines.map((it, i) => {
          const rk = rekeys.before[i]?.map(rekeyLine);
          const l = lineOf(it, myName, group ? '' : convo.name, nameOf, (q) => !!lines.find((x) => x.seq === q)?.re);
          const day = dayLabel(it.at, prevAt, now);
          prevAt = it.at;
          const to = handed[`${it.room}:${it.seq}`];
          // 받지 않은 말·확인 전인 말(종단 암호 표시)은 참모에게 안 넘긴다
          const pend = handPend[`${it.room}:${it.seq}`];
          const canHand = !!handoff && !pend && l.kind !== 'blocked' && l.kind !== 'e2e' && !(l.kind === 'bubble' && l.side === 'me') && !(l.kind === 'agent' && l.mine);
          const hand = canHand && <button className="tmx-hand" onClick={() => { setHanding(it); setNote(''); }}>{tr('내 참모에게', 'To my assistant')}</button>;
          const rs = reacts.get(it.seq) ?? [];
          const canReact = rich && (l.kind === 'bubble' || l.kind === 'agent');
          const add = canReact && <ReactAdd mine={rs.filter((r: { mine: boolean }) => r.mine).map((r: { mark: string }) => r.mark)} onPick={(k, on) => react(it.seq, k, on)} />;
          const chips = <Reacts list={rs} onToggle={canReact ? (k, on) => react(it.seq, k, on) : undefined} />;
          const fs = it.files?.length ? <FileBubbles files={it.files} me={l.kind === 'bubble' && l.side === 'me'} onOpen={rich ? (f) => openFile(f) : undefined} onMenu={rich ? onFileMenu : undefined} thumb={thumbOf} /> : null;
          const hl = l.kind !== 'blocked' && l.kind !== 'e2e' && !(l.kind === 'bubble' && l.side === 'me') && mentionsMe(it.body, myName);
          const rd = <ReadLeft n={unread.get(it.seq) ?? 0} />;
          return (
            <div key={it.seq} className="tmx-line" data-seq={it.seq}>
              {rk}
              {day && <div className="tmx-day">{day}</div>}
              {l.kind === 'blocked' && <div className="tmx-blocked">{l.text}</div>}
              {l.kind === 'e2e' && (
                <>
                  <div className={`tmx-e2e ${l.tone}`}>{l.text}{l.body && l.folded && <IconButton size="s" className="tmx-e2e-open" pressed={!!opened[l.seq]} label={opened[l.seq] ? tr('본문 접기', 'Hide text') : tr('본문 보기', 'Show text')} onClick={() => setOpened((o) => ({ ...o, [l.seq]: !o[l.seq] }))}>{opened[l.seq] ? <IconChevronUp /> : <IconChevronDown />}</IconButton>}</div>
                  {l.body && (!l.folded || opened[l.seq]) && <div className="tmx-e2e-body">{l.body}</div>}
                </>
              )}
              {l.kind === 'bubble' && l.side === 'me' && (
                <>
                  <div className="tmx-me">{add}<span className="tmx-meta">{rd}<span className="tmx-at">{stamp(l.at, now)}</span></span><div className="tmx-col">{l.text && <div className="tmx-bub me"><MentionText text={l.text} names={names} myName={myName} newTab={phone} /></div>}{fs}</div></div>
                  {rs.length > 0 && <div className="tmx-reacts me">{chips}</div>}
                </>
              )}
              {l.kind === 'bubble' && l.side === 'them' && (
                <div className={`tmx-row ${picked === it.seq ? 'picked' : ''} ${hl ? 'hl' : ''}`} onClick={(e) => { if (!onLinkEl(e)) setPicked((p) => (p === it.seq ? null : it.seq)); }}><PersonOf member={it.member} name={l.name} color={l.color} size={28} />
                  <div className="tmx-col"><span className="tmx-nm">{l.name} <span className="tmx-at">{stamp(l.at, now)}</span>{rd}</span>{l.text && <div className="tmx-bub"><MentionText text={l.text} names={names} myName={myName} newTab={phone} /></div>}{fs}{chips}</div>{add}{hand}</div>
              )}
              {l.kind === 'agent' && (() => {
                // 팀 참모 답(ADR 0017) — 그 참모 얼굴, 8줄 넘으면 접힘, 이어 묻기(글자 단추), 토큰은 부른 사람 화면에만
                const ag = l.agentId ? agents?.agents.find((a) => a.id === l.agentId) : undefined;
                const fold = l.helper && !unfold[l.seq] ? foldLong(l.text) : { head: l.text, more: 0 };
                const use = l.helper ? usage[String(l.seq)] : undefined;
                return (
                  <div className={`tmx-row ${picked === it.seq ? 'picked' : ''} ${hl ? 'hl' : ''}`} onClick={(e) => { if (!onLinkEl(e)) setPicked((p) => (p === it.seq ? null : it.seq)); }}>{ag ? <AgentFace def={ag.def} /> : l.helper ? <HelperFace size={28} /> : <Face color={l.color} size={28} />}
                    <div className="tmx-col"><span className="tmx-nm">{l.name} {l.helper ? <span className="tmx-by">{l.tag}</span> : <span>{l.tag}</span>} <span className="tmx-at">{stamp(l.at, now)}</span>{rd}</span>{l.text && <div className="tmx-plain tmx-md" dangerouslySetInnerHTML={{ __html: agentHtml(fold.head, names, myName, !!phone) }} />}
                      {fold.more > 0 && <button className="tma-more" onClick={(e) => { e.stopPropagation(); setUnfold((u) => ({ ...u, [l.seq]: true })); }}>{tr(`펼치기 · ${fold.more}줄`, `Show all · ${fold.more} lines`)}</button>}
                      {fs}{chips}
                      {l.helper && (ag || use) && (
                        <div className="tma-foot">
                          {ag && !ag.clash && agentsApi && <button className="tma-link" onClick={(e) => { e.stopPropagation(); setFollow({ seq: l.seq, name: ag.def.name }); setText((cur) => (cur.includes(`@${ag.def.name}`) ? cur : `@${ag.def.name} ${cur}`)); requestAnimationFrame(() => input.current?.focus()); }}>{tr('이어 묻기', 'Follow up')}</button>}
                          {use && <span>{`${modelLabel(use[0])} · ${tokensLabel(use[1])} ${tr('토큰', 'tokens')}`}</span>}
                        </div>
                      )}
                    </div>{add}{hand}</div>
                );
              })()}
              {pend ? <div className="tmx-handed" role="status">{tr(`${pend}에게 넘기는 중`, `Forwarding to ${pend}`)}</div> : to && <div className="tmx-handed">{tr(`${to}에게 넘김`, `Forwarded to ${to}`)}</div>}
            </div>
          );
        })}
        {rekeys.tail.map(rekeyLine)}
        {sending.filter((x) => x.seq === undefined || !lines.some((it) => it.seq === x.seq)).map((x) => (
          <div key={x.id} className="tmx-line"><div className="tmx-me"><div className="tmx-bub me sending">{x.text}</div></div></div>
        ))}
        {toMine.map((x) => (
          <div key={x.id} className="tmx-line">
            <div className="tmx-me"><div className={`tmx-bub me ${x.sending ? 'sending' : ''}`}>{x.text}</div></div>
            <div className="tmx-handed" role={x.sending ? 'status' : undefined}>{x.sending ? tr(`${x.to}에게 보내는 중 · 팀엔 안 보임`, `Sending to ${x.to} · not shown to the team`) : tr(`${x.to}에게 보냄 · 팀엔 안 보임`, `Sent to ${x.to} · not shown to the team`)}</div>
          </div>
        ))}
        {paused.map((h) => (
          <div key={h.cid} className="tmx-line">
            <div className="tmx-me"><div className="tmx-bub me wait">{h.body}</div></div>
            <div className="tmx-held">{tr('멈춤 — 받아들이면 보내요', 'Paused — sent once you accept')}</div>
          </div>
        ))}
        </div>
      </div>
      {(far || unseen > 0) && <div className="tmx-jump-at"><JumpBottom className={phone ? 'tmx-jump ph' : 'tmx-jump'} n={unseen} onClick={() => { near.current = true; toBottom(); }} /></div>}
      {handing && handoff && (
        <div className="tmx-card" role="group" aria-label={tr('내 참모에게 넘기기', 'Forward to my assistant')}>
          <div className="tmx-card-h">
            <b>{handing.person}</b><span>{handing.origin === 'human' ? tr('사람 말', 'Human') : tr('참모 말', 'Assistant')} · {team}</span>
            <IconButton size="s" label={tr('닫기', 'Close')} onClick={() => setHanding(null)}><IconClose /></IconButton>
          </div>
          <div className="tmx-card-q">{handing.body}</div>
          <textarea className="tmx-card-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr(`${handoff.name}에게 붙일 말`, `A note for ${handoff.name}`)} />
          {mine.length
            ? <OrchPickList list={mine} onPick={handOver} label={tr('넘길 내 참모', 'Assistant to forward to')} />
            : <div className="tmx-card-a"><button className="tmx-btn pri" onClick={() => handOver()}>{tr(`${handoff.name}에게 넘기기`, `Forward to ${handoff.name}`)}</button></div>}
        </div>
      )}
      {err && <div className="tmx-err" role="alert">{err}</div>}
      {dropOver && <div className="tmx-dropov"><div><b>{tr(`${convo.name}에 파일 붙이기`, `Attach to ${convo.name}`)}</b><span>{tr('종단 암호로 올려요', 'Uploaded end-to-end encrypted')}</span></div></div>}
      {dnd && <div className="tmp-dnd" role="note">{dnd}</div>}
      <div className="tmx-compw">
        {menu && <MentionMenu items={picks} sel={Math.min(menu.sel, Math.max(0, picks.length - 1))} onPick={pickMention} />}
        <Attachments list={atts} onRemove={(k) => setAtts((a) => a.filter((x) => x.key !== k))} />
        {follow && <div className="tma-re" role="status">{tr(`${follow.name} 답에 이어 묻기`, `Following up on ${follow.name}`)}<IconButton size="s" label={tr('이어 묻기 빼기', 'Cancel follow-up')} onClick={() => setFollow(null)}><IconClose /></IconButton></div>}
        <div className="tmx-comp">
          {rich && convo.room && <IconButton label={tr('파일 붙이기', 'Attach files')} onClick={() => void files.pick().then(attach, (e: unknown) => setErr(tr(`파일 창을 못 열었어요 — ${String(e)}`, `Could not open the file picker — ${String(e)}`)))}><IconPlus /></IconButton>}
          <textarea ref={input} rows={1} value={text} onChange={(e) => { if (echoOfSent(e.target.value, text, lastSent.current, Date.now())) { lastSent.current = null; setText(''); return; } typed(e.target.value, e.target.selectionStart ?? e.target.value.length); }} placeholder={group ? tr(`${convo.name}에 보내기 — @ 로 부르기`, `Message ${convo.name} — @ to mention`) : tr(`${convo.name}에게`, `To ${convo.name}`)} aria-label={tr(`${convo.name}에게 보낼 말`, `Message to ${convo.name}`)}
            onBlur={() => setMenu(null)}
            // ⌘V — 파인더에서 복사한 파일·스크린샷 복사 그림을 첨부로(웹뷰는 파일 주소를 안 넘겨서 맥 클립보드를 읽는다). 글만이면 그대로 글
            onPaste={(e) => {
              if (!rich || !pasteTakes([...e.clipboardData.items], !!e.clipboardData.getData('text/plain'))) return;
              e.preventDefault();
              void files.clip(pasteName(new Date())).then(
                (paths) => (paths.length ? attach(paths) : setErr(tr('붙일 그림·파일을 클립보드에서 못 찾았어요', 'No image or file found on the clipboard'))),
                (x: unknown) => setErr(tr(`붙여넣기를 못 했어요 — ${String(x)}`, `Couldn't paste — ${String(x)}`)));
            }}
            onKeyDown={(e) => {
              if (menu && picks.length) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setMenu((m) => m && { ...m, sel: (m.sel + (e.key === 'ArrowDown' ? 1 : picks.length - 1)) % picks.length }); return; }
                if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) { e.preventDefault(); pickMention(picks[Math.min(menu.sel, picks.length - 1)]!); return; }
                if (e.key === 'Escape') { e.preventDefault(); setMenu(null); return; }
              }
              const act = enterAction({ key: e.key, keyCode: e.keyCode, isComposing: e.nativeEvent.isComposing, shiftKey: e.shiftKey });
              if (act === 'skip') return;
              e.preventDefault();
              if (act === 'send') send();
              else setTimeout(() => sendNow.current());
            }} />
          <IconButton label={tr('보내기', 'Send')} disabled={busy || uploading || (!text.trim() && !ready.length)} onClick={() => send()}><IconEnter /></IconButton>
        </div>
      </div>
      {fileMenu && <ContextMenu x={fileMenu.x} y={fileMenu.y} items={fileMenu.items} onClose={() => setFileMenu(null)} />}
      {confirming && agents && agentsApi && (() => {
        const ag = agents.agents.find((a) => a.id === confirming.id);
        if (!ag) return null;
        // 확인 장 단추도 사람 손 — 누른 순간을 보내기 문(trustedAt)에 적는다
        return (
          <div style={{ display: 'contents' }} onMouseDownCapture={mark} onKeyDownCapture={mark}>
            <AgentConfirm agent={ag} seen={agents.seen[ag.id]} caller={myName} onCancel={() => setConfirming(null)}
              onPlain={() => { setConfirming(null); send(ag.id); }}
              onOk={() => { const id = ag.id; setConfirming(null); void agentsApi.confirm(teamId, id).then(() => { setAgents((x) => x && { ...x, seen: { ...x.seen, [id]: { ver: ag.ver, def: ag.def } } }); send(id); }, (e: unknown) => setErr(tr(`확인을 못 적었어요 — ${String(e)}`, `Couldn't save the check — ${String(e)}`))); }} />
          </div>
        );
      })()}
    </div>
  );
}
