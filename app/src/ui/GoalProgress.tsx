// 참모 홈 맨 위 '진행' 칸 — 데스크톱 스페이스 홈과 폰 홈이 같이 쓴다(시안 docs/design-drafts/progress-bar v2, 사용자 10-23 확정: 홈에만).
// 목표마다 한 줄(이름 · 조각 막대 · 끝/전체 · 마지막 기척), 줄을 누르면 그 자리에서 일 목록. 계산은 domain/goalBar.
// 끝난 조각은 결과 한 줄과 남아 있다가 앱이 앞에 있고 그 줄이 4초 보이면 한 번 반짝이고 접히며 사라진다(동작 줄이기면 페이드만)
// 줄 끝 말풍선 단추 = 참모에게 묻기 — 그 일(#task1)·목표(#goal1)가 이 참모 입력칸에 참조로 들어간다(2026-10-23 사용자 폰 '이게 뭐지?'). 홈 대시보드는 그 자리 미니 대화 입력칸(10-26)
// 다른 참모에게 넘긴 큰 일 칸은 받은 쪽 진행만큼 채워지고, 펼치면 '백엔드가 하는 중 — 2/5' 와 받은 쪽 일 목록(읽기만). 받은 쪽 줄엔 '기획이 넘김'
// 머리줄 끝 단추로 칸 전체를 접는다(10-28 사용자 'PM 이') — 접히면 머리줄 한 줄에 목표마다 블록(domain/goalFold), 올리면 이름·n/m 말풍선, 누르면 펼치며 그 목표로. 기억은 참모·자리마다(ui/goalFold)
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { foldBlocks, type FoldBlock } from '../domain/goalFold';
import { goalBar, goalRows, isEnded, type Cell, type CellState, type Goal, type Hand, type Wait } from '../domain/goalBar';
import { whenLabel } from '../domain/orchHome';
import type { Session } from '../domain/session';
import type { TaskEvent } from '../domain/tasks';
import { josa, tr } from '../i18n';
import { isAttended, onAttention } from './attention';
import { useGoalFold } from './goalFold';
import { useGoalSeen } from './goalSeen';
import { goalRefText, taskRefText, type RefJob } from '../domain/refChips';
import { IconChatSend, IconChevron, IconChevronDown, IconChevronUp } from './Icons';
import { askRef, type RefAsk } from './refBus';
import './goalProgress.css';

const SEEN_MS = 4000;

/** 기다림 한 줄 — '애플 심사 기다림 · 10/24 18:00까지', 사용자 몫이면 '사용자 몫 · 앱 비밀번호 4개'. 날짜만 준 일은 그날 끝(23:59)까지라 시각을 안 쓴다 */
export const waitWord = (w: Wait): string => {
  const d = w.until === undefined ? undefined : new Date(w.until);
  const day = d && `${d.getMonth() + 1}/${d.getDate()}`;
  const until = !d || !day ? '' : d.getHours() === 23 && d.getMinutes() === 59
    ? tr(`${day}까지`, `until ${day}`)
    : (() => { const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; return tr(`${day} ${hm}까지`, `until ${day} ${hm}`); })();
  const why = w.on === 'user' ? tr(`사용자 몫 · ${w.why}`, `Yours · ${w.why}`) : /기다림$|^waiting/i.test(w.why) ? w.why : tr(`${w.why} 기다림`, `Waiting for ${w.why}`);
  return until ? `${why} · ${until}` : why;
};

