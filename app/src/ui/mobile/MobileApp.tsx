// 폰 화면 — 시안 A(겹친 시트): 바닥 = 지금 참모 대시보드, 위 = 채팅 시트(살짝·반·전체). 참모를 바꾸면 바닥과 시트가 같이 바뀐다
// 상태는 이것만 위에 둔다(a-build-notes): orch(기억) · view(대시보드|예약) · snap. picker·taskFold 는 그 아래
// 예약 판을 열면 시트는 예약 담당 참모로(domain/mobile routineOrch)
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getEnv, listBrowsers, listSessionsRaw, NoKeyError, readShowLog, readTasksSince, routinesList, type MobileEnv } from '../../data/web';
import { chatFiles, type ChatFile } from '../../domain/chatFiles';
import { titleOf } from '../../domain/reader';
import { FileView } from './FileView';
import type { Live } from '../../domain/agentBrowser';
import type { Ctx } from '../../domain/ctx';
import { josa, machine, setAssistant, setHostWin } from '../../i18n';
import { ctxFromAgents, nextAfterStop, phoneName, routineOrch, shownWaiting, waitingList, type Snap, type WaitSent, type Waiting } from '../../domain/mobile';
import { useWaitSent } from './waitSent';
import { parseTaskLog, type TaskEvent } from '../../domain/tasks';
import { makeTaskTail } from '../../domain/taskTail';
import { parseRoutines, routineState } from '../../domain/routine';
import { groupByProject, parseAgents, type Session } from '../../domain/session';
import { ChatSheet } from './ChatSheet';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { DirectCards, usePhoneDirect } from './DirectCards';
import { needsAnswer } from '../../domain/directAsk';
import { lastLine } from './peek';
import { OrchDash } from './OrchDash';
import { OrchPicker } from './OrchPicker';
import { RoutineBoard } from './RoutineBoard';
import { usePush, type Push } from './usePush';
import { goFrom } from '../../domain/mobilePush';
import type { NoteTarget } from '../../domain/notify';
import { SessionsBoard } from './SessionsBoard';
import { PairHelp } from './PairHelp';
import { NewOrchForm, OffOrchList, useOffOrchs, useWake, WakeNotice, type Wake } from './OrchWake';
import { MAvatar, useOrchColor } from './MAvatar';
import { usePendingNicks } from './pendingNicks';
import { orchVars } from '../../domain/orchTheme';
import { useMobileChat } from './useMobileChat';
import { useOrchAsks } from './useOrchAsks';
import { useMemoPoll, usePoll } from './usePoll';
import { useViewport, type Viewport } from './useViewport';
import { BrandMark } from '../avatar';
import { BOOT_LIMIT_MS, envFromCache, envIsWin, ENV_KEY, splashDeadline, splashDone, type BootBase } from '../../domain/boot';
import { hideBootSplash } from './bootSplash';
import { IconRefresh } from '../Icons';
import { makePoller, RESUME_EVENT } from '../../domain/poller';
import { installResume } from './resume';
import { installFreshBuild } from './freshBuild';
import { Notice } from './Notice';
import { PhoneLoginCard } from './PhoneLogin';
import { preloadFirstScreen } from './bootPreload';

const ORCH_KEY = 'm.orch';
const NO_LIVES: Live[] = [];
/** 작업 기록 — 5초마다 바뀐 줄만(예전엔 꼬리 512KB 통째로, 2026-10-08) */
const readTaskLog = makeTaskTail(readTasksSince);
const saved = () => { try { return localStorage.getItem(ORCH_KEY); } catch { return null; } };
const remember = (id: string) => { try { localStorage.setItem(ORCH_KEY, id); } catch { /* 사파리 개인 정보 보호 모드 */ } };
// 지난번 맥 정보(비서 이름·dev 폴더·HQ 폴더) — 다음 켜기에 이걸로 바로 세션을 받고, 새 맥 정보는 뒤에서 받아 바뀌었으면 다시 그린다
const cachedEnv = () => { try { return envFromCache(localStorage.getItem(ENV_KEY)); } catch { return null; } };
const keepEnv = (e: MobileEnv) => { try { localStorage.setItem(ENV_KEY, JSON.stringify(e)); } catch { /* 개인 정보 보호 모드 */ } };
const forgetEnv = () => { try { localStorage.removeItem(ENV_KEY); } catch { /* 개인 정보 보호 모드 */ } };
const sameEnv = (a: MobileEnv | null, b: MobileEnv) => !!a && JSON.stringify(a) === JSON.stringify(b);

