// 바닥 — 지금 참모의 대시보드(시안 A1·v3 T): 머리줄(이름·컨텍스트·예약 버튼·사용량) · 시킨 일 접는 한 줄 · 주고받은 파일 카드(화면 대부분)
import { useEffect, useMemo, useState } from 'react';
import { readAccounts, readFileText, readLoad, readUsage } from '../../data/web';
import { accountHead, headUsage, readPhoneAccounts } from '../../domain/phoneAccounts';
import { AccountSheet } from './AccountSheet';
import { LoadSheet } from './LoadSheet';
import { PhoneLoginCard } from './PhoneLogin';
import { loadChip, readPhoneLoad } from '../../domain/phoneLoad';
import { starterLists } from '../../domain/starterLists';
import type { Ctx } from '../../domain/ctx';
import { dashFiles, type DashFile } from '../../domain/dashboard';
import { webParts } from '../../domain/phoneFile';
import { foldSummary, heldIds, orchTasks, phoneName } from '../../domain/mobile';
import type { Session } from '../../domain/session';
import type { TaskCard, TaskEvent } from '../../domain/tasks';
import type { ChatItem } from '../../domain/chat';
import { findTarget } from '../../domain/inbox';
import { FileView } from './FileView';
import { SessionPeek } from './SessionPeek';
import { BrowserView } from './BrowserView';
import { liveOf, type Live } from '../../domain/agentBrowser';
import { IconBell, IconBellOff, IconClock, IconSessions } from '../Icons';
import type { Push } from './usePush';
import { HomeAppLink } from './HomeAppLink';
import { FileThumb } from './FileThumb';
import { MAvatar } from './MAvatar';
import { ProfileSheet } from './ProfileSheet';
import { usePendingNicks } from './pendingNicks';
import { useMemoPoll } from './usePoll';
import { Notice } from './Notice';
import { machine } from '../../i18n';

const FOLD_KEY = 'm.taskFold';
const loadFold = () => { try { return localStorage.getItem(FOLD_KEY) === 'open'; } catch { return false; } };
const saveFold = (open: boolean) => { try { localStorage.setItem(FOLD_KEY, open ? 'open' : 'closed'); } catch { /* 개인 정보 보호 모드 */ } };

const baseName = (p: string) => (p.startsWith('data:') ? '붙인 그림' : p.split('/').pop() ?? p);
function when(ts: string, now = new Date()): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === now.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
const cardTag = (c: TaskCard) => (c.status === 'needsInput' ? { cls: 't-wait', text: '물음' } : c.status === 'working' ? { cls: 't-work', text: '일함' } : c.status === 'done' ? { cls: 't-done', text: '끝' } : { cls: 't-off', text: '대기' });

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
};

const PUSH_HINT: Record<string, string> = {
  'need-home': '아이폰은 홈 화면에 추가한 앱에서만 알림을 받아요 — 사파리 공유 → 홈 화면에 추가한 뒤, 아래 \'홈 화면 앱 연결\' 코드를 그 앱에 붙여 넣어요',
  denied: '알림이 막혀 있어요 — 설정 > 알림에서 참모를 허용해 주세요',
};

const PLAN_KEY = 'm.planFold';
const FILES_STEP = 30;

