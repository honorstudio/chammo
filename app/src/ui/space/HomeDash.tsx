// 홈 대시보드 — 띠 맨 위 홈(2026-10-24 사용자 시안 home-dash v1 HA 타일 격자). 참모 채팅 없이 전체 한눈에:
// 숫자 넷(결정 대기·일하는 세션·오래 조용·오늘 끝남)·부하·계정 / 참모 타일·잠든 선반 / 결정 대기·오래 조용 / 참모별 진행 칸 / 기기·도구 / 오늘 끝난 것 / 사무실.
// 누르면 그 자리에서(2026-10-24 사용자 시안 home-inplace v1 A): 참모 = 카드 아래 미니 대화, 결정 = 그 자리 펼침, 오래 조용 = 세션 한눈, 오늘 끝남 = 칩 아래 한 줄,
// 도구 = 오른쪽 서랍. 다른 화면으로는 '크게 열기' 아이콘만. 띄움은 하나씩(domain/homePop). 글은 읽을 것만 — 도구는 아이콘만(이름은 aria-label·title)
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { remoteSaved } from '../../data/remote';
import { withRefs, type ChatRef } from '../../domain/chat';
import { mobileApi } from '../../data/tauri';
import { goalBar } from '../../domain/goalBar';
import { homeDash } from '../../domain/homeDash';
import { homeProjects } from '../../domain/homeProjects';
import { closeOnKey, flipPop, isPop, miniScroll, type HomePop } from '../../domain/homePop';
import { findTarget } from '../../domain/inbox';
import { phoneGroups } from '../../domain/mobileDevices';
import { whenLabel } from '../../domain/orchHome';
import { addRef } from '../../domain/refChips';
import { seenName, type Session } from '../../domain/session';
import type { FeatureKey } from '../../domain/spaceNav';
import type { ActivityStatus } from '../../domain/status';
import type { StoppedSession } from '../../domain/stopped';
import type { TaskEvent } from '../../domain/tasks';
import type { Usage } from '../../domain/usage';
import { assistant, machine, tr } from '../../i18n';
import { OrchAvatar, avatarState } from '../avatar';
import { HomeProgress } from '../GoalProgress';
import { IconButton } from '../kit/IconButton';
import { IconCalendarClock, IconClose, IconHarness, IconMaximize, IconOffice, IconReplay, IconReview, IconSend, IconTools } from '../Icons';
import { mdToHtml } from '../md';
import { every } from '../poll';
import { askRef, type RefAsk } from '../refBus';
import type { LiveLine } from './DashboardView';
import { HomeProjects, projGrown, useProjFold } from './HomeProjects';
import { tailLines, useChatItems } from './useChatItems';
import '../chat/chat.css'; // 칩 줄(chat-refs)은 채팅 입력칸과 같은 모양
import './homeDash.css';

/** 누르면 갈 곳 — 스페이스가 준다 */
export type HomeGo = { orch: (id: string) => void; session: (target: string) => void; feature: (k: FeatureKey) => void;
  /** 사무실을 참모 탭에서 크게(홈 안 사무실의 '크게 열기') */
  office?: () => void;
  /** 홈 안에서 크게 연 사무실 — 스페이스가 준다(책상을 누르면 참모는 그때 그 참모로, 세션은 이 안 창). 없으면 사무실 칸이 참모 탭 사무실로 넘어감 */
  officeBig?: (close: () => void) => React.ReactNode;
  /** 홈에서 참모를 다뤘다(미니 대화 열기·보내기) — 홈에서 사무실을 켜면 이 참모 기준(domain/spaceOffice homeOfficeOrch) */
  touch?: (id: string) => void;
  /** 기능 서랍 속 — 스페이스가 그 기능 화면을 준다(없으면 도구를 누르면 그 화면으로 넘어감) */
  fnPane?: (k: FeatureKey, close: () => void) => React.ReactNode };
/** 결정 대기 한 줄 — 물음(결정 대기함)·직접 카드. who = 물은 참모(얼굴), pay = 결제 카드 */
export type HomeAsk = { key: string; text: string; where: string; who?: Session; pay?: boolean;
  /** 그 자리 펼침 — 결정 대기함 줄·직접 카드 그대로(앱이 준다). 없으면 누르면 결정 대기함 */
  open?: () => React.ReactNode };

