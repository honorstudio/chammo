import { useEffect, useMemo, useRef, useState } from 'react';
import { lockerTodayFiles } from '../data/tauri';
import type { CodeToday } from '../domain/replay';
import { dayWindow } from '../domain/replay';
import type { TaskEvent } from '../domain/tasks';
import { nowSlot, todayCard, todayWork } from '../domain/todayStrip';
import { fmtNum, tr } from '../i18n';
import { IconReplay, IconToday } from './Icons';
import { useHoverCard } from './useHoverCard';

// 막대 그림 — 눈금 하나: 24칸 고르게, 높이는 그날 최댓값에 비례, 바닥 고정. 숫자는 봉우리 하나만
const W = 296;
const H = 66;
const BASE = 50;
const TALL = 40;
const BAR = 8;
const SLOT = W / 24;
const TICKS: [number, () => string][] = [[0, () => tr('5시', '5 AM')], [7, () => tr('12시', '12 PM')], [13, () => tr('18시', '6 PM')], [19, () => tr('0시', '12 AM')]];

const hourName = (slot: number) => {
  const h = (slot + 5) % 24;
  return tr(`${h}시`, `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`);
};

function DayBars({ hours, now }: { hours: number[]; now: number }) {
  const top = Math.max(1, ...hours);
  const peak = hours.indexOf(top);
  return (
    <svg className="tdy-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr('시간대별 끝낸 일', 'Done by hour')}>
      <line x1="0" x2={W} y1={BASE + 0.5} y2={BASE + 0.5} />
      {hours.map((v, i) => {
        if (!v) return null;
        const bh = Math.max(4, (v / top) * TALL);
        const x = i * SLOT + (SLOT - BAR) / 2;
        return (
          <g key={i}>
            <title>{tr(`${hourName(i)} ${v}개`, `${hourName(i)}, ${v} done`)}</title>
            <rect className="tdy-hit" x={i * SLOT} y={0} width={SLOT} height={BASE} />
            <rect className={i === now ? 'tdy-bar now' : 'tdy-bar'} x={x} y={BASE - bh} width={BAR} height={bh} rx={2} />
            {i === peak && <text x={x + BAR / 2} y={BASE - bh - 3} textAnchor="middle">{v}</text>}
          </g>
        );
      })}
      {TICKS.map(([i, name]) => <text key={i} x={i * SLOT + SLOT / 2} y={H - 2} textAnchor="middle">{name()}</text>)}
    </svg>
  );
}

/** 위 띠 '오늘 한 일' — 부하 칩 옆 아이콘 하나. 올리면 칸, 누르면 하루 기록(시안 docs/design-drafts/inbox-today T3, 2026-11-05 사용자) */
export function TodayChip({ events, code, onOpen }: { events: TaskEvent[]; code: CodeToday; onOpen: () => void }) {
  const chip = useRef<HTMLButtonElement>(null);
  const { at, open, close } = useHoverCard(chip);
  const [files, setFiles] = useState<number | null>(null);
  const win = dayWindow(new Date());
  const work = useMemo(() => todayWork(events, win), [events, win.start]); // eslint-disable-line react-hooks/exhaustive-deps
  const card = todayCard(work, code, files);
  const shown = !!at;
  // 보관함은 문서 폴더라 칸을 열 때만, 개발자 칸엔 안 나오니 그땐 안 읽는다
  useEffect(() => {
    if (!shown || !card.needsFiles) return;
    let live = true;
    lockerTodayFiles(win.start).then((n) => { if (live) setFiles(n); }).catch(() => {});
    return () => { live = false; };
  }, [shown, card.needsFiles, win.start]);
  const go = () => { close(true); onOpen(); };
  return <>
    <button ref={chip} type="button" className={`load-chip tdy-chip ${card.empty ? 'tdy-quiet' : ''} ${at ? 'on' : ''}`}
      aria-label={tr('오늘 한 일', "Today's work")} onMouseEnter={() => open()} onMouseLeave={() => close()} onFocus={() => open(true)} onBlur={() => close()} onClick={go}>
      <span className="tdy-ic"><IconToday /></span>
    </button>
    {at && (
      <div className="lc-card" role="dialog" aria-label={tr('오늘 한 일', "Today's work")} style={{ top: at.bottom + 6, left: Math.max(8, Math.min(at.left - 8, window.innerWidth - 340)) }}
        onMouseEnter={() => open(true)} onMouseLeave={() => close()}>
        {card.empty
          ? <div className="tdy-empty">{tr('아직 끝낸 일이 없어요', 'Nothing done yet')}</div>
          : <>
            <div className="lc-head tdy-head">
              <b>{tr(`오늘 ${fmtNum(work.done)}개 끝냈어요`, `${fmtNum(work.done)} done today`)}</b>
              <span className="tdy-since">{tr('새벽 5시부터', 'Since 5 AM')}</span>
              <button type="button" className="lc-ib" aria-label={tr('기록 열기', 'Open Replay')} title={tr('기록 열기', 'Open Replay')} onClick={go}><IconReplay /></button>
            </div>
            <DayBars hours={work.hours} now={nowSlot(win, Date.now())} />
            <div className="tdy-stats">{card.stats.map((s) => <div key={s.k}><b>{fmtNum(s.v)}</b><span>{s.k}</span></div>)}</div>
            {card.code && <div className="tdy-code"><span>{tr('저장소', 'Repos')} <b>{fmtNum(card.code.repos)}</b></span><span className="tdy-lines"><span className="plus">+{fmtNum(card.code.added)}</span> <span className="minus">−{fmtNum(card.code.deleted)}</span></span></div>}
          </>}
      </div>
    )}
  </>;
}
