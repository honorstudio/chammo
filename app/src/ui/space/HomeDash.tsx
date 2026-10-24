// 홈 대시보드 — 띠 맨 위 홈(2026-10-24 사용자 시안 home-dash v1 HA 타일 격자). 참모 채팅 없이 전체 한눈에:
// 숫자 넷(결정 대기·일하는 세션·오래 조용·오늘 끝남)·부하·계정 / 참모 타일·잠든 선반 / 결정 대기·오래 조용 / 참모별 진행 칸 / 기기·도구 / 오늘 끝난 것 / 사무실.
// 누르면 그 참모(채팅 탭까지)·그 세션·결정 대기함·그 기능. 글은 읽을 것만 — 도구는 아이콘만(이름은 aria-label·title)
import { useEffect, useMemo, useState } from 'react';
import { remoteSaved } from '../../data/remote';
import { mobileApi } from '../../data/tauri';
import { goalBar } from '../../domain/goalBar';
import { homeDash } from '../../domain/homeDash';
import { phoneGroups } from '../../domain/mobileDevices';
import { whenLabel } from '../../domain/orchHome';
import type { Session } from '../../domain/session';
import type { FeatureKey } from '../../domain/spaceNav';
import type { ActivityStatus } from '../../domain/status';
import type { StoppedSession } from '../../domain/stopped';
import type { TaskEvent } from '../../domain/tasks';
import type { Usage } from '../../domain/usage';
import { assistant, machine, tr } from '../../i18n';
import { OrchAvatar, avatarState } from '../avatar';
import { HomeProgress } from '../GoalProgress';
import { IconCalendarClock, IconHarness, IconOffice, IconReplay, IconReview, IconTools } from '../Icons';
import { every } from '../poll';
import type { LiveLine } from './DashboardView';
import './homeDash.css';

/** 누르면 갈 곳 — 스페이스가 준다 */
export type HomeGo = { orch: (id: string) => void; session: (target: string) => void; feature: (k: FeatureKey) => void; office?: () => void };
/** 결정 대기 한 줄 — 물음(결정 대기함)·직접 카드. who = 물은 참모(얼굴), pay = 결제 카드 */
export type HomeAsk = { key: string; text: string; where: string; who?: Session; pay?: boolean };

type Dot = 'run' | 'ask' | 'rest' | 'quiet' | 'done' | 'off';
const D = ({ d }: { d: Dot }) => <i className={`hd-d d-${d}`} aria-hidden="true" />;
const dotOf = (st: ActivityStatus | undefined, l: LiveLine | undefined): Dot =>
  st === 'asks' || st === 'blocked' || st === 'login' || l?.status === 'ask' ? 'ask' : st === 'working' || l?.status === 'run' ? 'run' : 'rest';

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