type View = 'dash' | 'routines' | 'sessions';
type SpaceProps = { orch: Session; orchs: Session[]; sessions: Session[]; events: TaskEvent[]; waiting: Waiting[]; waitSent: WaitSent; ask: { lead: string; q: string } | null; ctx: Record<string, Ctx>; env: MobileEnv; snap: Snap; setSnap: (s: Snap) => void; onPick: (id: string) => void; onStopped: (id: string) => void; wake: Wake; lives: Live[]; push: Push; view: View; setView: (v: View) => void; vp: Viewport; stateAt: number; lines: Record<string, string> };

/** 입력칸 최대 높이 — 7줄(16px 글자 기준 176px)과 보이는 화면 26%(반 시트의 40%) 중 작은 쪽 */
const inputMax = (h: number) => Math.min(176, Math.round(h * 0.26));

function OrchSpace({ orch, orchs, sessions, events, waiting, waitSent, ask, ctx, env, snap, setSnap, onPick, onStopped, wake, lives, push, view, setView, vp, stateAt, lines }: SpaceProps) {
  const [picker, setPicker] = useState(false);
  const chat = useMobileChat(orch, snap === 'peek' ? 10_000 : 2000, stateAt);
  const [routinesRaw] = useMemoPoll('routines', routinesList, 30_000, '[]');
  const running = parseRoutines(routinesRaw).filter((r) => routineState(r, sessions) === 'running').length;
  const color = useOrchColor(orch, orchs);
  const nm = usePendingNicks(orchs).nameOf(orch); // 폰에서 바꾼 이름이 맥 진짜 이름에 실리기 전에도 새 이름
  // 직접 답하기 카드 — 기다리는 게 새로 생기면 시트를 반쯤 열고, 접힌 줄에도 알린다(시트 안에만 두면 접혀서 안 보였다, 2026-10-03 QA)
  const direct = usePhoneDirect(orch, orchs, sessions, events);
  const asking = direct.filter(needsAnswer);
  const askingN = asking.length;
  const prevAsk = useRef(0);
  useEffect(() => {
    if (askingN > prevAsk.current && snap === 'peek') setSnap('half');
    prevAsk.current = askingN;
  }, [askingN]); // eslint-disable-line react-hooks/exhaustive-deps
  // 채팅 안 파일 카드 — 이 참모가 보여 준 것만. /api/shows 는 서버가 폰에 내보낼 수 있는 줄만 남긴 기록(대시보드 '주고받은 파일'도 이걸 받는다)
  const [showLog, showLoaded] = useMemoPoll('shows', readShowLog, 5000, '');
  const files = useMemo(() => chatFiles(showLog, orch.id), [showLog, orch.id]);
  const [fileOpen, setFileOpen] = useState<ChatFile | null>(null);
  const askName = asking[0] ? sessions.find((s) => s.id === asking[0]!.from)?.name || asking[0].from : '';
  return (
    <div className="m-space" style={orchVars(color) as React.CSSProperties}>
      {view === 'routines'
        ? <RoutineBoard sessions={sessions} onBack={() => setView('dash')} />
        : view === 'sessions'
        ? <SessionsBoard sessions={sessions} hqDir={env.hqDir} ctx={ctx} lives={lives} onBack={() => setView('dash')} />
        : <OrchDash orch={orch} orchs={orchs} asking={waiting.some((w) => w.orch === orch.id)} sessions={sessions} ctx={ctx} items={chat.items} events={events} routinesRunning={running} onRoutines={() => setView('routines')} onSessions={() => setView('sessions')} hqDir={env.hqDir} voiceBase={env.voiceBase ?? null} lives={lives} push={push} showLog={showLog} showLoaded={showLoaded} />}
      <ChatSheet
        snap={snap}
        onSnap={setSnap}
        vh={vp.h}
        kb={vp.kb}
        peekLine={askingN ? `${josa(askName, '이', '가')} 네 답을 기다려${askingN > 1 ? ` 외 ${askingN - 1}개` : ''}` : chat.live.busy ? `일하는 중 · ${chat.live.line || '생각 중…'}` : lastLine(chat.items)}
        composer={
          <Composer avatar={<MAvatar orch={orch} orchs={orchs} size={28} asking={waiting.some((w) => w.orch === orch.id)} />} orchName={nm} waiting={new Set(waiting.map((w) => w.orch)).size} placeholder={`${nm}에게`} maxInputH={inputMax(vp.h)} busy={chat.live.busy} stopping={chat.stopping} onStop={() => void chat.stop()}
            draftKey={orch.id} onChip={() => setPicker(true)} onFocus={() => snap === 'peek' && setSnap('half')} send={chat.send} />
        }
      >
        {chat.error && <Notice text={chat.error} error onClose={() => chat.setError(null)} />}
        <MessageList files={files} onOpenFile={setFileOpen} items={chat.items} earlier={chat.earlier} loading={chat.loading} stale={chat.stale} out={chat.out} onRetry={chat.retry} onDrop={chat.drop} live={chat.live} ask={ask} who={<MAvatar orch={orch} orchs={orchs} size={28} asking />} />
        {/* 직접 답하기 카드 — 맡긴 세션이 본인 승인을 기다릴 때(채팅 끝, 입력칸 바로 위) */}
        <DirectCards mine={direct} sessions={sessions} />
      </ChatSheet>
      {fileOpen && <FileView path={fileOpen.path} title={titleOf(fileOpen.path)} at={fileOpen.at} orch={orch.id} onClose={() => setFileOpen(null)} />}
      {picker && (
        <OrchPicker title={env.assistantName} env={env} wake={wake} onStopped={onStopped} orchs={orchs} current={orch.id} ctx={ctx} waiting={waiting} sent={waitSent} lines={lines} events={events} sessions={sessions}
          onClose={() => setPicker(false)}
          onPick={(id) => { setPicker(false); onPick(id); }} />
      )}
    </div>
  );
}