const stateWord = (c: Cell, now: number): string => {
  const m: Record<CellState, string> = {
    done: tr('끝', 'Done'), auto: tr('끝 · 앱이 닫음', 'Done · closed by app'),
    ask: c.wait?.on === 'user' ? waitWord(c.wait) : tr('답 기다림', 'Needs you'), wait: c.wait ? waitWord(c.wait) : tr('기다림', 'Waiting'),
    run: c.fill !== undefined ? tr(`일하는 중 · 할 일 ${Math.round(c.fill * 100)}%`, `Working · ${Math.round(c.fill * 100)}%`) : tr('일하는 중', 'Working'),
    quiet: tr(`${Math.max(3, Math.floor((now - (c.at ?? now)) / 3600_000))}시간 조용`, `Quiet ${Math.max(3, Math.floor((now - (c.at ?? now)) / 3600_000))}h`),
    stop: tr('멈춤 · 세션 꺼짐', 'Stopped · session ended'), rest: tr('쉬는 중', 'Idle'), todo: '',
  };
  return m[c.state];
};
/** 넘긴 칸 펼친 머리 한 줄 — 받은 참모가 어디까지 왔나 */
const handWord = (h: Hand, ended: boolean): string => {
  const n = `${h.done}/${h.total}`;
  if (ended) return h.total ? tr(`${josa(h.to, '이', '가')} 끝냄 — ${n}`, `${h.to} finished — ${n}`) : tr(`${josa(h.to, '이', '가')} 끝냄`, `${h.to} finished`);
  if (!h.total) return tr(`${h.to}에게 넘김 — 아직 나눈 일 없음`, `Handed to ${h.to} — no tasks yet`);
  if (h.done === h.total) return tr(`${h.to} 일 다 끝남 — ${n}`, `${h.to}: all done — ${n}`);
  return tr(`${josa(h.to, '이', '가')} 하는 중 — ${n}`, `${h.to} working — ${n}`);
};
const cellWord = (c: Cell, now: number) => (c.hand && !isEnded(c.state) && c.state !== 'ask' ? handWord(c.hand, false) : stateWord(c.hand ? { ...c, fill: undefined } : c, now));
const refJob = (c: Cell, now: number): RefJob => ({ title: c.title, task: c.task, target: c.hand ? c.hand.to : c.target, state: cellWord(c, now) });

/** 참모에게 묻기 — 데스크톱은 줄에 올리면 보이고, 폰(마우스 없음)은 늘 보인다. 누르는 자리는 폰 44px */
function AskBtn({ what, onClick }: { what: 'task' | 'goal'; onClick: () => void }) {
  const label = what === 'task' ? tr('참모에게 묻기 — 이 일을 입력칸에 #참조로', 'Ask your assistant — put this task in the input') : tr('참모에게 묻기 — 이 목표를 입력칸에 #참조로', 'Ask your assistant — put this goal in the input');
  return <button type="button" className="gp-ref" data-hpop="" aria-label={label} title={label} onClick={onClick}><span className="gp-ref-dot" aria-hidden><IconChatSend /></span></button>;
}
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
  const runIds = [...new Set(base.goals.flatMap((g) => g.cells.filter((c) => c.state === 'run' && !c.hand).map((c) => sessions.find((s) => s.id === c.target || s.name === c.target)?.sessionId).filter((x): x is string => !!x)))].join(',');
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