export function OrchDash({ orch, orchs, asking, sessions, ctx, items, events, routinesRunning, onRoutines, onSessions, hqDir, voiceBase, lives, push, showLog, showLoaded }: Props) {
  const [pushHint, setPushHint] = useState<string | null>(null);
  // 켜진 종을 누르면 바로 끄지 않고 묻는다 — 상태 표시로 보고 눌렀다가 꺼졌다(2026-10-03 18:54)
  const [askOff, setAskOff] = useState(false);
  const bell = () => (push.can !== 'ok' ? setPushHint(PUSH_HINT[push.can] ?? '이 브라우저는 알림을 못 받아요') : push.on ? setAskOff(true) : push.enable());
  const myBrowser = liveOf(orch, lives);
  // HQ starter 의 할 일·최근 결정 — 30초마다(서버 허용 집합에 HQ starter 가 있다)
  const [starter] = useMemoPoll(`starter:${hqDir}`, () => readFileText(`${hqDir}/docs/starter.md`).catch(() => ''), 30_000, '', [hqDir]);
  const plan = useMemo(() => starterLists(starter, 6), [starter]);
  const [planOpen, setPlanOpen] = useState(() => { try { return localStorage.getItem(PLAN_KEY) === 'open'; } catch { return false; } });
  // 펼친 칸은 그 자리에서 늘어나 아래를 민다(mobile.css .m-fold-panel) — 둘 다 펼쳐 둘 수 있다
  const togglePlan = () => { setPlanOpen(!planOpen); try { localStorage.setItem(PLAN_KEY, planOpen ? 'closed' : 'open'); } catch { /* 개인 정보 보호 모드 */ } };
  const [fileMax, setFileMax] = useState(FILES_STEP);
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
  const chip = loadChip(readPhoneLoad(loadNow ?? loadText));
  const [open, setOpen] = useState(loadFold);
  const [view, setView] = useState<DashFile | null>(null);
  const now = Date.now();
  const groups = useMemo(() => orchTasks(events, sessions, orch.id, now), [events, sessions, orch.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const held = useMemo(() => heldIds(events, sessions, orch.id, now), [events, sessions, orch.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const myImages = useMemo(() => items.flatMap((it) => (it.kind === 'user' && it.images ? it.images.map((src) => ({ ts: it.ts, src })) : [])), [items]);
  const allFiles = useMemo(() => dashFiles(showLog, orch.id, held, myImages), [showLog, orch.id, held, myImages]);
  const files = allFiles.slice(0, fileMax);
  const who = (by: string) => (by === 'me' ? '나' : phoneName(sessions.find((s) => s.id === by)?.name ?? by, orchs));
  const c = orch.sessionId ? ctx[orch.sessionId] : undefined;
  const sessionCtx = (target: string) => { const s = sessions.find((x) => x.id === target || x.name === target); return s?.sessionId ? ctx[s.sessionId]?.used : undefined; };
  const toggle = () => { setOpen(!open); saveFold(!open); };
  const acctView = readPhoneAccounts(acct);
  const usageLine = headUsage(acctView, usage, now);
  const head = accountHead(acctView);
  const [first, ...rest] = files;
  const [profile, setProfile] = useState(false); // 머리 아바타 → 프로필 창(이름 바꾸기)
  const title = usePendingNicks(orchs).nameOf(orch);

  return (
    <div className="m-dash">
      <header className="m-dash-head">
        <div className="m-dash-row">
          <button type="button" className="m-dash-av" onClick={() => setProfile(true)} aria-label={`${title} 프로필`} title="프로필">
            <MAvatar orch={orch} orchs={orchs} size={44} asking={asking} />
          </button>
          <div className="m-dash-title">{title}</div>
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
            <IconClock />{routinesRunning > 0 && <span className="m-rt-n">{routinesRunning}</span>}
          </button>
        </div>
        <div className="m-dash-row m-muted m-sm">
          <span className="m-dash-sub">대시보드{c ? ` · 컨텍스트 ${Math.round(c.used)}%` : ''}</span>
          {chip && (
            <button type="button" className={`m-load-chip ${chip.cls}`} onClick={() => setLoadOpen(true)} aria-label={`${chip.aria} — 부하 보기`} title={`${machine()} 부하`}>
              <span className="m-load-pill"><span className="m-load-dot" aria-hidden="true" />{chip.text}</span>
            </button>
          )}
          {(usageLine || head) && (
            <button type="button" className="m-usage m-acct-head" onClick={() => setAcctOpen(true)} aria-label={`계정${head ? ` ${head}` : ''}${usageLine ? ` · ${usageLine}` : ''} — 계정 보기`}>
              {head && <b>{head}</b>}{head && usageLine && <span aria-hidden="true">·</span>}{usageLine && <span>{usageLine}</span>}
            </button>
          )}
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

      <div className="m-fold-wrap">
        <button type="button" className={groups.ask.length ? 'm-fold m-fold-ask' : 'm-fold'} onClick={toggle} aria-expanded={open}>
          <span className="m-fold-sum">{foldSummary(groups)}</span>
          <span className="m-fold-dots">
            {[...groups.ask, ...groups.doing].slice(0, 8).map((t) => <span key={t.id} className={`st-dot ${t.status === 'needsInput' ? 'st-wait' : t.status === 'working' ? 'st-work' : 'st-off'}`} />)}
          </span>
          <span className="m-muted m-sm">{open ? '접기' : '펼치기'}</span>
        </button>
        {open && (
          <div className="m-fold-panel">
            {[['물어봄', groups.ask], ['일하는 중', groups.doing]].map(([label, list]) => (list as TaskCard[]).length > 0 && (
              <section key={label as string}>
                <div className="m-sect">{label as string}</div>
                {(list as TaskCard[]).map((t) => {
                  const tag = cardTag(t);
                  const used = sessionCtx(t.target);
                  const s = findTarget(sessions, t.target);
                  return (
                    <button key={t.id} type="button" className="m-task m-task-btn" disabled={!s} onClick={() => s && setPeek(s)} aria-label={`${t.target} 대화 보기`}>
                      <span className={`st-tag ${tag.cls}`}>{tag.text}</span>
                      <span className="m-task-mid"><b>{t.target}</b><span>{t.note || t.title}</span></span>
                      {used !== undefined && <span className={used >= 80 ? 'm-ctx m-hot' : 'm-ctx'}>{Math.round(used)}%</span>}
                    </button>
                  );
                })}
              </section>
            ))}
            {groups.done.length > 0 && <div className="m-sect">오늘 끝남 {groups.done.length} — {groups.done.slice(0, 3).map((t) => t.target).join(', ')}{groups.done.length > 3 ? ' …' : ''}</div>}
            {groups.ask.length + groups.doing.length + groups.done.length === 0 && <p className="m-muted m-sm">아직 시킨 일이 없어요</p>}
          </div>
        )}
      </div>

      {(plan.todo.length > 0 || plan.decisions.length > 0) && (
        <div className="m-fold-wrap">
          <button type="button" className="m-fold" onClick={togglePlan} aria-expanded={planOpen}>
            <span className="m-fold-sum">할 일 {plan.todo.length}{plan.decisions.length ? ` · 최근 결정 ${plan.decisions.length}` : ''}</span>
            <span className="m-fold-dots" />
            <span className="m-muted m-sm">{planOpen ? '접기' : '펼치기'}</span>
          </button>
          {planOpen && (
            <div className="m-fold-panel">
              {plan.todo.length > 0 && <><div className="m-sect">할 일</div><ul className="m-plan">{plan.todo.map((t, i) => <li key={i}>{t}</li>)}</ul></>}
              {plan.decisions.length > 0 && <><div className="m-sect">최근 결정</div><ul className="m-plan">{plan.decisions.map((t, i) => <li key={i}>{t}</li>)}</ul></>}
            </div>
          )}
        </div>
      )}

      <div className="m-sect">주고받은 파일</div>
      {!showLoaded && <div className="m-skel-files" aria-busy="true" aria-label="파일 불러오는 중"><span /><span /><span /></div>}
      {showLoaded && !first && <p className="m-muted m-sm">보여 준 파일이 아직 없어요</p>}
      {first && <FileCard f={first} big who={who(first.by)} onOpen={() => setView(first)} />}
      {rest.length > 0 && <div className="m-files">{rest.map((f) => <FileCard key={`${f.path}-${f.ts}`} f={f} who={who(f.by)} onOpen={() => setView(f)} />)}</div>}
      {allFiles.length > fileMax && <button type="button" className="m-btn m-more" onClick={() => setFileMax(fileMax + FILES_STEP)}>더 보기 · {allFiles.length - fileMax}개 남음</button>}
      {acctOpen && <AccountSheet text={acct} onChanged={setAcctNow} onClose={() => setAcctOpen(false)} />}
      {loadOpen && <LoadSheet text={loadNow ?? loadText} onChanged={setLoadNow} onClose={() => setLoadOpen(false)} />}
      {profile && <ProfileSheet orch={orch} orchs={orchs} voiceBase={voiceBase} onClose={() => setProfile(false)} />}
      {peek && <SessionPeek s={peek} lives={lives} onClose={() => setPeek(null)} />}
      {view && <FileView path={view.path} title={baseName(view.path)} at={view.at} orch={orch.id} onClose={() => setView(null)} />}
    </div>
  );
}

function FileCard({ f, big, who, onOpen }: { f: DashFile; big?: boolean; who: string; onOpen: () => void }) {
  const web = webParts(f.path);
  if (/^https?:\/\//i.test(f.path) && web) return <WebCard f={f} big={big} who={who} web={web} />;
  return <DocCard f={f} big={big} who={who} onOpen={onOpen} />;
}

/** 웹 주소 — 도메인을 크게, 누르면 사파리로(폰 앱 안에선 맥 localhost 를 못 연다) */
function WebCard({ f, big, who, web }: { f: DashFile; big?: boolean; who: string; web: { host: string; rest: string } }) {
  return (
    <a className={big ? 'm-file m-file-big' : 'm-file'} href={f.path} target="_blank" rel="noopener noreferrer">
      <span className="m-thumb m-thumb-web"><b>{web.host}</b>{web.rest && <span>{web.rest}</span>}</span>
      <span className="m-file-name">{web.host}</span>
      <span className="m-file-meta">{who} · {when(f.ts)}</span>
    </a>
  );
}

function DocCard({ f, big, who, onOpen }: { f: DashFile; big?: boolean; who: string; onOpen: () => void }) {
  return (
    <button type="button" className={big ? 'm-file m-file-big' : 'm-file'} onClick={onOpen}>
      <FileThumb path={f.path} big={big} />
      <span className="m-file-name">{baseName(f.path)}</span>
      <span className="m-file-meta">{who} · {when(f.ts)}</span>
    </button>
  );
}