type Dot = 'run' | 'ask' | 'rest' | 'quiet' | 'done' | 'off';
const D = ({ d }: { d: Dot }) => <i className={`hd-d d-${d}`} aria-hidden="true" />;
const dotOf = (st: ActivityStatus | undefined, l: LiveLine | undefined): Dot =>
  st === 'asks' || st === 'blocked' || st === 'login' || l?.status === 'ask' ? 'ask' : st === 'working' || l?.status === 'run' ? 'run' : 'rest';

/** 띄움 창 자리 — 누른 칸(data-pop) 바로 아래, 홈 안에서 같이 굴러간다. side = 칸 왼쪽 끝에 맞출지 오른쪽 끝에 맞출지 */
function Anchored({ root, at, w, side = 'left', children }: { root: React.RefObject<HTMLDivElement | null>; at: string; w: number; side?: 'left' | 'right'; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const me = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const place = () => {
      const box = root.current;
      const el = box?.querySelector<HTMLElement>(`[data-pop="${CSS.escape(at)}"]`);
      if (!box || !el) { setPos(null); return; }
      const b = box.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const want = side === 'left' ? r.left - b.left : r.right - b.left - w;
      // 창 맞춤(.fit)이면 홈이 안 굴러가니 창 아래로 넘치는 띄움은 위로 당긴다(높이는 그려진 뒤 잰다)
      const h = me.current?.offsetHeight ?? 0;
      const top = Math.max(box.scrollTop + 12, Math.min(r.bottom - b.top + box.scrollTop + 8, box.scrollTop + box.clientHeight - h - 12));
      setPos({ top, left: Math.max(12, Math.min(want, b.width - w - 12)) });
    };
    place();
    const ro = new ResizeObserver(place);
    if (me.current) ro.observe(me.current);
    window.addEventListener('resize', place);
    return () => { ro.disconnect(); window.removeEventListener('resize', place); };
  }, [root, at, w, side, !!pos]); // eslint-disable-line react-hooks/exhaustive-deps -- 처음 그린 뒤 한 번 더(높이를 알게 됨)
  return <div className="hd-pop" data-hpop="" ref={me} style={pos ? { top: pos.top, left: pos.left, width: w } : { visibility: 'hidden', width: w }}>{children}</div>;
}

const Head = ({ who, sub, onBig, onClose }: { who: React.ReactNode; sub?: React.ReactNode; onBig: () => void; onClose: () => void }) => (
  <div className="hd-pop-head">
    <span className="hd-tx">{who}{sub}</span>
    <button className="hd-ic" onClick={onBig} aria-label={tr('크게 열기', 'Open large')} title={tr('크게 열기', 'Open large')}><IconMaximize /></button>
    <button className="hd-ic" onClick={onClose} aria-label={tr('닫기', 'Close')} title={tr('닫기', 'Close')}><IconClose /></button>
  </div>
);

/** 참모 미니 대화 — 그 참모 진짜 대화 기록 끝 몇 줄 + 입력칸. 보내기는 앱의 참모 보내기 길(say) 그대로라 그 참모 채팅에 같은 말이 쌓인다.
 *  inbox = 진행 칸 말풍선이 넣는 #goal·#task 참조(n 이 바뀔 때마다 하나) — 채팅 입력칸과 같은 칩 줄, 보낼 때 withRefs 로 풀린다(2026-10-26 사용자 제보) */
