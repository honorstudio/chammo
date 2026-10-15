// 바닥 — 지금 참모의 대시보드(폰 홈·보관함 v1, 사용자 10/11 "추천대로"): 머리줄 · 홈 | 보관함 두 칸(데스크톱 나무 맨 위 두 줄과 같은 것).
// 홈 = 나한테 필요 · 세션 줄(누르면 그 자리에서 마지막 세 줄) · 모드 카드 · 할 일·결정 한 줄 / 보관함 = 진행 중 칩 · 내 폴더 · 기록(PhoneLocker)
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { attachFile, lockerAdd, readAccounts, readFileText, readLoad, readLocker, readUsage } from '../../data/web';
import { feedLoad } from '../calm';
import { EMPTY_LOCKER } from '../../domain/locker';
import { PhoneLocker } from './PhoneLocker';
import { accountHead, headLeft, headUsage, readPhoneAccounts } from '../../domain/phoneAccounts';
import { usageLevel } from '../../domain/usage';
import { AccountSheet } from './AccountSheet';
import { LoadSheet } from './LoadSheet';
import { PhoneLoginCard } from './PhoneLogin';
import { loadChip, readPhoneLoad } from '../../domain/phoneLoad';
import { starterLists } from '../../domain/starterLists';
import type { Ctx } from '../../domain/ctx';
import { dashFiles, type DashFile } from '../../domain/dashboard';
import { dashList, type NeedRow } from '../../domain/dashList';
import type { DirectCard } from '../../domain/directAsk';
import { heldIds, orchTasks, phoneName, subStatus, type Waiting } from '../../domain/mobile';
import { summarizeTranscript } from '../../domain/activity';
import { peekLines, phoneChips } from '../../domain/phoneLocker';
import { projectsOf } from '../../domain/locker';
import type { Session } from '../../domain/session';
import type { TaskEvent } from '../../domain/tasks';
import type { ChatItem } from '../../domain/chat';
import { findTarget } from '../../domain/inbox';
import { FileView } from './FileView';
import { SessionPeek } from './SessionPeek';
import { BrowserView } from './BrowserView';
import { liveOf, type Live } from '../../domain/agentBrowser';
import { IconBell, IconBellOff, IconCalendarClock, IconChevron, IconSessions } from '../Icons';
import type { Push } from './usePush';
import { HomeAppLink } from './HomeAppLink';
import { PhoneModes } from './PhoneModes';
import { MAvatar } from './MAvatar';
import { UsageRing } from './kit';
import { ProfileSheet } from './ProfileSheet';
import { usePendingNicks } from './pendingNicks';
import { useSubTails } from './useSubTails';
import { useMemoPoll } from './usePoll';
import { Notice } from './Notice';
import { machine } from '../../i18n';

const baseName = (p: string) => (p.startsWith('data:') ? '붙인 그림' : p.split('/').pop() ?? p);
/** 위 칸 = 한 칸 목록(시안 docs/design-drafts/phone-tabs v2 A, 2026-10-11 사용자 — 탭 숫자 '일 6 · 할 일 6 · 결정 2'는 뜻을 몰랐다).
 *  사용자가 묻는 순서로: 나한테 필요(참모 색 옅은 면, 있을 때만) → 도는 일(점·이름·한 줄 3개 +N) · 오늘 끝남 한 줄 → 다음 할 일 문서 줄.
 *  늘 보이는 칸이라 하위 세션 꼬리(useSubTails, 15초)로 세션판·데스크톱과 같은 판단을 넣는다 */
