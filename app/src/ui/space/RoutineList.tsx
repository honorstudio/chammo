// 예약 목록(r:) — 기능 줄 시계를 누르면 가운데에(2026-10-12 패널 하나로 P4). 옛 펼친 메뉴의 '예약' 절이 하던 일 그대로:
// 이름 + 상태(점·도는 호) / 언제, 끝난 예약은 접힌 한 줄. 줄을 누르면 그 예약 화면(r:<이름>), 끌면 채팅에 참조 글
import { useState } from 'react';
import { groupRoutines, type RoutineItem } from '../../domain/routine';
import { tr } from '../../i18n';
import { IconChevron } from '../Icons';
import { dragProps } from './dragPath';

export function RoutineList({ routines, onOpen }: { routines: RoutineItem[]; onOpen: (name: string) => void }) {
  const [doneOpen, setDoneOpen] = useState(false);
  const g = groupRoutines(routines);
  const row = (r: RoutineItem) => (
    <button key={r.name} {...dragProps({ kind: 'text', text: r.ref }, r.name)} className="cv-row top sched rl-row" onClick={() => onOpen(r.name)} title={`${r.name} · ${r.status} · ${r.line}`}>
      <span className="sched-txt">
        <span className="sched-l1">
          <span className="cv-label">{r.name}</span>
          <span className={`sched-st st-${r.state}`}>
            {r.state === 'running' ? <span className="cv-spin" /> : r.state === 'ok' || r.state === 'done' ? <i className="sched-dot ok" /> : r.state === 'failed' ? <i className="sched-dot fail" /> : r.state === 'noReport' ? <i className="sched-dot ask" /> : null}
            {r.status}
          </span>
        </span>
        <span className="sched-l2">{r.line}</span>
      </span>
    </button>
  );
  return (
    <div className="rl-page">
      <header className="rl-head"><h2>{tr('예약', 'Scheduled')}</h2><span className="lk-count">{g.active.length}</span></header>
      {routines.length === 0 && <div className="cv-blank">{tr('예약이 없어요 — 참모에게 "매일 아침 …" 처럼 말하면 만들어 줘요', 'No scheduled jobs — ask your assistant ("every morning …")')}</div>}
      <div className="rl-list">{g.active.map(row)}</div>
      {g.done.length > 0 && (
        <>
          <button className="cv-row top sched-fold rl-row" onClick={() => setDoneOpen((v) => !v)} aria-expanded={doneOpen}>
            <span className={`cv-fold small ${doneOpen ? 'open' : ''}`} aria-hidden><IconChevron /></span>
            <span className="cv-label">{tr(`끝난 예약 ${g.done.length}개`, `${g.done.length} finished`)}</span>
          </button>
          {doneOpen && <div className="rl-list">{g.done.map(row)}</div>}
        </>
      )}
    </div>
  );
}