function MiniChat({ o, name, head, say, draft = '', inbox, onBig, onClose }: { o: Session; name: string; head: React.ReactNode; say: (id: string, text: string) => Promise<void>; draft?: string; inbox?: { n: number; r: RefAsk }; onBig: () => void; onClose: () => void }) {
  const items = useChatItems(o.sessionId, 2500);
  const said = items.filter((it): it is Extract<typeof it, { kind: 'user' | 'assistant' }> => it.kind === 'user' || it.kind === 'assistant');
  const [text, setText] = useState(draft);
  const [refs, setRefs] = useState<ChatRef[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);
  // 같은 참조가 두 번 안 들어가게 — 받은 번호를 든다(StrictMode 효과 두 번에도)
  const took = useRef(0);
  useEffect(() => {
    if (!inbox || inbox.n <= took.current) return;
    took.current = inbox.n;
    const next = addRef(text, refs, inbox.r);
    setText(next.draft); setRefs(next.refs);
    requestAnimationFrame(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  }, [inbox?.n]); // eslint-disable-line react-hooks/exhaustive-deps -- 새 참조가 올 때만
  const dropRef = (label: string) => { setRefs((r) => r.filter((x) => x.label !== label)); setText((d) => d.replace(new RegExp(`${label}(?!\\d)\\s?`), '')); };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // 보낸 말 — 기록에 들어오기 전까지(참모가 일하는 중이면 줄 서 있다) 흐리게
  const [sent, setSent] = useState<string[]>([]);
  const waiting = sent.filter((t) => !said.some((it) => it.kind === 'user' && it.text.trim() === t));
  const list = useRef<HTMLDivElement>(null);
  // 긴 답은 목록 안에서 굴러간다(말풍선 높이 상한 없음, 2026-10-25 사용자 '긴 답 잘림'). 새 말이 오면 맨 아래, 칸보다 긴 새 답은 첫 줄부터(domain/homePop miniScroll)
  const lastText = said[said.length - 1]?.text;
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const rows = el.querySelectorAll<HTMLElement>('.hd-mini-row');
    const row = rows[rows.length - 1];
    el.scrollTop = miniScroll({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, last: row && { top: row.offsetTop, height: row.offsetHeight, reply: !row.classList.contains('me') } });
  }, [said.length, waiting.length, lastText]);
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    const out = withRefs(t, refs);
    setBusy(true); setErr('');
    try { await say(o.id, out); setSent((x) => [...x, out]); setText(''); setRefs([]); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  // 크게 열기 — 넣어 둔 칩은 그 참모 채팅 입력칸으로 따라간다(열리면 받는다)
  const big = () => { refs.forEach((r) => askRef(o.id, { kind: r.label.startsWith('#task') ? 'task' : 'goal', who: r.who, text: r.text })); onBig(); };
  return (
    <div className="hd-mini" role="dialog" aria-label={tr(`${name} 대화`, `Chat with ${name}`)}>
      <Head who={head} onBig={big} onClose={onClose} />
      <div className="hd-mini-list" ref={list}>
        {said.slice(-6).map((it) => (it.kind === 'user'
          ? <div key={it.id} className="hd-mini-row me"><div className="bubble me">{it.text}</div></div>
          : <div key={it.id} className="hd-mini-row"><div className="bubble md" dangerouslySetInnerHTML={{ __html: mdToHtml(it.text) }} /></div>))}
        {waiting.map((t, i) => <div key={`w${i}`} className="hd-mini-row me"><div className="bubble me pending">{t}</div></div>)}
        {!said.length && !waiting.length && <p className="hd-none">{tr('아직 대화 없음', 'No messages yet')}</p>}
      </div>
      {err && <p className="hd-mini-err">{err}</p>}
      {refs.length > 0 && (
        <div className="chat-refs">
          {refs.map((r) => (
            <span key={r.label} className="chat-ref" title={r.text}>
              <span className="at-chip">{r.label}</span><span className="dim">{r.who}</span><span className="q">{r.text.replace(/\s+/g, ' ')}</span>
              <IconButton size="s" tone="line" label={tr('빼기', 'Remove')} onClick={() => dropRef(r.label)}><IconClose /></IconButton>
            </span>
          ))}
        </div>
      )}
      <div className="hd-mini-in">
        <textarea ref={input} value={text} rows={1} autoFocus placeholder={tr(`${name}에게`, `To ${name}`)} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        <button className="hd-send" onClick={() => void send()} disabled={busy || !text.trim()} aria-label={tr('보내기', 'Send')} title={tr('보내기', 'Send')}><IconSend /></button>
      </div>
    </div>
  );
}

/** 세션 한눈 보기 — 오래 조용한 세션의 대화 끝 몇 줄(읽기만). 크게 열기 = 그 세션 화면, 맡긴 참모에게 묻기 = 그 참모 미니 대화 */
function Peek({ s, head, ask, onBig, onClose }: { s?: Session; head: React.ReactNode; ask?: { name: string; go: () => void }; onBig: () => void; onClose: () => void }) {
  const tail = tailLines(useChatItems(s?.sessionId, 4000), 5);
  return (
    <div className="hd-peek" role="dialog">
      <Head who={head} onBig={onBig} onClose={onClose} />
      <div className="hd-peek-tail">{tail.length ? tail.map((t, i) => <p key={i}>{t}</p>) : <p className="hd-none">{s ? tr('대화 없음', 'No messages') : tr('세션이 꺼졌어', 'Session is off')}</p>}</div>
      {ask && <div className="hd-peek-acts"><button className="hd-tbtn" onClick={ask.go}>{tr(`${ask.name}에게 묻기`, `Ask ${ask.name}`)}</button></div>}
    </div>
  );
}

