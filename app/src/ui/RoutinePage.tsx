import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { openTarget } from '../data/tauri';
import { routineStateLabel, scheduleText, type Routine, type RoutineEvent, type RoutineState } from '../domain/routine';
import { tr } from '../i18n';
import { MdDoc } from './reader/Reader';
import { TerminalPane } from './TerminalPane';
import './reader/reader.css';

type Props = {
  routine: Routine;
  state: RoutineState;
  /** 지금 도는 이 루틴의 세션 id(있으면 오른쪽 위에 그 화면) */
  liveSession: string | null;
  claudeBin: string;
  fontSize: number;
  onAction: (action: 'run' | 'pause' | 'resume' | 'remove') => Promise<void>;
};

const when = (ts: string) => ts.replace('T', ' ').slice(5, 16);

function eventText(e: RoutineEvent): string {
  if (e.event === 'start') return e.error ? tr(`시작 실패 — ${e.error}`, `Could not start — ${e.error}`) : tr(e.session ? '시작' : '시작', 'Started');
  if (e.event === 'skip') return tr('건너뜀 — 지난 실행이 아직 도는 중', 'Skipped — the last run is still going');
  return `${e.result === 'fail' ? tr('실패', 'Failed') : tr('성공', 'OK')}${e.note ? ` — ${e.note}` : ''}`;
}

/** 루틴 화면 — 왼쪽 지침서, 오른쪽 지금 도는 세션 + 실행 기록(사용자 2026-09-28: "한쪽에는 지침서, 실제로 돌 땐 그게 보이게") */
export function RoutinePage({ routine: r, state, liveSession, claudeBin, fontSize, onAction }: Props) {
  const [md, setMd] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  useEffect(() => {
    const read = () => void invoke<string>('read_doc_text', { path: r.instructions }).then(setMd, () => setMd(null));
    read();
    const t = setInterval(read, 5000); // 지침서를 기본 앱에서 고치면 따라온다
    return () => clearInterval(t);
  }, [r.instructions]);
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 4000); return () => clearTimeout(t); }, [sure]);
  const act = async (a: 'run' | 'pause' | 'resume' | 'remove') => { setBusy(true); try { await onAction(a); } finally { setBusy(false); } };
  const runs = [...r.runs].reverse();
  return (
    <div className="routine">
      <div className="bar">
        <b>{r.name}</b>
        <span className="dim">{scheduleText(r.schedule)} · {r.next ? tr(`다음 ${when(r.next)}`, `Next ${when(r.next)}`) : tr('예약 없음', 'Not scheduled')} · {routineStateLabel(state)}</span>
        <span className="sp" />
        <button className="btn pri" disabled={busy || state === 'running'} onClick={() => void act('run')}>{tr('지금 실행', 'Run now')}</button>
        <button className="btn" disabled={busy} onClick={() => void act(r.enabled ? 'pause' : 'resume')}>{r.enabled ? tr('일시정지', 'Pause') : tr('다시 켜기', 'Resume')}</button>
        <button className="btn" onClick={() => void openTarget('file', r.instructions)}>{tr('지침서 고치기', 'Edit instructions')}</button>
        <button className="btn" disabled={busy} onClick={() => (sure ? void act('remove') : setSure(true))}>{sure ? tr('정말 지우기', 'Really delete') : tr('지우기', 'Delete')}</button>
      </div>
      <div className="routine-body">
        <section className="routine-doc">
          <div className="routine-h">{tr('지침서', 'Instructions')} <span className="dim">ROUTINE.md</span></div>
          {md == null ? <div className="rd-empty">{tr('지침서를 못 읽었어요', 'Could not read the instructions')}</div> : <MdDoc path={r.instructions} md={md} />}
        </section>
        <section className="routine-side">
          {liveSession && (
            <div className="routine-live">
              <TerminalPane command={`exec '${claudeBin}' attach ${liveSession}`} title={tr('지금 도는 중', 'Running now')} subtitle={`routine-${r.name}`} fontSize={fontSize} linkBase={r.cwd} />
            </div>
          )}
          <div className="routine-h">{tr('실행 기록', 'Runs')}</div>
          <ol className="routine-runs">
            {runs.length === 0 && <li className="dim">{tr('아직 한 번도 안 돌았어요. "지금 실행"으로 시험해 보세요.', 'Never run yet. Try "Run now".')}</li>}
            {runs.map((e, i) => (
              <li key={i} className={e.event === 'end' ? (e.result === 'fail' ? 'fail' : 'ok') : e.event}>
                <span className="t">{when(e.ts)}</span>
                <span>{eventText(e)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
