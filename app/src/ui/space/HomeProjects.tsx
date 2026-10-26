// 홈 '지금 돌아가는 프로젝트' 칸(2026-10-25 사용자 시안 home-projects v1 A) — 참모 줄 아래 프로젝트 줄 목록, 급한 순.
// 목록 전체·줄 하나하나 접기(기억, domain/homeProjects Fold). 펼치기 전엔 홈이 창에 꽉 차 고정 — 목록 칸 높이에 맞춰 줄 수를 정하고 넘치면 '+N개 더'(fitRows)
import { useLayoutEffect, useRef, useState } from 'react';
import { FOLD_KEY, fitRows, readFold, toggleFold, writeFold, type Fold, type ProjRow, type ProjState } from '../../domain/homeProjects';
import { whenLabel } from '../../domain/orchHome';
import type { Session } from '../../domain/session';
import { tr } from '../../i18n';
import { IconChevron, IconChevronUp, IconMaximize } from '../Icons';
import { tailLines, useChatItems } from './useChatItems';

/** 줄 한 칸 높이(44 + 줄 사이 선 1) — fitRows 가 이걸로 센다. CSS .hd-prow min-height 와 같이 */
export const PROW_H = 45;
/** '+N개 더' 단추 자리(36 + 위 여백 4) — CSS .hd-pmore 와 같이 */
export const PMORE_H = 40;

const WORD: Record<ProjState, () => string> = {
  stop: () => tr('막힘', 'Blocked'), ask: () => tr('답 기다림', 'Needs you'), quiet: () => tr('오래 조용', 'Quiet'),
  run: () => tr('일하는 중', 'Working'), wait: () => tr('기다림', 'Waiting'), rest: () => tr('쉼', 'Idle'), done: () => tr('오늘 끝남', 'Done today'),
};
const Dot = ({ s }: { s: ProjState }) => <i className={`hd-d d-${s}`} aria-hidden="true" />;

/** 접힘 기억 — localStorage(이 기기만). 못 쓰면 이번 실행만 */
export function useProjFold(): [Fold, (t: Parameters<typeof toggleFold>[1]) => void] {
  const [fold, setFold] = useState<Fold>(() => { try { return readFold(localStorage.getItem(FOLD_KEY)); } catch { return readFold(null); } });
  const flip = (t: Parameters<typeof toggleFold>[1]) => setFold((f) => {
    const n = toggleFold(f, t);
    try { localStorage.setItem(FOLD_KEY, writeFold(n)); } catch { /* 이번 실행만 */ }
    return n;
  });
  return [fold, flip];
}

/** 펼친 줄이 지금 목록에 있나 — 있으면 홈이 창 맞춤을 풀고 그 칸이 늘어난다 */
export const projGrown = (fold: Fold, rows: ProjRow[]) => fold.list && (fold.more || rows.some((r) => fold.open.includes(r.name)));

/** 펼친 줄 안 — 그 프로젝트 세션 대화 끝 몇 줄(읽기만) */
function Tail({ s }: { s?: Session }) {
  const lines = tailLines(useChatItems(s?.sessionId, 4000), 3);
  return <div className="hd-ptail">{lines.length ? lines.map((t, i) => <p key={i}>{t}</p>) : <p className="hd-none">{s ? tr('대화 없음', 'No messages') : tr('세션이 꺼졌어', 'Session is off')}</p>}</div>;
}

