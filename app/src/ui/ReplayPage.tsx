// 하루 리플레이 — 사이드바 항목. 위: 오늘의 숫자(C) / 가운데: 재생 막대 + 저장소 레인(B+A) + 다마고치 산책(D) / 아래: 결정·큰 커밋·내일로 넘길 일(E).
// 시안 docs/design-drafts/day-replay v1. 날짜는 ◀ ▶ 로 넘겨본다. 계산은 domain/replay.ts
import { useEffect, useMemo, useRef, useState } from 'react';
import { commitLog, readAutoAllow } from '../data/tauri';
import { parseAllowLog } from '../domain/autoAllow';
import { buildReplay, dayWindow, parseDayCommits, shiftDay, TASK_LANE, type DayWindow, type ReplayEvent, type ReplayKind } from '../domain/replay';
import type { TaskEvent } from '../domain/tasks';
import type { TamaFile } from '../domain/tama/store';
import { drawSprite, spriteOf } from './tama/lcd';
import { IconNext, IconPause, IconPlay, IconPrev } from './Icons';
import { tr } from '../i18n';

const HOUR = 3600_000;
const PLAY_MS_PER_HOUR = 3000; // 재생: 한 시간 = 3초

const KIND = (): Record<ReplayKind, string> => ({
  commit: tr('커밋', 'Commit'), big: tr('큰 커밋', 'Big commit'), merge: tr('머지', 'Merge'), send: tr('시킴', 'Delegated'), done: tr('끝남', 'Done'), ask: tr('결정', 'Decision'), allow: tr('자동 허용', 'Auto-allow'),
});
const LOC = () => tr('ko-KR', 'en-US');
const hourLabel = (h: number) => tr(`${h}시`, `${h}:00`);
const hhmm = (t: number) => new Date(t).toLocaleTimeString(LOC(), { hour: '2-digit', minute: '2-digit', hour12: false });
const dayLabel = (w: DayWindow) => new Date(w.start).toLocaleDateString(LOC(), { month: 'long', day: 'numeric', weekday: 'short' });

/** author = 내 커밋 작성자 이메일(env.gitEmail) */
type Props = { devRoot: string; author: string; tasks: TaskEvent[]; tama: TamaFile | null };

