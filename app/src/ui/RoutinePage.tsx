import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { openTarget } from '../data/tauri';
import { cloudUrl, isCloud, routineRef, routineStateLabel, runEventText, scheduleText, type Routine, type RoutineState } from '../domain/routine';
import { assistant, josa, machine, tr } from '../i18n';
import { MdDoc } from './reader/Reader';
import { TerminalPane } from './TerminalPane';
import './reader/reader.css';
import { attachCommand } from '../domain/termCommand';
import { IconPause, IconPencil, IconPlay, IconPower, IconSend, IconTrash } from './Icons';
import { dragProps } from './space/dragPath';

type Props = {
  routine: Routine;
  state: RoutineState;
  /** 지금 도는 이 루틴의 세션 id(있으면 오른쪽 위에 그 화면) */
  liveSession: string | null;
  claudeBin: string;
  fontSize: number;
  onAction: (action: 'run' | 'pause' | 'resume' | 'remove') => Promise<void>;
  /** 지금 채팅 참모 입력칸에 이 예약 참조 글을 넣는다(없으면 버튼 없음) */
  onToChat?: (text: string) => void;
};

const when = (ts: string) => ts.replace('T', ' ').slice(5, 16);

/** 예약(루틴) 화면 — 로컬(launchd)은 지침서·실행 기록, 클라우드(claude.ai)는 설명과 "열기"만 */
export function RoutinePage(props: Props) {
  return isCloud(props.routine) ? <CloudRoutinePage routine={props.routine} onToChat={props.onToChat} /> : <LocalRoutinePage {...props} />;
}

/** 클라우드 루틴 — 여기서 돌리지 않는다. 실행·일시정지·지우기·기록은 claude.ai 에서(주소를 기본 브라우저로) */
function CloudRoutinePage({ routine: r, onToChat }: { routine: Routine; onToChat?: (text: string) => void }) {
  const url = cloudUrl(r);
  return (
    <div className="routine">
      <div className="bar">
        <b className="routine-name" {...dragProps({ kind: 'text', text: routineRef(r) }, r.name)} title={tr(`끌어서 ${assistant()} 입력칸에 넣기`, 'Drag into the assistant input')}>{r.name}</b>
        <span className="tag rt-cloud">{tr('클라우드', 'Cloud')}</span>
        <span className="dim">{scheduleText(r.schedule)} · {tr('claude.ai 에서 돌아요', 'Runs on claude.ai')}</span>
        <span className="sp" />
        {onToChat && <ToChatButton text={routineRef(r)} onToChat={onToChat} />}
        <button className="btn pri" disabled={!url} onClick={() => url && void openTarget('url', url).catch(() => {})}>{tr('열기', 'Open')}</button>
      </div>
      <div className="routine-body routine-cloud-body">
        <section className="routine-doc">
          <div className="routine-h">{tr('클라우드 예약', 'Cloud schedule')}</div>
          <dl className="routine-cloud">
            <dt>{tr('일정', 'Schedule')}</dt>
            <dd>{scheduleText(r.schedule)}</dd>
            {r.note && (<><dt>{tr('메모', 'Note')}</dt><dd>{r.note}</dd></>)}
            <dt>{tr('주소', 'Address')}</dt>
            <dd className="mono">{url ?? tr('주소가 없거나 https 가 아니에요', 'No https address')}</dd>
          </dl>
          <p className="routine-cloud-help dim">
            {tr(`이 예약은 이 ${josa(machine(), '이', '가')} 아니라 claude.ai 클라우드에서 돌아요. 실행·일시정지·지우기와 실행 기록은 "열기"로 claude.ai 에서 보세요. 목록에서만 빼려면 `,
              `This job runs in the claude.ai cloud, not on this ${machine()}. Run, pause, delete it and see its runs on claude.ai via "Open". To drop it from this list only: `)}
            <code>scripts/routine cloud remove {r.name}</code>
          </p>
        </section>
      </div>
    </div>
  );
}