function TopList({ orch, events, sessions, waiting, direct, todo, onPeek, onPicker, onChat, onTodo, modes }: {
  orch: Session; events: TaskEvent[]; sessions: Session[]; waiting: Waiting[]; direct: DirectCard[]; todo: { todo: number; decisions: number };
  onPeek: (s: Session) => void; onPicker: () => void; onChat: () => void; onTodo: () => void;
  /** 모드 카드(세션 줄 아래, 할 일·결정 위) */
  modes?: ReactNode;
}) {
  const now = Date.now();
  const targets = useMemo(() => { const g = orchTasks(events, sessions, orch.id, now); return [...g.ask, ...g.doing].map((t) => findTarget(sessions, t.target)).filter((x): x is Session => !!x); }, [events, sessions, orch.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const tails = useSubTails(targets);
  const groups = orchTasks(events, sessions, orch.id, now, (c) => { const s = findTarget(sessions, c.target); return s ? subStatus(s, tails, now) : undefined; });
  const l = dashList(groups, waiting, direct, events, orch.id, (id) => sessions.find((x) => x.id === id)?.name ?? id);
  const peek = (target?: string) => { const s = target ? findTarget(sessions, target) : undefined; if (s) onPeek(s); };
  const open = (r: NeedRow) => (r.kind === 'sub' ? peek(r.target) : r.kind === 'decide' ? onPicker() : onChat());
  const empty = !l.need.length && !l.run.length && !l.done.n;
  // 세션 줄 그 자리 펼침(폰 홈·보관함 v1 3) — 마지막 세 줄(시킨 말·하는 일·답 첫마디) + 대화 보기
  const [open_, setOpen] = useState<string | null>(null);
  const linesOf = (target: string) => { const sid = findTarget(sessions, target)?.sessionId; return sid && tails[sid] ? peekLines(summarizeTranscript(tails[sid]!)) : []; };
  return (
    <div className="m-top">
      {l.need.length > 0 && (
        <div className="m-need" role="list" aria-label="나한테 필요">
          {l.need.map((r) => (
            <button key={r.key} type="button" role="listitem" className="m-lrow" onClick={() => open(r)} aria-label={`${r.name} — ${r.line}`}>
              <span className="m-ask-dot" aria-hidden="true" /><b>{r.name}</b><span className="m-lrow-line">{r.line}</span><IconChevron />
            </button>
          ))}
        </div>
      )}
      {(l.run.length > 0 || l.done.n > 0) && (
        <div className="m-runcard">
          {l.run.map((r) => {
            const on = open_ === r.key;
            const lines = on ? linesOf(r.target) : [];
            return (
              <div key={r.key} className={on ? 'm-srow m-on' : 'm-srow'}>
                <button type="button" className="m-lrow" onClick={() => setOpen(on ? null : r.key)} aria-expanded={on} aria-label={`${r.name} — ${r.dot === 'st-work' ? '일하는 중' : '쉬는 중'} · ${on ? '접기' : '펼치기'}`}>
                  <span className={`st-dot ${r.dot}`} aria-hidden="true" /><b>{r.name}</b><span className="m-lrow-line">{r.line}</span><IconChevron />
                </button>
                {on && (
                  <div className="m-speek">
                    {lines.length ? lines.map((x, i) => <div key={i} className={`m-speek-l w-${x.who}`}>{x.text}</div>) : <div className="m-speek-l w-tool">아직 읽은 대화가 없어요</div>}
                    <button type="button" className="m-btn m-speek-go" onClick={() => peek(r.target)}>대화 보기</button>
                  </div>
                )}
              </div>
            );
          })}
          {l.more > 0 && <div className="m-lmore">+{l.more}</div>}
          {l.done.n > 0 && (
            <div className="m-ldone"><span className="st-dot st-done" aria-hidden="true" /><span className="m-lrow-line">오늘 끝남 {l.done.n} · {l.done.names.join(', ')}{l.done.n > 2 ? ` +${l.done.n - 2}` : ''}</span></div>
          )}
        </div>
      )}
      {empty && <p className="m-muted m-sm">아직 시킨 일이 없어요</p>}
      {modes}
      {(todo.todo > 0 || todo.decisions > 0) && (
        <button type="button" className="m-lnext m-todo" onClick={onTodo} aria-label={`할 일 ${todo.todo} · 최근 결정 ${todo.decisions} — 문서 보기`}>
          <span>할 일 <b>{todo.todo}</b></span><i aria-hidden="true" /><span>최근 결정 <b>{todo.decisions}</b></span><IconChevron />
        </button>
      )}
    </div>
  );
}

type Props = {
  orch: Session;
  orchs: Session[];
  /** 사용자 답을 기다리는 중 — 프사가 물음 표정 */
  asking: boolean;
  sessions: Session[];
  ctx: Record<string, Ctx>;
  items: ChatItem[];
  events: TaskEvent[];
  routinesRunning: number;
  onRoutines: () => void;
  /** 세션 판 — 하위 세션 목록·대화 보기 */
  onSessions: () => void;
  /** HQ 폴더 — docs/starter.md 의 할 일·최근 결정(데스크톱 대시보드 목록과 같은 것) */
  hqDir: string;
  /** 설정 목소리(Supertonic 일 때만) — 프로필 창 '기본' 목소리, null 이면 목소리 칸을 안 보인다 */
  voiceBase: string | null;
  /** scripts/show 기록(/api/shows) — 채팅 안 파일 카드와 같이 OrchSpace 가 한 번 받아 나눠 준다. loaded = 한 번이라도 받았나 */
  showLog: string;
  showLoaded: boolean;
  /** 떠 있는 세션 브라우저 — 이 참모 것이면 대시보드 위에, 하위 세션 것은 그 세션 대화 위에 */
  lives: Live[];
  /** 폰 알림(웹 푸시) 켜기·끄기 */
  push: Push;
  /** 위 칸 '나한테 필요' — 사용자 답을 기다리는 것(waitingList)·이 참모 몫 직접 답하기 카드 */
  waiting: Waiting[];
  direct: DirectCard[];
  /** 참모가 물은 일(task ask)을 누르면 답하는 곳(참모 바꾸기 '답을 기다림'), 직접 답하기 카드를 누르면 채팅 시트 */
  onPicker: () => void;
  onChat: () => void;
  /** 모드 맛보기 '말로 만들기' — 참모에게 보낸다 */
  onAsk: (text: string) => void;
};

const PUSH_HINT: Record<string, string> = {
  'need-home': '아이폰은 홈 화면에 추가한 앱에서만 알림을 받아요 — 사파리 공유 → 홈 화면에 추가한 뒤, 아래 \'홈 화면 앱 연결\' 코드를 그 앱에 붙여 넣어요',
  denied: '알림이 막혀 있어요 — 설정 > 알림에서 참모를 허용해 주세요',
};

/** 홈 | 보관함 — 참모마다 마지막에 본 칸(데스크톱 1 '마지막에 본 줄'과 같은 규칙), 처음은 홈 */
const TAB_KEY = 'm.dashTab';
const loadTab = (id: string): 'home' | 'locker' => { try { return (JSON.parse(localStorage.getItem(TAB_KEY) ?? '{}') as Record<string, string>)[id] === 'locker' ? 'locker' : 'home'; } catch { return 'home'; } };

export function OrchDash({ orch, orchs, asking, sessions, events, routinesRunning, onRoutines, onSessions, hqDir, voiceBase, lives, push, showLog, waiting, direct, onPicker, onChat, onAsk }: Props) {
  const [pushHint, setPushHint] = useState<string | null>(null);
  // 켜진 종을 누르면 바로 끄지 않고 묻는다 — 상태 표시로 보고 눌렀다가 꺼졌다(2026-10-03 18:54)
  const [askOff, setAskOff] = useState(false);
  const bell = () => (push.can !== 'ok' ? setPushHint(PUSH_HINT[push.can] ?? '이 브라우저는 알림을 못 받아요') : push.on ? setAskOff(true) : push.enable());
  const myBrowser = liveOf(orch, lives);
  // HQ starter 의 할 일·최근 결정 — 30초마다(서버 허용 집합에 HQ starter 가 있다)
  const [starter] = useMemoPoll(`starter:${hqDir}`, () => readFileText(`${hqDir}/docs/starter.md`).catch(() => ''), 30_000, '', [hqDir]);
  const plan = useMemo(() => starterLists(starter, 50), [starter]);
  const [tab, setTabState] = useState<'home' | 'locker'>(() => loadTab(orch.id));
  useEffect(() => setTabState(loadTab(orch.id)), [orch.id]);
  const setTab = (t: 'home' | 'locker') => { setTabState(t); try { localStorage.setItem(TAB_KEY, JSON.stringify({ ...(JSON.parse(localStorage.getItem(TAB_KEY) ?? '{}') as object), [orch.id]: t })); } catch { /* 이번 실행만 */ } };
  const [peek, setPeek] = useState<Session | null>(null);
  const busySubs = sessions.filter((s) => s.kind === 'background' && !orchs.some((o) => o.id === s.id) && (s.state === 'working' || s.state === 'blocked')).length;
  // 화면을 오가도 마지막 값을 바로 — 뒤에서 새로 받는다(ui/mobile/memo). 파일 칸은 한 번도 못 받았을 때만 뼈대
  const [usage] = useMemoPoll('usage', readUsage, 30_000, '{}');
  // 계정 칸(이름·사용량) — 머리줄 계정 이름, 누르면 계정 시트. 바꾼 직후엔 맥 답을 먼저 보이고 다음 받기에 맞춘다
  const [acctText] = useMemoPoll('accounts', () => readAccounts(), 30_000, '');
  const [acctNow, setAcctNow] = useState<string | null>(null);
  useEffect(() => { setAcctNow(null); }, [acctText]);
  const acct = acctNow ?? acctText;
  const [acctOpen, setAcctOpen] = useState(false);
  // 맥 부하 — 머리줄 칩(점 + 1분 부하), 누르면 시트. 앱이 10초마다 적으니 15초마다
  const [loadText] = useMemoPoll('load', () => readLoad(), 15_000, '');
  const [loadNow, setLoadNow] = useState<string | null>(null);
  useEffect(() => { setLoadNow(null); }, [loadText]);
  const [loadOpen, setLoadOpen] = useState(false);
  const phoneLoad = readPhoneLoad(loadNow ?? loadText);
  const chip = loadChip(phoneLoad);
  // 맥이 바쁘면 폰도 애니메이션을 줄인다 — 맥과 같은 판단(ui/calm), 이미 받는 /api/load 그대로. 맥 앱이 멈춰 오래된 값이면 모름으로
  useEffect(() => { feedLoad(phoneLoad && phoneLoad.level !== 'unknown' && !phoneLoad.stale ? { load1: phoneLoad.load1, cores: phoneLoad.cores } : null); }, [loadNow ?? loadText]); // eslint-disable-line react-hooks/exhaustive-deps
  const [todoOpen, setTodoOpen] = useState(false); // '다음 할 일' — HQ starter 문서
  const [view, setView] = useState<DashFile | null>(null);
  const now = Date.now();
  const held = useMemo(() => heldIds(events, sessions, orch.id, now), [events, sessions, orch.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // 보관함 — 서버가 폰에 열 수 있는 것만 준다(phone_view). 기록 = 이 참모·맡긴 세션이 보여 준 것 + 보관함 맨 위 낱 파일(데스크톱 lockerLog 와 같다)
  const [lockerView, , kickLocker] = useMemoPoll('locker', () => readLocker().catch(() => EMPTY_LOCKER), 20_000, EMPTY_LOCKER);
  const owner = orch.name || orch.id;
  const shown = useMemo(() => dashFiles(showLog, orch.id, held, []), [showLog, orch.id, held]);
  const projects = useMemo(() => projectsOf(sessions.map((s) => s.cwd), hqDir), [sessions, hqDir]);
  const chips = useMemo(() => phoneChips(sessions, held, hqDir, (s) => (s.state === 'working' ? 'working' : s.state === 'blocked' ? 'blocked' : 'idle')), [sessions, held, hqDir]);
  const who = (by: string) => {
    if (by === 'me') return '나';
    const s = sessions.find((x) => x.id === by);
    return orchs.some((o) => o.id === by) ? phoneName(s?.name ?? by, orchs) : `${s?.name ?? by} 세션`;
  };
  const upload = async (list: FileList) => {
    const out: string[] = [];
    for (const f of Array.from(list)) out.push((await lockerAdd(owner, (await attachFile(f)).path)).path);
    return out;
  };
  const acctView = readPhoneAccounts(acct);
  const usageLine = headUsage(acctView, usage, now);
  const head = accountHead(acctView);
  const left = headLeft(acctView, usage, now);
  const [profile, setProfile] = useState(false); // 머리 아바타 → 프로필 창(이름 바꾸기)
  const title = usePendingNicks(orchs).nameOf(orch);

  return (
    <div className="m-dash">
      <header className="m-dash-head">
        {/* 한 줄 머리(시안 phone-dash H2) — 부하 = 이름 밑 점+숫자, 계정 = 남은 양 고리 버튼. 컨텍스트 고리는 입력창 참모 프사로 옮겼다(v2 A, 2026-10-11 사용자 "거슬림") */}
        <div className="m-dash-row">
          <button type="button" className="m-dash-av" onClick={() => setProfile(true)}
            aria-label={`${title} 프로필`} title="프로필">
            <MAvatar orch={orch} orchs={orchs} size={36} asking={asking} />
          </button>
          <div className="m-dash-tt">
            <div className="m-dash-title">{title}</div>
            {chip && (
              <button type="button" className={`m-load-chip m-load-sub ${chip.cls}`} onClick={() => setLoadOpen(true)} aria-label={`${chip.aria} — 부하 보기`} title={`${machine()} 부하`}>
                <span className="m-load-pill"><span className="m-load-dot" aria-hidden="true" />{chip.text}</span>
              </button>
            )}
          </div>
          {left !== null && (
            <button type="button" className="m-acct-ring" onClick={() => setAcctOpen(true)} aria-label={`계정${head ? ` ${head}` : ''} — 남은 양 ${left}%${usageLine ? ` (${usageLine})` : ''} — 계정 보기`} title={head ?? '계정'}>
              <UsageRing left={left} level={usageLevel(left)} />
            </button>
          )}
          {push.can !== 'unsupported' && (
            <button type="button" className={push.on ? 'm-rt-btn m-ico m-bell m-on' : 'm-rt-btn m-ico m-bell'} disabled={push.busy} onClick={bell}
              aria-label={push.on ? '폰 알림 켜짐 — 끄기' : '폰 알림 꺼짐 — 켜기'} aria-pressed={push.on} title={push.on ? '폰 알림 켜짐' : '폰 알림 꺼짐'}>
              {push.on ? <IconBell /> : <IconBellOff />}
            </button>
          )}
          <button type="button" className="m-rt-btn m-ico" onClick={onSessions} aria-label={`세션${busySubs > 0 ? ` — 일하거나 묻는 세션 ${busySubs}` : ''}`} title="세션">
            <IconSessions />{busySubs > 0 && <span className="m-rt-n">{busySubs}</span>}
          </button>
          <button type="button" className="m-rt-btn m-ico" onClick={onRoutines} aria-label={`예약${routinesRunning > 0 ? ` — 도는 중 ${routinesRunning}` : ''}`} title="예약">
            <IconCalendarClock />{routinesRunning > 0 && <span className="m-rt-n">{routinesRunning}</span>}
          </button>
        </div>
      </header>
      <PhoneLoginCard />
      {/* 알림 종 안내·오류 — 가운데 알림 모달. 홈 화면 앱 안내는 연결 버튼이 붙어 사람이 닫을 때까지 */}
      {(pushHint || push.error) && (
        <Notice text={push.error ?? pushHint ?? ''} error={!!push.error} onClose={() => { setPushHint(null); push.setError(null); }}>
          {!push.error && push.can === 'need-home' && <HomeAppLink />}
        </Notice>
      )}
      {askOff && (
        <div className="m-confirm" role="alertdialog" aria-label="폰 알림 끄기 확인">
          <div>폰 알림을 끌까요? 참모가 물어도 폰에 안 와요.</div>
          <div className="m-new-row">
            <button type="button" className="m-btn" onClick={() => setAskOff(false)}>취소</button>
            <button type="button" className="m-send" onClick={() => { setAskOff(false); push.disable(); }}>끄기</button>
          </div>
        </div>
      )}

      {myBrowser && <BrowserView live={myBrowser} />}

      <div className="m-dash-tabs" role="tablist" aria-label="홈·보관함">
        <button type="button" role="tab" aria-selected={tab === 'home'} className={tab === 'home' ? 'm-on' : ''} onClick={() => setTab('home')}>홈</button>
        <button type="button" role="tab" aria-selected={tab === 'locker'} className={tab === 'locker' ? 'm-on' : ''} onClick={() => setTab('locker')}>보관함</button>
      </div>

      {tab === 'home' ? (
        <>
          <TopList orch={orch} events={events} sessions={sessions} waiting={waiting} direct={direct} todo={{ todo: plan.todo.length, decisions: plan.decisions.length }}
            onPeek={setPeek} onPicker={onPicker} onChat={onChat} onTodo={() => setTodoOpen(true)} modes={<PhoneModes keys={[orch.name, orch.id, orch.sessionId ?? '']} dash={owner} onAsk={onAsk} />} />
        </>
      ) : (
        <PhoneLocker owner={owner} view={lockerView} shown={shown} projects={projects} chips={chips} whoOf={who} onReload={kickLocker} onUpload={upload}
          onOpen={(path, name) => setView({ path, ts: '', by: 'me', name, ...((p) => (p ? { at: p } : {}))(shown.find((f) => f.path === path)?.at) })} />
      )}
      {acctOpen && <AccountSheet text={acct} onChanged={setAcctNow} onClose={() => setAcctOpen(false)} />}
      {loadOpen && <LoadSheet text={loadNow ?? loadText} onChanged={setLoadNow} onClose={() => setLoadOpen(false)} />}
      {profile && <ProfileSheet orch={orch} orchs={orchs} voiceBase={voiceBase} onClose={() => setProfile(false)} />}
      {peek && <SessionPeek s={peek} lives={lives} onClose={() => setPeek(null)} />}
      {todoOpen && <FileView path={`${hqDir}/docs/starter.md`} title="다음 할 일" at={{ find: '다음 할 일' }} onClose={() => setTodoOpen(false)} />}
      {view && <FileView path={view.path} title={view.name ?? baseName(view.path)} at={view.at} orch={orch.id} onClose={() => setView(null)} />}
    </div>
  );
}