/** 참모가 하나도 안 떠 있을 때 — 데스크톱 오케스트레이터 홈처럼 꺼진 참모를 골라 켜거나 새로 만든다 */
function WakeHome({ env, orchs, wake }: { env: MobileEnv; orchs: Session[]; wake: Wake }) {
  const off = useOffOrchs(env, orchs);
  const [naming, setNaming] = useState(false);
  const taken = off.map((r) => phoneName(r.off!.name, orchs));
  return (
    <div className="m-home">
      <BrandMark size={64} className="m-brand" />
      <h1>{env.assistantName}</h1>
      <p className="m-muted">떠 있는 {josa(env.assistantName, '이', '가')} 없어요. 꺼진 {josa(env.assistantName, '을', '를')} 누르면 그 대화 그대로 켜요</p>
      <WakeNotice wake={wake} />
      <PhoneLoginCard />
      {naming
        ? <NewOrchForm title={env.assistantName} taken={taken} wake={wake} onDone={() => setNaming(false)} />
        : <button type="button" className="m-send" disabled={!!wake.making || !!wake.starting} onClick={() => setNaming(true)}>{wake.making ? `${phoneName(wake.making, orchs)} 만드는 중…` : `새 ${env.assistantName} 만들기`}</button>}
      <OffOrchList rows={off} tailsFor={off.tailsFor} orchs={orchs} wake={wake} />
    </div>
  );
}