export function ReplayPage({ devRoot, author, tasks, tama }: Props) {
  const [win, setWin] = useState<DayWindow>(() => dayWindow(new Date()));
  const [raw, setRaw] = useState<{ commits: string; allow: string } | null>(null);
  const [pos, setPos] = useState(0); // 창 시작부터 ms
  const [playing, setPlaying] = useState(false);
  const today = dayWindow(new Date());
  const isToday = win.start === today.start;
  const end = isToday ? Math.min(win.end, Date.now()) : win.end;
  const span = end - win.start;

  useEffect(() => {
    let alive = true;
    setRaw(null);
    const iso = (t: number) => new Date(t).toISOString();
    void Promise.all([commitLog(devRoot, author, iso(win.start), iso(win.end)), readAutoAllow().catch(() => '')]).then(([commits, allow]) => {
      if (alive) setRaw({ commits, allow });
    });
    return () => { alive = false; };
  }, [devRoot, author, win.start, win.end]);

  const r = useMemo(() => buildReplay(win, parseDayCommits(raw?.commits ?? ''), tasks, parseAllowLog(raw?.allow ?? '', 100_000)), [win, raw, tasks]);

  // 새 날을 열면 끝까지 다 보인 상태로 — 재생을 누르면 처음부터
  useEffect(() => { setPos(span); setPlaying(false); }, [win.start, raw]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let id = 0;
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      setPos((p) => {
        const next = p + (dt / PLAY_MS_PER_HOUR) * HOUR;
        if (next >= span) { setPlaying(false); return span; }
        return next;
      });
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [playing, span]);

  const cut = win.start + pos;
  const shown = r.events.filter((e) => e.t <= cut);
  const x = (t: number) => `${((t - win.start) / (24 * HOUR)) * 100}%`;
  const play = () => { if (pos >= span) setPos(0); setPlaying((p) => !p); };

  return (
    <div className="replay">
      <header className="rp-head">
        <button className="ib" title={tr('하루 전', 'Previous day')} aria-label={tr('하루 전', 'Previous day')} onClick={() => setWin((w) => shiftDay(w, -1))}><IconPrev /></button>
        <b>{dayLabel(win)}</b>
        <button className="ib" title={tr('다음 날', 'Next day')} aria-label={tr('다음 날', 'Next day')} disabled={isToday} onClick={() => setWin((w) => shiftDay(w, 1))}><IconNext /></button>
        {!isToday && <button className="btn" onClick={() => setWin(today)}>{tr('오늘로', 'Today')}</button>}
        <span className="dim">{isToday ? tr('새벽 5시부터 지금까지', 'From 5 AM until now') : tr('새벽 5시부터 다음 날 5시까지', 'From 5 AM to 5 AM next day')}</span>
        {!raw && <span className="dim">{tr('불러오는 중…', 'Loading…')}</span>}
      </header>

      <section className="rp-stats">
        <Stat n={r.stats.commits} label={tr('커밋', 'Commits')} sub={tr(`${r.stats.lines.toLocaleString()}줄 · 머지 ${r.stats.merges}`, `${r.stats.lines.toLocaleString()} lines · ${r.stats.merges} merges`)} />
        <Stat n={r.stats.sent} label={tr('시킨 일', 'Delegated')} sub={tr(`끝남 ${r.stats.done}`, `${r.stats.done} done`)} />
        <Stat n={r.stats.decisions} label={tr('결정', 'Decisions')} sub={tr('나한테 물은 것', 'Asked of you')} />
        <Stat n={r.stats.allows} label={tr('자동 허용', 'Auto-allowed')} sub={tr('권한 창', 'Permission prompts')} />
        <Stat n={r.stats.bigCommits} label={tr('똥', 'Poops')} sub={tr('300줄 넘은 커밋', 'Commits over 300 lines')} />
        <Stat n={r.busiest ? hourLabel(r.busiest.hour) : '—'} label={tr('제일 바빴던 시간', 'Busiest hour')} sub={r.busiest ? tr(`커밋 ${r.busiest.count}개`, `${r.busiest.count} commits`) : tr('커밋 없음', 'No commits')} />
      </section>

      <section className="rp-player">
        <div className="rp-controls">
          <button className="ib pri" title={playing ? tr('멈춤', 'Pause') : tr('재생 — 한 시간이 3초', 'Play — one hour takes 3 seconds')} aria-label={playing ? tr('멈춤', 'Pause') : tr('재생', 'Play')} onClick={play}>{playing ? <IconPause /> : <IconPlay />}</button>
          <b className="rp-clock">{hhmm(cut)}</b>
          <input className="rp-range" type="range" min={0} max={span} step={60_000} value={pos} aria-label={tr('시각', 'Time')} onChange={(e) => { setPlaying(false); setPos(Number(e.target.value)); }} />
        </div>

        <div className="rp-lanes">
          <div className="rp-axis">
            {Array.from({ length: 24 }, (_, i) => (
              <span key={i} style={{ left: `${(i / 24) * 100}%` }}>{i % 3 === 0 ? hourLabel((5 + i) % 24) : ''}</span>
            ))}
          </div>
          {r.lanes.map((lane) => (
            <div key={lane} className="rp-lane">
              <span className="rp-lane-name" title={lane}>{lane}</span>
              <div className="rp-track">
                {(r.hours[lane] ?? []).map((n, i) => n > 0 && (
                  <span key={i} className="rp-bar" style={{ left: `${(i / 24) * 100}%`, height: `${Math.min(100, 20 + n * 12)}%` }} title={tr(`${(5 + i) % 24}시 커밋 ${n}개`, `${hourLabel((5 + i) % 24)} ${n} commits`)} />
                ))}
                {r.events.filter((e) => e.lane === lane).map((e, i) => (
                  <span key={i} className={`rp-dot ${e.kind} ${e.t > cut ? 'future' : ''}`} style={{ left: x(e.t) }} title={`${hhmm(e.t)} ${KIND()[e.kind]} — ${e.text}`} />
                ))}
                <span className="rp-head-line" style={{ left: x(cut) }} />
              </div>
            </div>
          ))}
          <Walk tama={tama} events={r.events} cutX={x(cut)} walking={playing} x={x} cut={cut} />
        </div>

        <ol className="rp-feed">
          {shown.slice(-8).reverse().map((e, i) => <Card key={`${e.t}-${i}`} e={e} fresh={i === 0 && playing} />)}
          {shown.length === 0 && <li className="dim">{tr('아직 아무 일도 없어', 'Nothing yet')}</li>}
        </ol>
      </section>

      <section className="rp-parts">
        <Part title={tr(`결정 ${r.decisions.length}`, `Decisions ${r.decisions.length}`)}>
          {r.decisions.map((d, i) => <Row key={i} t={d.t} head={d.project} text={d.text} />)}
          {!r.decisions.length && <Empty />}
        </Part>
        <Part title={tr('가장 큰 커밋', 'Biggest commits')}>
          {r.biggest.map((c) => <Row key={c.hash} t={c.t} head={tr(`${c.repo} · ${c.lines.toLocaleString()}줄`, `${c.repo} · ${c.lines.toLocaleString()} lines`)} text={c.subject} />)}
          {!r.biggest.length && <Empty />}
        </Part>
        <Part title={tr(`내일로 넘길 일 ${r.carryover.length}`, `Carry over to tomorrow ${r.carryover.length}`)}>
          {r.carryover.map((c, i) => <Row key={i} t={c.t} head={c.project} text={c.title} />)}
          {!r.carryover.length && <Empty text={tr('시킨 일은 다 끝났어', 'All delegated tasks are done')} />}
        </Part>
        <Part title={tr('저장소별 커밋', 'Commits by repo')}>
          {r.lanes.filter((l) => l !== TASK_LANE).map((l) => (
            <Row key={l} head={l} text={tr(`${(r.hours[l] ?? []).reduce((a, b) => a + b, 0)}개`, `${(r.hours[l] ?? []).reduce((a, b) => a + b, 0)}`)} />
          ))}
        </Part>
      </section>
    </div>
  );
}