export function HomeDash({ go, orchs, nameOf, roleOf, colorOf, lines, statusOf, off, starting, onResume, events, sessions, asks, onAsks, running, usage, load, review = 0, office }: {
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
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);
  const bars = useMemo(() => Object.fromEntries(orchs.map((o) => [o.id, goalBar({ events, sessions, orch: { id: o.id, name: o.name }, now, seen: new Set() })])), [orchs, events, sessions, now]);
  const d = homeDash({ orchs, bars, events, asks: asks.length, running, now });
  const tile = new Map(d.tiles.map((t) => [t.id, t]));
  const byId = new Map(orchs.map((o) => [o.id, o]));
  const devs = useDevices();
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
    <div className="cv-dash hd" aria-label={tr('홈', 'Home')}>
      <header className="hd-top">
        <h1>{tr('홈', 'Home')}</h1>
        <div className="hd-stats">
          <button className="hd-stat" onClick={onAsks} disabled={!asks.length}><D d="ask" /><b>{d.counts.asks}</b><span>{tr('결정 대기', 'Decisions')}</span></button>
          <div className="hd-stat"><D d="run" /><b>{d.counts.running}</b><span>{tr('일하는 세션', 'Working')}</span></div>
          <button className="hd-stat" onClick={() => d.quiet[0] && go.session(d.quiet[0].target)} disabled={!d.quiet.length}><D d="quiet" /><b>{d.counts.quiet}</b><span>{tr('오래 조용', 'Quiet')}</span></button>
          <button className="hd-stat" onClick={() => go.feature('rp:')}><D d="done" /><b>{d.counts.doneToday}</b><span>{tr('오늘 끝남', 'Done today')}</span></button>
        </div>
        <span className="hd-sp" />
        {load && (
          <div className="hd-meter" title={tr(`${machine()} 부하 ${load.load1.toFixed(1)} · 코어 ${load.cores}`, `Load ${load.load1.toFixed(1)} · ${load.cores} cores`)}>
            <span>{tr(`${machine()} 부하`, 'Load')}</span><span className="hd-bar"><i style={{ width: `${Math.min(100, (load.load1 / Math.max(1, load.cores)) * 100)}%` }} /></span><b>{load.load1.toFixed(1)}</b>
          </div>
        )}
        {used !== null && <div className="hd-acct" title={tr('계정 5시간 창 쓴 양', 'Account 5-hour window used')}>{ring(used)}<b>{used}%</b></div>}
      </header>

      <div className="hd-grid">
        <section className="hd-card hd-a-orch" aria-label={tr(assistant(), 'Assistants')}>
          <div className="hd-h"><b>{assistant()}</b><span>{orchs.length}</span></div>
          <div className="hd-otiles">
            {orchs.map((o) => {
              const l = lines[o.id];
              const t = tile.get(o.id);
              const nm = nameOf(o);
              return (
                <button key={o.id} className="hd-otile" onClick={() => go.orch(o.id)} title={tr(`${nm}로 가기`, `Go to ${nm}`)}>
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

        <section className="hd-card hd-a-ask" aria-label={tr('결정 대기', 'Decisions')}>
          <div className="hd-h"><b>{tr('결정 대기', 'Decisions')}</b><span>{asks.length}</span></div>
          {asks.length ? (
            <div className="hd-asks">
              {asks.slice(0, 5).map((a) => (
                <button key={a.key} className={`hd-ask ${a.pay ? 'pay' : ''}`} onClick={onAsks}>
                  {a.who ? face(a.who, 22, 'ask') : <D d="ask" />}
                  <span className="hd-tx"><b>{a.text}</b><span>{a.where}</span></span>
                  {a.pay && <em>{tr('결제', 'Payment')}</em>}
                </button>
              ))}
            </div>
          ) : <p className="hd-none">{tr('없음', 'None')}</p>}
          {d.quiet.length > 0 && (
            <>
              <div className="hd-h"><b>{tr('오래 조용', 'Quiet')}</b><span>{d.quiet.length}</span></div>
              {d.quiet.slice(0, 4).map((q) => (
                <button key={q.task} className="hd-quiet" onClick={() => go.session(q.target)} title={q.title}>
                  <D d="quiet" /><b>{q.target}</b><span>{q.title}{q.at ? ` · ${whenLabel(q.at, now)}` : ''}</span>
                </button>
              ))}
            </>
          )}
        </section>

        <section className="hd-a-gp" aria-label={tr('진행', 'Progress')}>
          {orchs.filter((o) => bars[o.id]?.goals.length).map((o) => (
            <div key={o.id} className="hd-gpcell">
              <button className="hd-gpwho" onClick={() => go.orch(o.id)}>{face(o, 18)}{nameOf(o)}</button>
              <HomeProgress orch={{ id: o.id, name: o.name }} events={events} sessions={sessions} />
            </div>
          ))}
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
              <button key={t.k} className="hd-tool" onClick={() => go.feature(t.k)} aria-label={t.n ? tr(`${t.name}, 볼 것 ${t.n}`, `${t.name}, ${t.n} to check`) : t.name} title={t.name}>
                {t.icon}{!!t.n && <b className="hd-badge">{t.n}</b>}
              </button>
            ))}
          </div>
        </section>

        <section className="hd-card hd-a-done" aria-label={tr('오늘 끝난 것', 'Done today')}>
          <div className="hd-h"><b>{tr('오늘 끝난 것', 'Done today')}</b><span>{d.done.length}</span></div>
          {d.done.length ? (
            <div className="hd-chips">
              {d.done.slice(0, 12).map((x) => {
                const o = x.orch ? byId.get(x.orch) : undefined;
                return (
                  <button key={x.task} className="hd-chip" onClick={() => go.session(x.target)} title={`${x.target} · ${x.title}`}>
                    {o && face(o, 16)}<b>{x.title || x.target}</b><span>{new Date(x.at).toTimeString().slice(0, 5)}</span>
                  </button>
                );
              })}
            </div>
          ) : <p className="hd-none">{tr('아직 없음', 'Nothing yet')}</p>}
        </section>

        {office && go.office && (
          // 미리보기는 못 누르게(inert) 깔고 그 위를 덮는 단추 하나 — 누르면 사무실
          <section className="hd-card hd-a-office" aria-label={tr('사무실', 'Office')}>
            <div className="hd-office-in" inert aria-hidden="true">{office}</div>
            <button className="hd-office-go" onClick={go.office} aria-label={tr('사무실 열기', 'Open the office')} title={tr('사무실', 'Office')}><span className="hd-office-tag"><IconOffice /></span></button>
          </section>
        )}
      </div>
    </div>
  );
}