export function MobileApp() {
  const [env, setEnv] = useState<MobileEnv | null>(null);
  const [orchsAll, setOrchs] = useState<Session[]>([]);
  // 재운 참모 — 목록에서 바로 뺀다(세션 목록은 3초마다라 늦다). 목록에서 실제로 빠지면 지운다
  const [gone, setGone] = useState<Set<string>>(new Set());
  const orchs = useMemo(() => orchsAll.filter((o) => !gone.has(o.id)), [orchsAll, gone]);
  useEffect(() => { if (gone.size && ![...gone].some((id) => orchsAll.some((o) => o.id === id))) setGone(new Set()); }, [orchsAll, gone]);
  const [stateAt, setStateAt] = useState(0);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [view, setView] = useState<View>('dash');
  const [ctx, setCtx] = useState<Record<string, Ctx>>({});
  const [pick, setPick] = useState<string | null>(saved);
  const [snap, setSnap] = useState<Snap>('peek');
  const [noKey, setNoKey] = useState(false);
  const taskLog = usePoll(readTaskLog, 5000, '');
  const events = useMemo(() => parseTaskLog(taskLog), [taskLog]);
  const { asks, lines } = useOrchAsks(orchs);
  // 폰에서 답한 결정 카드는 맥 기록이 따라올 때까지 숨긴다 — 칩 숫자·시트가 같이(waitSent)
  const waitingRaw = useMemo(() => waitingList(orchs, asks, events), [orchs, asks, events]);
  const waitSent = useWaitSent(waitingRaw);
  const waiting = useMemo(() => shownWaiting(waitingRaw, waitSent), [waitingRaw, waitSent]);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const vp = useViewport(frame);
  const go = (id: string) => { remember(id); setPick(id); setView('dash'); setSnap('half'); };
  // 참모 깨우기 — 켜거나 만든 참모가 목록에 뜨면 그리로(참모 바꾸기 시트·참모가 없을 때 화면이 같이 쓴다)
  const wake = useWake(orchs, go);
  // 재운 참모 — 지금 보던 참모면 다른 켜진 참모로, 없으면 참모 없음 화면(목록이 비면 저절로)
  const stopped = (id: string) => {
    setGone((g) => new Set(g).add(id));
    const next = nextAfterStop(orchs, id, orch?.id ?? '');
    if (next && next !== orch?.id) go(next);
  };
  // 세션 브라우저 — 3초마다(화면은 보는 칸이 따로 묻는다)
  const lives = usePoll(listBrowsers, 3000, NO_LIVES);
  const push = usePush();
  // 알림을 눌러 열렸으면(?go=) 그 참모로 — 열려 있던 화면이면 서비스 워커가 알려 준다
  const [goTo, setGoTo] = useState<NoteTarget | null>(() => goFrom(location.search));
  useEffect(() => {
    if (goFrom(location.search)) history.replaceState(null, '', '/');
    const on = (e: MessageEvent) => { const t = typeof e.data?.go === 'string' ? goFrom(`?go=${encodeURIComponent(e.data.go)}`) : null; if (t) setGoTo(t); };
    navigator.serviceWorker?.addEventListener('message', on);
    return () => navigator.serviceWorker?.removeEventListener('message', on);
  }, []);
  useEffect(() => {
    if (!goTo || !orchs.length) return;
    if (goTo.to === 'session' && orchs.some((o) => o.id === goTo.id)) go(goTo.id);
    setGoTo(null);
  }, [goTo, orchs]); // eslint-disable-line react-hooks/exhaustive-deps

  const poller = useRef<{ kick(): void } | null>(null);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    // 받기 고리(domain/poller) — 앱이 다시 보이면 바로(세션 상태가 '일하는 중'으로 남아 '생각 중…'이 떠 있었다, 2026-10-04)
    // 첫 켜기: 맥 정보와 세션을 같이 받는다(예전엔 차례로 — LTE 에서 왕복 하나가 더 들었다). 지난번 맥 정보가 있으면 세션만 기다리고 새 맥 정보는 뒤에서
    let e: MobileEnv | null = cachedEnv();
    if (e) { setAssistant(e.assistantName); setHostWin(envIsWin(e)); }
    let got = false; // 한 번이라도 받았나 — 받기 전엔 BOOT_LIMIT_MS 에 끊고 '못 닿음'(맥이 꺼져 매달려도 모찌만 20초 안 보이게)
    let lastRaw: string | null = null;
    const takeEnv = (v: MobileEnv) => { e = v; setAssistant(v.assistantName); setHostWin(envIsWin(v)); keepEnv(v); };
    const show = (env: MobileEnv, raw: string) => {
      lastRaw = raw;
      const all = parseAgents(raw, env.devRoot, env.extraProjects);
      const list = groupByProject(all, env.hqDir).orchestrators.filter((s) => s.kind === 'background');
      setEnv(env);
      setSessions(all);
      setOrchs(list);
      setStateAt(Date.now());
      setCtx(ctxFromAgents(raw));
      setError(null);
    };
    const limited = (signal: AbortSignal) => {
      if (got) return { signal, late: () => false };
      const c = new AbortController();
      let late = false;
      const t = setTimeout(() => { late = true; c.abort(); }, BOOT_LIMIT_MS);
      signal.addEventListener('abort', () => c.abort());
      c.signal.addEventListener('abort', () => clearTimeout(t));
      return { signal: c.signal, late: () => late };
    };
    type Got = { ok: true; env: MobileEnv; raw: string } | { ok: false; err: unknown };
    const p = makePoller<Got>({
      read: async (signal) => {
        const lim = limited(signal);
        try {
          if (e) return { ok: true, env: e, raw: await listSessionsRaw(lim.signal) };
          const [v, raw] = await Promise.all([getEnv(lim.signal), listSessionsRaw(lim.signal)]); // 비서 이름 — 이름 셈(orchestratorLike·새 참모 이름)이 설정 이름을 따른다
          takeEnv(v);
          return { ok: true, env: v, raw };
        } catch (err) {
          return { ok: false, err: lim.late() ? new Error(`${josa(machine(), '이', '가')} ${BOOT_LIMIT_MS / 1000}초 넘게 답이 없어요`) : err };
        }
      },
      apply: (g) => {
        setRetrying(false);
        if (!g.ok) {
          if (g.err instanceof NoKeyError) { forgetEnv(); setNoKey(true); p.stop(); return; } // 열쇠가 없으면 더 묻지 않는다
          setError((g.err as Error).message);
          return;
        }
        got = true;
        show(g.env, g.raw);
      },
      everyMs: () => 3000,
    });
    // 기억해 둔 맥 정보로 시작했으면 새 맥 정보를 한 번 받아 — 바뀌었으면(비서 이름·폴더) 지난 세션 목록으로 바로 다시 그린다
    if (e) void getEnv().then((v) => { if (sameEnv(e, v)) return; takeEnv(v); if (lastRaw !== null) show(v, lastRaw); }, () => { /* 세션 받기가 이유를 보인다 */ });
    poller.current = p;
    p.start();
    installResume();
    installFreshBuild();
    const wake = () => p.kick();
    window.addEventListener(RESUME_EVENT, wake);
    return () => { window.removeEventListener(RESUME_EVENT, wake); p.stop(); poller.current = null; };
  }, []);
  const retry = () => { setRetrying(true); poller.current?.kick(); };

  // 첫 화면 스플래시 — mobile.html 의 모찌(#boot-splash)가 JS 전부터 덮고 있다. 처음 열 때만(페이지가 새로 뜰 때).
  // 맥 정보·세션을 받을 때까지는 걷지 않는다(2.5초에 걷혀 '불러오는 중…' 글자 화면이 떴다, 2026-10-04 사용자 LTE). 받으면 첫 화면에 쓸 것을 미리 받아
  // 기억에 넣고 다 되거나 마감(domain/boot splashDeadline)이면 한 번에. 앱이 메모리에 남아 있다가 다시 열면 그대로 — 2026-10-03 사용자 "뚝뚝 나오는데"
  const base: BootBase = noKey ? 'nokey' : stateAt ? 'ready' : error ? 'error' : 'wait';
  const [splash, setSplash] = useState(!booted);
  const [preloaded, setPreloaded] = useState(false);
  const readyAt = useRef(0);
  useEffect(() => {
    if (booted) return;
    if (base === 'ready' && !readyAt.current) readyAt.current = performance.now();
    const check = () => {
      if (booted || !splashDone({ base, preloaded, now: performance.now(), readyAt: readyAt.current })) return;
      booted = true;
      hideBootSplash();
      setSplash(false);
    };
    check();
    if (base !== 'ready' || booted) return;
    const t = window.setTimeout(check, Math.max(0, splashDeadline(readyAt.current) - performance.now()));
    return () => window.clearTimeout(t);
  }, [base, preloaded]);
  const preloading = useRef(false);
  useEffect(() => {
    if (booted || preloading.current || base !== 'ready' || !env) return;
    preloading.current = true;
    const first = orchs.find((s) => s.id === pick) ?? orchs[0];
    void preloadFirstScreen(env, first, orchs).then(() => setPreloaded(true));
  }, [base, env, orchs, pick]);
  // 화면 껍데기 캐시(public/sw.js) — 첫 화면이 뜬 뒤에 건다(깔면서 화면 파일을 다시 받으니 첫 켜기 받기와 줄을 서지 않게). 푸시도 같은 서비스 워커
  useEffect(() => {
    if (splash || !('serviceWorker' in navigator)) return;
    const t = window.setTimeout(() => { navigator.serviceWorker.register('/sw.js').catch(() => { /* 사파리 개인 정보 보호 모드 등 — 캐시 없이 */ }); }, 1500);
    return () => window.clearTimeout(t);
  }, [splash]);
  // 스플래시 동안엔 화면을 안 그린다 — 밑에서 그리면 화면 훅이 미리 받기와 같은 것을 또 받아 브라우저 동시 연결(6개)에서 줄을 서
  // 미리 받기가 2.5초까지 늘었다(실측). 걷힐 때 한 번에 그리면 훅이 기억(memo)에서 바로 꺼내 다 찬 채로 뜬다. 걷는 페이드는 모찌가 위에서
  const cover = (node: ReactNode) => (splash ? null : node);

  if (noKey) {
    return cover(<PairHelp />);
  }
  // 한 번도 못 받았으면 — 맥에 못 닿은 이유 + 다시 시도(받기 고리는 3초마다 저절로도 다시 한다). 받기 전엔 모찌가 덮고 있어 글자 화면이 없다
  if (!stateAt || !env) {
    return cover(
      <div className="m-center m-unreach">
        <BrandMark size={64} className="m-brand" />
        <p>{error ? `${machine()}에 못 닿았어요: ${error}` : ''}</p>
        <button type="button" className={retrying ? 'm-icon m-retrying' : 'm-icon'} disabled={retrying} onClick={retry} aria-label="다시 시도" title="다시 시도"><IconRefresh /></button>
      </div>,
    );
  }
  const want = view === 'routines' ? routineOrch(orchs, pick) : pick;
  const orch = orchs.find((s) => s.id === want) ?? orchs[0];
  if (!orch?.sessionId) return cover(<div ref={frame} className="m-app" style={{ top: vp.top, height: vp.h }}><WakeHome env={env} orchs={orchs} wake={wake} /></div>);
  return cover(
    // 키보드가 올라오면 보이는 영역에 화면 틀을 맞춘다 — 입력줄이 키보드 바로 위, 대화 목록은 그 위에 남는다
    <div ref={frame} className="m-app" style={{ top: vp.top, height: vp.h }}>
      {error && <div className="m-error m-top-err">{error}</div>}
      <OrchSpace key={orch.id} orch={orch} orchs={orchs} sessions={sessions} events={events} waiting={waiting} waitSent={waitSent} ask={asks[orch.id] ?? null} ctx={ctx} env={env} snap={snap} setSnap={setSnap} vp={vp} stateAt={stateAt} lines={lines}
        view={view} setView={setView} onPick={go} onStopped={stopped} wake={wake} lives={lives} push={push} />
    </div>,
  );
}

/** 이 페이지에서 첫 화면을 이미 보였나 — 모듈에 하나(화면이 다시 그려져도 스플래시가 또 안 뜨게) */
let booted = false;