function Stat({ n, label, sub }: { n: number | string; label: string; sub: string }) {
  return (
    <div className="rp-stat">
      <b>{typeof n === 'number' ? n.toLocaleString() : n}</b>
      <span>{label}</span>
      <span className="dim">{sub}</span>
    </div>
  );
}

function Card({ e, fresh }: { e: ReplayEvent; fresh: boolean }) {
  return (
    <li className={`rp-card ${e.kind} ${fresh ? 'fresh' : ''}`}>
      <span className="rp-card-t">{hhmm(e.t)}</span>
      <span className={`tag rp-tag ${e.kind}`}>{KIND()[e.kind]}</span>
      <span className="rp-card-lane">{e.lane}</span>
      <span className="rp-card-text">{e.text}{e.lines ? tr(` · ${e.lines.toLocaleString()}줄`, ` · ${e.lines.toLocaleString()} lines`) : ''}</span>
    </li>
  );
}

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rp-part"><div className="tasks-sec">{title}</div>{children}</div>;
}
const Row = ({ t, head, text }: { t?: number; head: string; text: string }) => (
  <div className="rp-row">{t !== undefined && <span className="rp-card-t">{hhmm(t)}</span>}<b>{head}</b><span>{text}</span></div>
);
const Empty = ({ text }: { text?: string }) => <div className="rp-row dim">{text ?? tr('없어', 'None')}</div>;

/** D — 다마고치가 재생 막대를 따라 걷는다. 커밋은 밥, 큰 커밋은 똥, 결정은 표지판 */
function Walk({ tama, events, cutX, walking, x, cut }: { tama: TamaFile | null; events: ReplayEvent[]; cutX: string; walking: boolean; x: (t: number) => string; cut: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pet = tama?.pet;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(36 * dpr);
    c.height = Math.round(36 * dpr);
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    drawSprite(c, pet && !pet.dead ? spriteOf(pet.egg, pet.slot) : 'egg', dark ? 'dark' : 'light');
  }, [pet]);
  return (
    <div className="rp-lane rp-walk">
      <span className="rp-lane-name">{tr('산책', 'Walk')}</span>
      <div className="rp-track">
        {events.filter((e) => e.kind !== 'allow' && e.kind !== 'send').map((e, i) => (
          <span key={i} className={`rp-food ${e.kind} ${e.t > cut ? 'future' : 'eaten'}`} style={{ left: x(e.t) }} />
        ))}
        <canvas ref={ref} className={`rp-pet ${walking ? 'walking' : ''}`} style={{ left: cutX }} />
      </div>
    </div>
  );
}