/** 로컬 루틴 화면 — 왼쪽 지침서, 오른쪽 지금 도는 세션 + 실행 기록(사용자 2026-09-28: "한쪽에는 지침서, 실제로 돌 땐 그게 보이게") */
function LocalRoutinePage({ routine: r, state, liveSession, claudeBin, fontSize, onAction, onToChat }: Props) {
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
        <b className="routine-name" {...dragProps({ kind: 'text', text: routineRef(r) }, r.name)} title={tr(`끌어서 ${assistant()} 입력칸에 넣기`, 'Drag into the assistant input')}>{r.name}</b>
        <span className="dim">{[r.once ? `${scheduleText(r.schedule)} · ${tr('한 번', 'once')}` : scheduleText(r.schedule), r.next ? tr(`다음 ${when(r.next)}`, `Next ${when(r.next)}`) : r.once ? '' : tr('다음 없음', 'Nothing next'), routineStateLabel(state)].filter(Boolean).join(' · ')}</span>
        <span className="sp" />
        {/* 글 버튼 넷 → 아이콘(2026-10-02 사용자). 이름은 title·aria-label 로 */}
        <div className="routine-acts">
          {onToChat && <ToChatButton text={routineRef(r)} onToChat={onToChat} />}
          <button className="ib" disabled={busy || state === 'running'} title={tr('지금 실행', 'Run now')} aria-label={tr('지금 실행', 'Run now')} onClick={() => void act('run')}><IconPlay /></button>
          <button className="ib" disabled={busy} title={r.enabled ? tr('일시정지', 'Pause') : tr('다시 켜기', 'Resume')} aria-label={r.enabled ? tr('일시정지', 'Pause') : tr('다시 켜기', 'Resume')}
            onClick={() => void act(r.enabled ? 'pause' : 'resume')}>{r.enabled ? <IconPause /> : <IconPower />}</button>
          <button className="ib" title={tr('지침서 고치기 — 기본 앱으로 열기', 'Edit instructions — open in the default app')} aria-label={tr('지침서 고치기', 'Edit instructions')} onClick={() => void openTarget('file', r.instructions)}><IconPencil /></button>
          <button className={`ib danger ${sure ? 'armed' : ''}`} disabled={busy} title={sure ? tr('한 번 더 누르면 지워요', 'Click again to delete') : tr('지우기', 'Delete')} aria-label={sure ? tr('정말 지우기', 'Really delete') : tr('지우기', 'Delete')}
            onClick={() => (sure ? void act('remove') : setSure(true))}><IconTrash /></button>
        </div>
      </div>
      <div className="routine-body">
        <section className="routine-doc">
          <div className="routine-h">{tr('지침서', 'Instructions')} <span className="dim">ROUTINE.md</span></div>
          {md == null ? <div className="rd-empty">{tr('지침서를 못 읽었어요', 'Could not read the instructions')}</div> : <MdDoc path={r.instructions} md={md} />}
        </section>
        <section className="routine-side">
          {liveSession && (
            <div className="routine-live">
              <TerminalPane command={attachCommand(claudeBin, liveSession)} title={tr('지금 도는 중', 'Running now')} subtitle={`routine-${r.name}`} fontSize={fontSize} linkBase={r.cwd} />
            </div>
          )}
          <div className="routine-h">{tr('실행 기록', 'Runs')}</div>
          <ol className="routine-runs">
            {runs.length === 0 && <li className="dim">{tr('아직 한 번도 안 돌았어요. "지금 실행"으로 시험해 보세요.', 'Never run yet. Try "Run now".')}</li>}
            {runs.map((e, i) => (
              <li key={i} className={e.event === 'end' ? (e.result === 'fail' ? 'fail' : 'ok') : e.event === 'stall' ? 'fail' : e.event === 'retry' ? 'skip' : e.event}>
                <span className="t">{when(e.ts)}</span>
                <span>{runEventText(e)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

/** 채팅 참모 입력칸에 참조 글 넣기 — 보내지는 않는다(Enter 는 사용자가) */
function ToChatButton({ text, onToChat }: { text: string; onToChat: (text: string) => void }) {
  return (
    <button className="ib" title={tr(`${assistant()} 입력칸에 넣기 — 끌어다 놓아도 돼요`, 'Put in the assistant input — or drag it there')} aria-label={tr(`${assistant()} 입력칸에 넣기`, 'Put in the assistant input')}
      onClick={() => onToChat(text)}><IconSend /></button>
  );
}
