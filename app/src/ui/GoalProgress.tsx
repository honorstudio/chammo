// 참모 홈 맨 위 '진행' 칸 — 데스크톱 스페이스 홈과 폰 홈이 같이 쓴다(시안 docs/design-drafts/progress-bar v2, 사용자 10-23 확정: 홈에만).
// 목표마다 한 줄(이름 · 조각 막대 · 끝/전체 · 마지막 기척), 줄을 누르면 그 자리에서 일 목록. 계산은 domain/goalBar.
// 끝난 조각은 결과 한 줄과 남아 있다가 앱이 앞에 있고 그 줄이 4초 보이면 한 번 반짝이고 접히며 사라진다(동작 줄이기면 페이드만)
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { goalBar, type Cell, type CellState, type Goal } from '../domain/goalBar';
import { whenLabel } from '../domain/orchHome';
import type { Session } from '../domain/session';
import type { TaskEvent } from '../domain/tasks';
import { tr } from '../i18n';
import { isAttended, onAttention } from './attention';
import { useGoalSeen } from './goalSeen';
import { IconChevron } from './Icons';
import './goalProgress.css';

const SEEN_MS = 4000;

const stateWord = (c: Cell, now: number): string => {
  const m: Record<CellState, string> = {
    done: tr('끝', 'Done'), auto: tr('끝 · 앱이 닫음', 'Done · closed by app'), ask: tr('답 기다림', 'Needs you'),
    run: c.fill !== undefined ? tr(`일하는 중 · 할 일 ${Math.round(c.fill * 100)}%`, `Working · ${Math.round(c.fill * 100)}%`) : tr('일하는 중', 'Working'),
    quiet: tr(`${Math.max(3, Math.floor((now - (c.at ?? now)) / 3600_000))}시간 조용`, `Quiet ${Math.max(3, Math.floor((now - (c.at ?? now)) / 3600_000))}h`),
    stop: tr('멈춤 · 세션 꺼짐', 'Stopped · session ended'), rest: tr('쉬는 중', 'Idle'), todo: '',
  };
  return m[c.state];
};
const tone = (s: CellState) => (s === 'auto' ? 'done' : s === 'stop' ? 'quiet' : s);

/** 이 참모 진행 — 세션 할 일 목록 비율(readFill)은 데스크톱만(폰은 길이 없어 흐름만) */
export function useGoalBar({ orch, events, sessions, readFill }: {
  orch: { id: string; name: string }; events: TaskEvent[]; sessions: Session[];
  readFill?: (sessionId: string) => Promise<number | undefined>;
}) {
  const [seen, mark] = useGoalSeen();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);
  const [fills, setFills] = useState<Record<string, number>>({});
  const base = useMemo(() => goalBar({ events, sessions, orch, now, seen }), [events, sessions, orch.id, orch.name, now, seen]); // eslint-disable-line react-hooks/exhaustive-deps
  // 일하는 중 칸의 세션들 — 15초마다 할 일 목록 비율
  const runIds = [...new Set(base.goals.flatMap((g) => g.cells.filter((c) => c.state === 'run').map((c) => sessions.find((s) => s.id === c.target || s.name === c.target)?.sessionId).filter((x): x is string => !!x)))].join(',');
  useEffect(() => {
    if (!readFill || !runIds) return;
    let alive = true;
    const tick = () => void Promise.all(runIds.split(',').map(async (id) => [id, await readFill(id).catch(() => undefined)] as const)).then((xs) => {
      if (!alive) return;
      const m: Record<string, number> = {};
      for (const [id, v] of xs) if (v !== undefined) m[id] = v;
      setFills((p) => (JSON.stringify(p) === JSON.stringify(m) ? p : m));
    });
    tick();
    const t = window.setInterval(tick, 15_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [readFill, runIds]);
  const bar = useMemo(() => (Object.keys(fills).length
    ? goalBar({ events, sessions, orch, now, seen, fill: (s) => (s.sessionId ? fills[s.sessionId] : undefined) })
    : base), [base, fills]); // eslint-disable-line react-hooks/exhaustive-deps
  return { bar, now, mark };
}

/** 줄이 앱 앞·화면 안에서 SEEN_MS 동안 보이면 한 번 부른다 */
function useSeenWatch(units: string[], onSeen: (units: string[]) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const key = units.join(',');
  const cb = useRef(onSeen);
  cb.current = onSeen;
  useEffect(() => {
    const el = ref.current;
    if (!key || !el || typeof IntersectionObserver === 'undefined') return;
    let inView = false;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = inView && isAttended() ? window.setTimeout(() => cb.current(key.split(',')), SEEN_MS) : 0;
    };
    const io = new IntersectionObserver(([e]) => { inView = !!e && e.intersectionRatio >= 0.6; arm(); }, { threshold: [0, 0.6, 1] });
    io.observe(el);
    const off = onAttention(arm);
    return () => { io.disconnect(); off(); window.clearTimeout(timer); };
  }, [key]);
  return ref;
}