export function HomeProjects({ rows, done, fold, onFold, fit, now, orchName, face, onAsk, onBig }: {
  rows: ProjRow[];
  done: ProjRow[];
  fold: Fold;
  onFold: (t: Parameters<typeof toggleFold>[1]) => void;
  /** 창 맞춤 중인가 — 아니면(펼침·좁은 창) 지난번 잰 줄 수 그대로 */
  fit: boolean;
  now: number;
  orchName: (id: string) => string | undefined;
  face: (id: string, size: number) => React.ReactNode;
  /** 맡은 참모에게 묻기 — 그 줄 아래 미니 대화(at = data-pop) */
  onAsk: (orch: string, at: string) => void;
  /** 크게 열기 — 그 세션 화면 */
  onBig: (target: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el || !fit) return;
    const ro = new ResizeObserver(() => setAvail(el.clientHeight));
    ro.observe(el);
    setAvail(el.clientHeight);
    return () => ro.disconnect();
  }, [fit, fold.list]);
  // 펼친 채로 처음 그리면(기억) 잰 적이 없다 — 창 높이의 40%쯤을 목록 칸으로 친다(창 맞춤일 때 프로젝트 칸 몫과 비슷)
  const cut = fitRows({ avail: avail || (fit ? 0 : Math.round(window.innerHeight * 0.4)), rowH: PROW_H, moreH: PMORE_H, n: rows.length });
  const shown = fold.more ? rows : rows.slice(0, cut.shown);
  const more = rows.length - shown.length;
  const count = (s: ProjState) => rows.filter((r) => r.state === s).length;
  const when = (r: ProjRow) => (r.state === 'wait' && r.until
    ? tr(`${new Date(r.until).getMonth() + 1}/${new Date(r.until).getDate()} 까지`, `until ${new Date(r.until).getMonth() + 1}/${new Date(r.until).getDate()}`)
    : whenLabel(r.at, now));

  return (
    <section className={`hd-card hd-a-proj${fold.list ? '' : ' shut'}`} aria-label={tr('프로젝트', 'Projects')}>
      <div className="hd-h hd-ph">
        <button className="hd-pfold" aria-expanded={fold.list} onClick={() => onFold({ list: true })} aria-label={fold.list ? tr('목록 접기', 'Collapse list') : tr('목록 펼치기', 'Expand list')} title={fold.list ? tr('목록 접기', 'Collapse list') : tr('목록 펼치기', 'Expand list')}>
          <span className="hd-pchev"><IconChevron /></span>
        </button>
        <b>{tr('프로젝트', 'Projects')}</b><span>{rows.length}</span>
        {!fold.list && (
          <span className="hd-psum">
            {(['stop', 'ask', 'quiet', 'run', 'wait'] as const).filter((s) => count(s)).map((s) => <span key={s}><Dot s={s} />{WORD[s]()} {count(s)}</span>)}
          </span>
        )}
        <span className="hd-sp" />
        {done.length > 0 && <span className="hd-pdone" title={done.map((d) => d.name).join(' · ')}><Dot s="done" />{tr(`오늘 끝남 ${done.length}`, `Done today ${done.length}`)}</span>}
      </div>
      {fold.list && (
        <div className="hd-plist" ref={list}>
          {shown.map((r) => {
            const open = fold.open.includes(r.name);
            const orch = r.orchs[0];
            const s0 = r.sessions[0];
            const sesName = s0 ? s0.workspace ?? s0.name : undefined;
            return (
              <div key={r.name} className={`hd-pcell${open ? ' on' : ''}${r.state === 'stop' || r.state === 'ask' ? ' hot' : ''}`}>
                <button className="hd-prow" data-pop={`proj:${r.name}`} aria-expanded={open} onClick={() => onFold({ row: r.name })}>
                  <Dot s={r.state} />
                  <b className="hd-pname">{r.name}</b>
                  <span className="hd-pline">{r.line}</span>
                  <span className="hd-pwho">
                    {r.orchs.slice(0, 2).map((id) => <span key={id} className="hd-pface">{face(id, 18)}</span>)}
                    {orch && <span className="hd-pnick">{orchName(orch)}</span>}
                    {sesName && <span className="hd-pses">{sesName}{r.sessions.length > 1 ? ` +${r.sessions.length - 1}` : ''}</span>}
                  </span>
                  <em className={`hd-pst s-${r.state}`}>{WORD[r.state]()}</em>
                  <span className="hd-pwhen">{when(r)}</span>
                  <span className="hd-pchev"><IconChevron /></span>
                </button>
                {open && (
                  <div className="hd-prowx">
                    <div className="hd-ptasks">
                      {r.tasks.length ? r.tasks.slice(0, 6).map((t) => (
                        <div key={t.task} className="hd-ptask"><Dot s={t.state} /><span>{t.title || t.target}</span><span className="hd-pwhen">{whenLabel(t.at, now)}</span></div>
                      )) : <p className="hd-none">{tr('맡긴 일 없음', 'No assigned work')}</p>}
                    </div>
                    <Tail s={s0} />
                    <div className="hd-pacts">
                      {orch && <button className="hd-tbtn" data-hpop="" onClick={() => onAsk(orch, `proj:${r.name}`)}>{tr(`${orchName(orch) ?? ''}에게 묻기`, `Ask ${orchName(orch) ?? ''}`)}</button>}
                      {(s0 || r.tasks[0]) && <button className="hd-ic" onClick={() => onBig(s0?.id ?? r.tasks[0]!.target)} aria-label={tr('크게 열기', 'Open large')} title={tr('크게 열기', 'Open large')}><IconMaximize /></button>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!rows.length && <p className="hd-none">{tr('돌아가는 프로젝트 없음', 'No active projects')}</p>}
          {(more > 0 || fold.more) && (
            fold.more
              ? <button className="hd-pmore" onClick={() => onFold({ more: true })} aria-label={tr('줄이기', 'Show less')} title={tr('줄이기', 'Show less')}><IconChevronUp /></button>
              : <button className="hd-pmore" onClick={() => onFold({ more: true })}>{tr(`+${more}개 더`, `+${more} more`)}</button>
          )}
        </div>
      )}
    </section>
  );
}