/** 줄(접힌 때는 접힌 막대)이 앱 앞·화면 안에서 SEEN_MS 동안 보이면 한 번 부른다 */
function useSeenWatch<T extends HTMLElement>(units: string[], onSeen: (units: string[]) => void) {
  const ref = useRef<T>(null);
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

function GoalRow({ g, name, now, open, onToggle, leaving, onLeave, onGone, onAsk }: {
  g: Goal; name: string; now: number; open: boolean; onToggle: () => void; onAsk?: (r: RefAsk) => void;
  leaving: Set<string>; onLeave: (units: string[]) => void; onGone: (units: string[]) => void;
}) {
  const units = g.finished ? [g.unit!] : g.cells.filter((c) => c.unit).map((c) => c.unit!);
  const ref = useSeenWatch<HTMLDivElement>(units, onLeave);
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
  const jobs = g.cells.filter((c) => c.state !== 'todo');
  const todo = g.cells.length - jobs.length;
  // 기다림만 남은 목표 — 줄 오른쪽 '기다림' 한 단어 + 사유 한 줄(첫 사유 + 나머지 개수)
  const waits = g.waiting ? g.cells.filter((c) => c.state === 'wait' && c.wait) : [];
  return (
    <div ref={ref} data-gk={g.key} className={`gp-row${g.finished ? ' gp-fin' : ''}${going ? ' gp-leave' : ''}${g.name ? '' : ' gp-etc'}`}
      onAnimationEnd={(e) => {
        if (e.animationName === 'gp-fold' || e.animationName === 'gp-fade') { if (e.target === e.currentTarget) onGone([g.unit!]); }
        else if (e.animationName === 'gp-shrink' || e.animationName === 'gp-cfade') { const u = (e.target as HTMLElement).dataset.unit; if (u) onGone([u]); }
      }}>
      <div className="gp-top">
      <button type="button" className="gp-line" onClick={onToggle} aria-expanded={open}
        aria-label={tr(`${name} — ${g.done}/${g.total}`, `${name} — ${g.done}/${g.total}`)}>
        <span className="gp-chev" aria-hidden><IconChevron /></span>
        <span className="gp-name">{name}</span>
        <span className="gp-bar" aria-hidden>
          {g.cells.map((c) => (
            <i key={c.task} data-unit={c.unit} className={`gp-c gp-${c.state}${c.hand ? ' gp-hand' : ''}${c.unit && leaving.has(c.unit) ? ' gp-cleave' : ''}`}
              style={c.fill !== undefined ? ({ '--gp-f': `${Math.round(c.fill * 100)}%` } as CSSProperties) : undefined}
              title={c.state === 'todo' ? tr('아직 안 보냄', 'Not sent yet') : `${c.title} — ${cellWord(c, now)}`} />
          ))}
        </span>
        <span className="gp-num"><b>{g.done}</b> / {g.total}</span>
        {g.waiting ? <span className="gp-when gp-waiting">{tr('기다림', 'Waiting')}</span> : <span className="gp-when">{whenLabel(g.lastAt, now)}</span>}
      </button>
      {onAsk && <AskBtn what="goal" onClick={() => onAsk({ kind: 'goal', who: tr('목표', 'Goal'), text: goalRefText({ name, done: g.done, total: g.total, jobs: jobs.map((c) => refJob(c, now)) }) })} />}
      </div>
      {waits.length > 0 && !open && <div className="gp-waitline">{waitWord(waits[0]!.wait!)}{waits.length > 1 ? tr(` 외 ${waits.length - 1}`, ` +${waits.length - 1}`) : ''}</div>}
      {g.handedBy && <div className="gp-from">{tr(`${josa(g.handedBy, '이', '가')} 넘김`, `Handed over by ${g.handedBy}`)}</div>}
      {g.finished && g.result && <div className="gp-result">{tr('끝', 'Done')} · {g.result}</div>}
      {open && (
        <div className="gp-jobs">
          {jobs.map((c) => (
            <Fragment key={c.task}>
              {/* 큰 일 하나만 넘긴 줄은 줄 이름이 곧 그 일 — 같은 글을 두 번 안 쓴다 */}
              {!(c.hand && jobs.length === 1 && c.title === g.name) && (
                <div className="gp-job">
                  <i className={`gp-k gp-${c.state}`} aria-hidden />
                  <span className="gp-jt">{c.title}</span>
                  <span className="gp-js">{c.hand ? c.hand.to : c.target}</span>
                  <span className={`gp-tag gp-t-${tone(c.state)}`}>{c.hand ? stateWord({ ...c, fill: undefined }, now) : stateWord(c, now)}</span>
                  <span className="gp-when">{whenLabel(c.at ?? 0, now)}</span>
                  {onAsk && <AskBtn what="task" onClick={() => onAsk({ kind: 'task', who: tr('일', 'Task'), text: taskRefText(refJob(c, now)) })} />}
                </div>
              )}
              {c.hand && <HandBlock h={c.hand} ended={isEnded(c.state)} now={now} />}
            </Fragment>
          ))}
          {todo > 0 && <div className="gp-job gp-todo-line"><i className="gp-k gp-todo" aria-hidden /><span className="gp-jt">{tr(`아직 안 보낸 일 ${todo}`, `${todo} not sent yet`)}</span></div>}
        </div>
      )}
    </div>
  );
}

/** 넘긴 큰 일 — 받은 참모가 어디까지 왔나 한 줄 + 그쪽 일 목록(읽기만) */
function HandBlock({ h, ended, now }: { h: Hand; ended: boolean; now: number }) {
  return (
    <div className="gp-hand-box">
      <div className="gp-hand-head">{handWord(h, ended)}</div>
      {h.jobs.map((c) => (
        <div key={c.task} className="gp-sj">
          <i className={`gp-k gp-${c.state}`} aria-hidden />
          <span className="gp-jt">{c.title}</span>
          <span className="gp-js">{c.target}</span>
          <span className={`gp-tag gp-t-${tone(c.state)}`}>{stateWord(c, now)}</span>
          <span className="gp-when">{whenLabel(c.at ?? 0, now)}</span>
        </div>
      ))}
      {h.todo > 0 && <div className="gp-sj gp-todo-line"><i className="gp-k gp-todo" aria-hidden /><span className="gp-jt">{tr(`아직 안 보낸 일 ${h.todo}`, `${h.todo} not sent yet`)}</span></div>}
    </div>
  );
}

/** 접힌 막대 블록 하나 — 폭은 전체 칸 중 그 목표 몫, 안은 칸 상태별로 끝난 것부터 */
function FoldBlockBtn({ b, going, onPick, onTip, onGone }: { b: FoldBlock; going: boolean; onPick: () => void; onTip: (el: HTMLElement | null) => void; onGone: () => void }) {
  const label = tr(`${b.name} — ${b.done}/${b.total}`, `${b.name} — ${b.done}/${b.total}`);
  return (
    <button type="button" className={`gp-blk${going ? ' gp-cleave' : ''}`} style={{ flexGrow: b.share }} aria-label={label} onClick={onPick}
      onAnimationEnd={(e) => { if (e.target === e.currentTarget && (e.animationName === 'gp-shrink' || e.animationName === 'gp-cfade')) onGone(); }}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') onTip(e.currentTarget); }} onPointerLeave={() => onTip(null)}>
      <span className="gp-blk-in">
        {b.parts.map((p) => <i key={p.state} className={`gp-fp gp-${p.state}`} style={{ flexGrow: p.n }} />)}
      </span>
    </button>
  );
}

/** 진행 칸 — 목표가 없으면 안 그린다. fold 를 주면 머리줄에 접기 단추 */
export function GoalProgress({ bar, now, onSeen, onAsk, fold }: {
  bar: ReturnType<typeof goalBar>; now: number; onSeen: (units: string[]) => void; onAsk?: (r: RefAsk) => void;
  fold?: [boolean, (on: boolean) => void];
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [folded, setFolded] = fold ?? [false, undefined];
  const blocks = useMemo(() => (folded ? foldBlocks(bar) : []), [bar, folded]);
  // 말풍선 — 진행 칸이 스크롤 칸(.hm > .gp)이라 칸 밖으로 띄운다(position: fixed). 위가 모자라면 아래로
  const [tip, setTip] = useState<{ b: FoldBlock; x: number; y: number; below: boolean } | null>(null);
  const showTip = (b: FoldBlock) => (el: HTMLElement | null) => {
    if (!el) { setTip(null); return; }
    const r = el.getBoundingClientRect();
    const below = r.top < 40;
    setTip({ b, x: Math.min(Math.max(r.left + r.width / 2, 100), window.innerWidth - 100), y: below ? r.bottom + 4 : r.top - 4, below });
  };
  // 블록을 누르면 펼친 뒤 그 목표 줄로
  const box = useRef<HTMLElement>(null);
  const [go, setGo] = useState<string | null>(null);
  useEffect(() => {
    if (!go || folded) return;
    [...(box.current?.querySelectorAll<HTMLElement>('[data-gk]') ?? [])].find((el) => el.dataset.gk === go)?.scrollIntoView({ block: 'nearest' });
    setGo(null);
  }, [go, folded]);
  const toggle = (k: string) => setOpen((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const leave = (units: string[]) => setLeaving((p) => new Set([...p, ...units]));
  const gone = (units: string[]) => { setLeaving((p) => { const n = new Set(p); units.forEach((u) => n.delete(u)); return n; }); onSeen(units); };
  // 접힌 동안엔 펼친 줄이 없어 봤음 감시가 멈춘다 — 접힌 막대가 대신 같은 감시(4초·앱 앞)로 끝난 목표를 거둔다(사용자 10-28)
  const foldUnits = useMemo(() => [...new Set(blocks.flatMap((b) => b.units))], [blocks]);
  const foldRef = useSeenWatch<HTMLSpanElement>(folded ? foldUnits : [], leave);
  // 떠나는 효과가 안 와도(창이 숨음) 빠지게
  useEffect(() => {
    if (!folded) return;
    const out = foldUnits.filter((u) => leaving.has(u));
    if (!out.length) return;
    const t = window.setTimeout(() => gone(out), 1600);
    return () => window.clearTimeout(t);
  }, [folded, leaving, foldUnits]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!bar.goals.length) return null;
  const pick = (b: FoldBlock) => {
    setTip(null);
    if (b.keys.length === 1) setOpen((p) => new Set(p).add(b.key)); // '그 밖' 블록은 펼치기만
    setGo(b.keys[0] ?? null);
    setFolded?.(false);
  };
  const foldLabel = folded ? tr('진행 칸 펼치기', 'Expand progress') : tr('진행 칸 접기', 'Collapse progress');
  return (
    <section ref={box} className={`gp${folded ? ' gp-folded' : ''}`} aria-label={tr('진행', 'Progress')}>
      <div className="gp-head">
        <b>{tr('진행', 'Progress')}</b><span className="gp-num"><b>{bar.done}</b> / {bar.total}</span>
        {folded ? <span ref={foldRef} className="gp-fold">{blocks.map((b) => <FoldBlockBtn key={b.key} b={b} going={b.done === b.total && b.units.length > 0 && b.units.every((u) => leaving.has(u))} onPick={() => pick(b)} onTip={showTip(b)} onGone={() => gone(b.units)} />)}</span> : <span className="gp-sp" />}
        {setFolded && (
          <button type="button" className="gp-foldbtn" aria-label={foldLabel} title={foldLabel} aria-expanded={!folded} onClick={() => { setTip(null); setFolded(!folded); }}>
            {folded ? <IconChevronDown /> : <IconChevronUp />}
          </button>
        )}
      </div>
      {folded && tip && (
        <span className={`gp-tip${tip.below ? ' gp-below' : ''}`} role="tooltip" style={{ left: tip.x, top: tip.y }}>
          {tip.b.name}<span className="gp-num"><b>{tip.b.done}</b> / {tip.b.total}</span>
        </span>
      )}
      {!folded && goalRows(bar).map(({ goal: g, head, name }) => {
        return (
          <Fragment key={g.key}>
            {head !== undefined && <div className="gp-proj">{head}</div>}
            <GoalRow g={g} name={name} now={now} open={open.has(g.key)} onToggle={() => toggle(g.key)} leaving={leaving} onLeave={leave} onGone={gone} onAsk={onAsk} />
          </Fragment>
        );
      })}
    </section>
  );
}

/** 홈에 꽂는 진행 칸 한 벌 — 계산·봤음 기록까지 */
/** onAsk 를 안 주면 그 참모 입력칸으로(askRef) — 홈 대시보드는 그 자리 미니 대화로 받는다. place = 접힘 기억 자리(스페이스 홈·폰 'home', 홈 대시보드 'dash') */
export function HomeProgress({ onAsk, place = 'home', ...p }: Parameters<typeof useGoalBar>[0] & { onAsk?: (r: RefAsk) => void; place?: 'home' | 'dash' }) {
  const { bar, now, mark } = useGoalBar(p);
  const fold = useGoalFold(`${place}:${p.orch.id}`);
  return <GoalProgress bar={bar} now={now} onSeen={mark} onAsk={onAsk ?? ((r) => askRef(p.orch.id, r))} fold={fold} />;
}