function GoalRow({ g, now, open, onToggle, leaving, onLeave, onGone }: {
  g: Goal; now: number; open: boolean; onToggle: () => void;
  leaving: Set<string>; onLeave: (units: string[]) => void; onGone: (units: string[]) => void;
}) {
  const units = g.finished ? [g.unit!] : g.cells.filter((c) => c.unit).map((c) => c.unit!);
  const ref = useSeenWatch(units, onLeave);
  const going = g.finished && leaving.has(g.unit!);
  // 접힐 높이는 떠나기 시작할 때 잰다 — max-height 를 실제 높이에서 0 으로
  useEffect(() => { if (going && ref.current) ref.current.style.setProperty('--gp-h', `${ref.current.offsetHeight}px`); }, [going, ref]);
  // animationend 가 안 오는 때(창이 숨음)도 빠지게
  useEffect(() => {
    const out = g.finished ? (going ? [g.unit!] : []) : units.filter((u) => leaving.has(u));
    if (!out.length) return;
    const t = window.setTimeout(() => onGone(out), 1600);
    return () => window.clearTimeout(t);
  }, [going, leaving, g.unit]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = g.name || tr('기타', 'Other');
  const jobs = g.cells.filter((c) => c.state !== 'todo');
  const todo = g.cells.length - jobs.length;
  return (
    <div ref={ref} className={`gp-row${g.finished ? ' gp-fin' : ''}${going ? ' gp-leave' : ''}${g.name ? '' : ' gp-etc'}`}
      onAnimationEnd={(e) => {
        if (e.animationName === 'gp-fold' || e.animationName === 'gp-fade') { if (e.target === e.currentTarget) onGone([g.unit!]); }
        else if (e.animationName === 'gp-shrink' || e.animationName === 'gp-cfade') { const u = (e.target as HTMLElement).dataset.unit; if (u) onGone([u]); }
      }}>
      <button type="button" className="gp-line" onClick={onToggle} aria-expanded={open}
        aria-label={tr(`${name} — ${g.done}/${g.total}`, `${name} — ${g.done}/${g.total}`)}>
        <span className="gp-chev" aria-hidden><IconChevron /></span>
        <span className="gp-name">{name}</span>
        <span className="gp-bar" aria-hidden>
          {g.cells.map((c) => (
            <i key={c.task} data-unit={c.unit} className={`gp-c gp-${c.state}${c.unit && leaving.has(c.unit) ? ' gp-cleave' : ''}`}
              style={c.fill !== undefined ? ({ '--gp-f': `${Math.round(c.fill * 100)}%` } as CSSProperties) : undefined}
              title={c.state === 'todo' ? tr('아직 안 보냄', 'Not sent yet') : `${c.title} — ${stateWord(c, now)}`} />
          ))}
        </span>
        <span className="gp-num"><b>{g.done}</b> / {g.total}</span>
        <span className="gp-when">{whenLabel(g.lastAt, now)}</span>
      </button>
      {g.finished && g.result && <div className="gp-result">{tr('끝', 'Done')} · {g.result}</div>}
      {open && (
        <div className="gp-jobs">
          {jobs.map((c) => (
            <div key={c.task} className="gp-job">
              <i className={`gp-k gp-${c.state}`} aria-hidden />
              <span className="gp-jt">{c.title}</span>
              <span className="gp-js">{c.target}</span>
              <span className={`gp-tag gp-t-${tone(c.state)}`}>{stateWord(c, now)}</span>
              <span className="gp-when">{whenLabel(c.at ?? 0, now)}</span>
            </div>
          ))}
          {todo > 0 && <div className="gp-job gp-todo-line"><i className="gp-k gp-todo" aria-hidden /><span className="gp-jt">{tr(`아직 안 보낸 일 ${todo}`, `${todo} not sent yet`)}</span></div>}
        </div>
      )}
    </div>
  );
}

/** 진행 칸 — 목표가 없으면 안 그린다 */
export function GoalProgress({ bar, now, onSeen }: { bar: ReturnType<typeof goalBar>; now: number; onSeen: (units: string[]) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  if (!bar.goals.length) return null;
  const toggle = (k: string) => setOpen((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const leave = (units: string[]) => setLeaving((p) => new Set([...p, ...units]));
  const gone = (units: string[]) => { setLeaving((p) => { const n = new Set(p); units.forEach((u) => n.delete(u)); return n; }); onSeen(units); };
  let lastProject: string | undefined;
  return (
    <section className="gp" aria-label={tr('진행', 'Progress')}>
      <div className="gp-head"><b>{tr('진행', 'Progress')}</b><span className="gp-num"><b>{bar.done}</b> / {bar.total}</span></div>
      {bar.goals.map((g) => {
        const head = bar.byProject && g.project !== lastProject ? <div className="gp-proj">{g.project || tr('프로젝트 밖', 'No project')}</div> : null;
        lastProject = g.project;
        return (
          <Fragment key={g.key}>
            {head}
            <GoalRow g={g} now={now} open={open.has(g.key)} onToggle={() => toggle(g.key)} leaving={leaving} onLeave={leave} onGone={gone} />
          </Fragment>
        );
      })}
    </section>
  );
}

/** 홈에 꽂는 진행 칸 한 벌 — 계산·봤음 기록까지 */
export function HomeProgress(p: Parameters<typeof useGoalBar>[0]) {
  const { bar, now, mark } = useGoalBar(p);
  return <GoalProgress bar={bar} now={now} onSeen={mark} />;
}
