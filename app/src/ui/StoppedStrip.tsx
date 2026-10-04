import { useState } from 'react';
import type { StoppedSession } from '../domain/stopped';
import { resumeSession } from '../data/tauri';
import { IconResume } from './Icons';
import { tr } from '../i18n';

const REASON = (): Record<StoppedSession['reason'], string> => ({ stopped: tr('끔', 'Stopped'), done: tr('끝남', 'Done'), failed: tr('비정상 종료', 'Crashed') });

const when = (ms: number) =>
  ms ? new Date(ms).toLocaleString(tr('ko-KR', 'en-US'), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

/** 프로젝트의 꺼진 세션 — "이어서"를 누르면 같은 대화 그대로 다시 뜬다 */
type Props = { list: StoppedSession[]; onDone: (m: string | null) => void; onPending: (sessionId: string) => void };

export function StoppedStrip({ list, onDone, onPending }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!list.length) return null;
  const resume = async (s: StoppedSession) => {
    if (busy) return; // 하나 이어가는 동안엔 다른 것도 막는다
    setBusy(s.id);
    onPending(s.sessionId); // 목록이 갱신되기 전(3초)에 또 눌러 복사본이 생기지 않게 바로 숨긴다
    try {
      await resumeSession(s.cwd, s.sessionId, s.id);
      onDone(null);
    } catch (e: unknown) {
      onDone(tr(`이어서 띄우기 실패: ${String(e)}`, `Resume failed: ${String(e)}`));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="strip">
      <span className="dim">{tr('꺼진 세션', 'Stopped sessions')} {list.length}</span>
      {list.slice(0, 8).map((s) => (
        <span key={s.id} className="chip" title={`${s.cwd} · ${s.sessionId}`}>
          <b>{s.name || s.project}</b>
          <span className="dim">{REASON()[s.reason]} · {when(s.startedAt)}</span>
          <button className="ib" title={tr('이어서', 'Resume')} aria-label={tr('이어서', 'Resume')} disabled={busy != null} onClick={() => void resume(s)}>
            <IconResume />
          </button>
        </span>
      ))}
    </div>
  );
}