/** 내 기기 — 이 맥 + 붙은 폰(최근 쓴 때) + 이어 둔 다른 기기. 홈이 떠 있는 동안 30초마다 */
function useDevices() {
  const [phones, setPhones] = useState<{ name: string; at: number }[]>([]);
  const [peers, setPeers] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let alive = true;
    const tick = () => {
      void mobileApi.status().then((s) => { if (alive) setPhones(phoneGroups(s.devices.filter((d) => !d.peer)).map((g) => ({ name: g.name, at: g.lastUsed }))); }, () => {});
      void remoteSaved().then((r) => { if (alive) setPeers(r); }, () => {});
    };
    tick();
    const stop = every(tick, 30_000);
    return () => { alive = false; stop(); };
  }, []);
  return { phones, peers };
}

const NO_PROJECTS: never[] = []; // 기본값은 모듈 상수로 — [] 는 그릴 때마다 새 배열이라 useMemo 가 매번 다시 돈다(stableDeps.test.ts)

export function HomeDash({ go, orchs, nameOf, roleOf, colorOf, lines, statusOf, off, starting, onResume, events, sessions, projects = NO_PROJECTS, asks, onAsks, running, usage, load, review = 0, office, say }: {
  go: HomeGo;
  orchs: Session[];
  nameOf: (s: { id: string; name: string }) => string;
  roleOf: (name: string) => string | undefined;
  colorOf: (name: string) => string;
  lines: Record<string, LiveLine>;
  statusOf: (s: Session) => ActivityStatus;
  off: StoppedSession[];
  starting: Set<string>;
  onResume: (s: StoppedSession) => void;
  events: TaskEvent[];
  sessions: Session[];
  /** 프로젝트 묶음(사이드바와 같은 groupByProject — 참모·도우미 밖) — 홈 '지금 돌아가는 프로젝트' 칸 */
  projects?: { name: string; sessions: Session[] }[];
  asks: HomeAsk[];
  /** 결정 대기함 열기 */
  onAsks: () => void;
  /** 일하는 프로젝트 세션 수 */
  running: number;
  usage?: Usage;
  load?: { load1: number; cores: number };
  /** 리뷰 — 머지 전에 볼 PR 수 */
  review?: number;
  /** 사무실 미리보기(작게) */
  office?: React.ReactNode;
  /** 참모에게 말하기 — 앱의 참모 보내기 길(스페이스 보내기와 같은 함수) */
  say: (id: string, text: string) => Promise<void>;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);
  const bars = useMemo(() => Object.fromEntries(orchs.map((o) => [o.id, goalBar({ events, sessions, orch: { id: o.id, name: o.name }, now, seen: new Set() })])), [orchs, events, sessions, now]);
  const d = homeDash({ orchs, bars, events, asks: asks.length, running, now });
  const tile = new Map(d.tiles.map((t) => [t.id, t]));
  const byId = new Map(orchs.map((o) => [o.id, o]));
  const devs = useDevices();
  // 지금 돌아가는 프로젝트(2026-10-25 사용자 시안 home-projects A) — 참모 줄 아래. 줄이 펼쳐지면 홈이 창 맞춤을 풀고 그 칸이 늘어난다
  const pr = useMemo(() => homeProjects({ groups: projects, sessions, events, orchIds: orchs.map((o) => o.id), statusOf, lineOf: (s) => lines[s.id]?.line, now }),
    [projects, sessions, events, orchs, lines, now]); // eslint-disable-line react-hooks/exhaustive-deps -- statusOf 는 lines 에서 나온다
  const [fold, onFold] = useProjFold();
  const [narrow, setNarrow] = useState(false);
  // 띄움 하나(domain/homePop) — Esc·바깥 누름으로 닫힘. 띄움 창·누른 칸은 data-hpop 이라 바깥이 아니다
  const [pop, setPop] = useState<HomePop>(null);
  const [draft, setDraft] = useState('');
  const [at, setAt] = useState('');
  const flip = (p: NonNullable<HomePop>, from = `${p.kind}:${p.id}`) => { if (p.kind === 'chat') go.touch?.(p.id); setDraft(''); setInbox(null); setAt(from); setPop((c) => flipPop(c, p)); };
  // 진행 칸 말풍선(#goal·#task) — 그 참모 미니 대화를 그 칸 아래 열고(떠 있으면 그대로) 입력칸에 칩. 참모 채팅 입력칸(askRef)은 홈에 없어 대기열에만 쌓였다(2026-10-26 사용자 제보)
  const [inbox, setInbox] = useState<{ id: string; n: number; r: RefAsk } | null>(null);
  const askIn = (id: string, r: RefAsk) => { go.touch?.(id); if (!isPop(pop, 'chat', id)) { setDraft(''); setAt(`gpc:${id}`); setPop({ kind: 'chat', id }); } setInbox((c) => ({ id, n: (c?.n ?? 0) + 1, r })); };
  useEffect(() => { if (pop?.kind !== 'chat') setInbox(null); }, [pop]);
  const close = () => setPop(null);
  const root = useRef<HTMLDivElement>(null);
  // 좁은 창(한 줄 쌓기)은 창 맞춤 없이 굴러간다
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 620));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = !narrow && !projGrown(fold, pr.live);
  useEffect(() => {
    if (!pop) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 홈 안 사무실 위에 창(세션·문서)이 떠 있으면 Esc 는 그 창 몫 — 창이 닫히고 사무실은 남는다(터미널 Esc 도 Claude 로)
      if (pop.kind === 'office' && root.current?.parentElement?.querySelector('.hd-office-big .osh')) return;
      e.stopPropagation(); setPop((c) => closeOnKey(c, e.key));
    };
    const down = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.('[data-hpop]')) setPop(null); };
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', down, true);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', down, true); };
  }, [pop]);
  const who = (o: Session) => <><b>{nameOf(o)}{roleOf(o.name) && <em> · {roleOf(o.name)}</em>}</b><span><D d={dotOf(statusOf(o), lines[o.id])} />{lines[o.id]?.line || tr('쉼', 'Idle')}</span></>;
  const chatOrch = pop?.kind === 'chat' ? byId.get(pop.id) : undefined;
  const peekRow = pop?.kind === 'peek' ? d.quiet.find((q) => q.task === pop.id) : undefined;
  const fnKey = pop?.kind === 'fn' ? (pop.id as FeatureKey) : undefined;
  const officeOpen = pop?.kind === 'office' && !!go.officeBig;
  const face = (s: { name: string }, size: number, state: Parameters<typeof OrchAvatar>[0]['state'] = 'rest') => <OrchAvatar name={s.name} size={size} state={state} color={colorOf(s.name)} label={nameOf({ id: '', name: s.name })} />;
  const five = usage?.five;
  const used = five ? 100 - five.left : null;
  const ring = (pct: number) => { const r = 14, c = 2 * Math.PI * r; return <svg className="hd-ring" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r={r} /><circle cx="17" cy="17" r={r} className="v" strokeDasharray={`${(c * pct) / 100} ${c}`} /></svg>; };
  const tools: { k: FeatureKey; name: string; icon: React.ReactNode; n?: number }[] = [
    { k: 'r:', name: tr('예약', 'Scheduled'), icon: <IconCalendarClock /> },
    { k: 'rp:', name: tr('하루 리플레이', 'Day replay'), icon: <IconReplay /> },
    { k: 't:', name: tr('도구', 'Tools'), icon: <IconTools /> },
    { k: 'h:', name: tr('하니터', 'Harnitor'), icon: <IconHarness /> },
    { k: 'rv:', name: tr('리뷰', 'Review'), icon: <IconReview />, n: review },
  ];

  return (
    <div className="cv-dash hd-wrap">
    <div className={`hd${fit ? ' fit' : ''}`} ref={root} aria-label={tr('홈', 'Home')}>
      <header className="hd-top">
        <h1>{tr('홈', 'Home')}</h1>
        <div className="hd-stats">
          <button className="hd-stat" data-hpop="" onClick={() => (asks[0]?.open ? flip({ kind: 'ask', id: asks[0].key }) : onAsks())} disabled={!asks.length}><D d="ask" /><b>{d.counts.asks}</b><span>{tr('결정 대기', 'Decisions')}</span></button>
          <div className="hd-stat"><D d="run" /><b>{d.counts.running}</b><span>{tr('일하는 세션', 'Working')}</span></div>
          <button className="hd-stat" data-hpop="" onClick={() => d.quiet[0] && flip({ kind: 'peek', id: d.quiet[0].task })} disabled={!d.quiet.length}><D d="quiet" /><b>{d.counts.quiet}</b><span>{tr('오래 조용', 'Quiet')}</span></button>
          <button className="hd-stat" data-hpop="" onClick={() => (d.done[0] ? flip({ kind: 'done', id: d.done[0].task }) : go.feature('rp:'))}><D d="done" /><b>{d.counts.doneToday}</b><span>{tr('오늘 끝남', 'Done today')}</span></button>
        </div>
        <span className="hd-sp" />
        {load && (
          <div className="hd-meter" title={tr(`${machine()} 부하 ${load.load1.toFixed(1)} · 코어 ${load.cores}`, `Load ${load.load1.toFixed(1)} · ${load.cores} cores`)}>
            <span>{tr(`${machine()} 부하`, 'Load')}</span><span className="hd-bar"><i style={{ width: `${Math.min(100, (load.load1 / Math.max(1, load.cores)) * 100)}%` }} /></span><b>{load.load1.toFixed(1)}</b>
          </div>
        )}
        {used !== null && <div className="hd-acct" title={tr('계정 5시간 창 쓴 양', 'Account 5-hour window used')}>{ring(used)}<b>{used}%</b></div>}
      </header>

      <div className="hd-cols">
        <div className="hd-col hd-colL">
          <section className="hd-card hd-a-orch" aria-label={tr(assistant(), 'Assistants')}>
            <div className="hd-h"><b>{assistant()}</b><span>{orchs.length}</span></div>
            <div className="hd-otiles">
              {orchs.map((o) => {
                const l = lines[o.id];
                const t = tile.get(o.id);
                const nm = nameOf(o);
                return (
                  <button key={o.id} className={`hd-otile${isPop(pop, 'chat', o.id) ? ' on' : ''}`} data-hpop="" data-pop={`chat:${o.id}`} aria-expanded={isPop(pop, 'chat', o.id)}
                    onClick={() => flip({ kind: 'chat', id: o.id })} title={tr(`${nm}에게 말하기`, `Talk to ${nm}`)}>
                    {face(o, 32, avatarState(o, statusOf(o)))}
                    <span className="hd-tx"><b>{nm}{roleOf(o.name) && <em> · {roleOf(o.name)}</em>}</b><span><D d={dotOf(statusOf(o), l)} />{l?.line || tr('쉼', 'Idle')}</span></span>
                    <span className="hd-n">
                      {!!t?.run && <span title={tr('일하는 칸', 'Working')}><D d="run" />{t.run}</span>}
                      {!!t?.ask && <span title={tr('답 기다림', 'Waiting for you')}><D d="ask" />{t.ask}</span>}
                      {!!t?.quiet && <span title={tr('오래 조용', 'Quiet')}><D d="quiet" />{t.quiet}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            {off.length > 0 && (
              <div className="hd-shelf">
                <div className="hd-h"><b>{tr(`쉬는 ${assistant()}`, 'Resting')}</b><span>{off.length}</span></div>
                <div className="hd-shelf-row">
                  {off.map((x) => {
                    const nm = nameOf(x) || x.name;
                    const busy = starting.has(x.sessionId);
                    return (
                      <button key={x.sessionId} className="hd-sleep" disabled={busy} onClick={() => onResume(x)} aria-label={tr(`${nm} 깨우기`, `Resume ${nm}`)} title={tr(`${nm} — 누르면 깨움`, `${nm} — click to resume`)}>
                        <OrchAvatar name={x.name} size={28} state="off" phase={busy ? 'starting' : undefined} color={colorOf(x.name)} label={nm} />
                        <span>{roleOf(x.name) ?? nm}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
          <HomeProjects rows={pr.live} done={pr.done} fold={fold} onFold={onFold} fit={fit} now={now}
            orchName={(id) => { const o = byId.get(id); return o && nameOf(o); }} face={(id, size) => { const o = byId.get(id); return o ? face(o, size) : null; }}
            onAsk={(id, from) => flip({ kind: 'chat', id }, from)} onBig={(t) => go.session(t)} />
          <section className="hd-a-gp" aria-label={tr('진행', 'Progress')}>
            {orchs.filter((o) => bars[o.id]?.goals.length).map((o) => (
              <div key={o.id} className="hd-gpcell" data-pop={`gpc:${o.id}`}>
                <button className="hd-gpwho" data-hpop="" data-pop={`gp:${o.id}`} onClick={() => flip({ kind: 'chat', id: o.id }, `gp:${o.id}`)}>{face(o, 18)}{nameOf(o)}</button>
                <HomeProgress orch={{ id: o.id, name: o.name }} events={events} sessions={sessions} onAsk={(r) => askIn(o.id, r)} place="dash" />
              </div>
            ))}
          </section>
          <section className="hd-card hd-a-done" aria-label={tr('오늘 끝난 것', 'Done today')}>
            <div className="hd-h"><b>{tr('오늘 끝난 것', 'Done today')}</b><span>{d.done.length}</span></div>
            {d.done.length ? (
              <div className="hd-chips">
                {d.done.slice(0, 12).map((x) => {
                  const o = x.orch ? byId.get(x.orch) : undefined;
                  return (
                    <button key={x.task} className={`hd-chip${isPop(pop, 'done', x.task) ? ' on' : ''}`} data-hpop="" aria-expanded={isPop(pop, 'done', x.task)} onClick={() => flip({ kind: 'done', id: x.task })} title={`${seenName(x.target)} · ${x.title}`}>
                      {o && face(o, 16)}<b>{x.title || seenName(x.target)}</b><span>{new Date(x.at).toTimeString().slice(0, 5)}</span>
                    </button>
                  );
                })}
              </div>
            ) : <p className="hd-none">{tr('아직 없음', 'Nothing yet')}</p>}
            {pop?.kind === 'done' && (() => {
              const x = d.done.find((r) => r.task === pop.id);
              if (!x) return null;
              return (
                <div className="hd-donex" data-hpop="">
                  <span className="hd-tx"><b>{x.title || seenName(x.target)}</b><span>{[seenName(x.target), x.orch ? nameOf(byId.get(x.orch)!) : '', new Date(x.at).toTimeString().slice(0, 5)].filter(Boolean).join(' · ')}</span>{x.result && <p>{x.result}</p>}</span>
                  <button className="hd-ic" onClick={() => go.session(x.target)} aria-label={tr('크게 열기', 'Open large')} title={tr('크게 열기', 'Open large')}><IconMaximize /></button>
                </div>
              );
            })()}
          </section>
        </div>
        <div className="hd-col hd-colR">
          <section className="hd-card hd-a-ask" aria-label={tr('결정 대기', 'Decisions')}>
            <div className="hd-h"><b>{tr('결정 대기', 'Decisions')}</b><span>{asks.length}</span></div>
            {asks.length ? (
              <div className="hd-asks">
                {asks.slice(0, 5).map((a) => (
                  <div key={a.key} className={`hd-askcell${isPop(pop, 'ask', a.key) ? ' on' : ''}`} data-hpop="">
                    <button className={`hd-ask ${a.pay ? 'pay' : ''}`} aria-expanded={isPop(pop, 'ask', a.key)} onClick={() => (a.open ? flip({ kind: 'ask', id: a.key }) : onAsks())}>
                      {a.who ? face(a.who, 22, 'ask') : <D d="ask" />}
                      <span className="hd-tx"><b>{a.text}</b><span>{a.where}</span></span>
                      {a.pay && <em>{tr('결제', 'Payment')}</em>}
                    </button>
                    {isPop(pop, 'ask', a.key) && a.open && <div className="hd-askx">{a.open()}</div>}
                  </div>
                ))}
              </div>
            ) : <p className="hd-none">{tr('없음', 'None')}</p>}
            {d.quiet.length > 0 && (
              <>
                <div className="hd-h"><b>{tr('오래 조용', 'Quiet')}</b><span>{d.quiet.length}</span></div>
                {d.quiet.slice(0, 4).map((q) => (
                  <button key={q.task} className={`hd-quiet${isPop(pop, 'peek', q.task) ? ' on' : ''}`} data-hpop="" data-pop={`peek:${q.task}`} aria-expanded={isPop(pop, 'peek', q.task)} onClick={() => flip({ kind: 'peek', id: q.task })} title={q.title}>
                    <D d="quiet" /><b>{seenName(q.target)}</b><span>{q.title}{q.at ? ` · ${whenLabel(q.at, now)}` : ''}</span>
                  </button>
                ))}
              </>
            )}
          </section>
          <section className="hd-card hd-a-dev" aria-label={tr('기기', 'Devices')}>
            <div className="hd-h"><b>{tr('기기', 'Devices')}</b></div>
            <div className="hd-devs">
              <div className="hd-dev"><D d="run" /><b>{tr('이 컴퓨터', 'This computer')}</b><span>{tr('여기', 'Here')}</span></div>
              {devs.phones.map((p) => <div key={`p:${p.name}:${p.at}`} className="hd-dev"><D d={now - p.at < 10 * 60_000 ? 'run' : 'rest'} /><b>{p.name}</b><span>{whenLabel(p.at, now)}</span></div>)}
              {devs.peers.map((p) => <div key={`r:${p.id}`} className="hd-dev"><D d="rest" /><b>{p.name}</b><span>{tr('이어 둠', 'Paired')}</span></div>)}
            </div>
            <div className="hd-tools" role="group" aria-label={tr('기능', 'Features')}>
              {tools.map((t) => (
                <button key={t.k} className={`hd-tool${isPop(pop, 'fn', t.k) ? ' on' : ''}`} data-hpop="" aria-expanded={isPop(pop, 'fn', t.k)} onClick={() => (go.fnPane ? flip({ kind: 'fn', id: t.k }) : go.feature(t.k))} aria-label={t.n ? tr(`${t.name}, 볼 것 ${t.n}`, `${t.name}, ${t.n} to check`) : t.name} title={t.name}>
                  {t.icon}{!!t.n && <b className="hd-badge">{t.n}</b>}
                </button>
              ))}
            </div>
          </section>
          {office && go.office && (
            // 미리보기는 못 누르게(inert) 깔고 그 위를 덮는 단추 하나 — 누르면 홈 안에서 사무실 크게(참모 탭으로 안 넘어감, 2026-10-25 사용자)
            <section className="hd-card hd-a-office" aria-label={tr('사무실', 'Office')}>
              <div className="hd-office-in" inert aria-hidden="true">{office}</div>
              <button className="hd-office-go" data-hpop="" aria-expanded={officeOpen} onClick={() => (go.officeBig ? flip({ kind: 'office', id: '' }) : go.office?.())} aria-label={tr('사무실 열기', 'Open the office')} title={tr('사무실', 'Office')}><span className="hd-office-tag"><IconOffice /></span></button>
            </section>
          )}
        </div>
      </div>
      {chatOrch && (
        <Anchored root={root} at={at} w={380}>
          <MiniChat key={chatOrch.id} o={chatOrch} name={nameOf(chatOrch)} head={who(chatOrch)} say={(id, t) => { go.touch?.(id); return say(id, t); }} draft={draft} inbox={inbox?.id === chatOrch.id ? inbox : undefined} onBig={() => { close(); go.orch(chatOrch.id); }} onClose={close} />
        </Anchored>
      )}
      {peekRow && (() => {
        const s = findTarget(sessions, peekRow.target);
        const o = byId.get(peekRow.orch);
        return (
          <Anchored root={root} at={at} w={400} side="right">
            <Peek key={peekRow.task} s={s} head={<><b>{seenName(peekRow.target)}</b><span><D d="quiet" />{[peekRow.title, peekRow.at ? whenLabel(peekRow.at, now) : ''].filter(Boolean).join(' · ')}</span></>}
              ask={o ? { name: nameOf(o), go: () => { flip({ kind: 'chat', id: o.id }); setDraft(tr(`${peekRow.target} 오래 조용한데 어떻게 돼 가?`, `${peekRow.target} has been quiet — how is it going?`)); } } : undefined}
              onBig={() => { close(); go.session(peekRow.target); }} onClose={close} />
          </Anchored>
        );
      })()}
    </div>
    {officeOpen && (
      // 홈 안 사무실 — 홈 칸을 덮고 닫으면 홈 그대로. '크게 열기' = 예전 길(참모 탭 사무실)
      <section className="hd-office-big" data-hpop="" aria-label={tr('사무실', 'Office')}>
        <Head who={<b>{tr('사무실', 'Office')}</b>} onBig={() => { close(); go.office?.(); }} onClose={close} />
        <div className="hd-office-big-in">{go.officeBig?.(close)}</div>
      </section>
    )}
    {fnKey && go.fnPane && (
      <aside className="hd-drawer" data-hpop="" aria-label={tools.find((t) => t.k === fnKey)?.name}>
        <Head who={<b>{tools.find((t) => t.k === fnKey)?.name}</b>} onBig={() => { close(); go.feature(fnKey); }} onClose={close} />
        <div className="hd-drawer-in">{go.fnPane?.(fnKey, close)}</div>
      </aside>
    )}
    </div>
  );
}
