// 예약 판(시안 A4) — 공간머리 예약 버튼으로 들어온다. 줄을 누르면 펼쳐서 [지금 실행] [일시정지·다시 켜기] [지침서].
// 지금 실행은 한 번 더 눌러야 돈다(데스크톱 지우기처럼, 2026-10-02 참모-2 결정 ④). 클라우드 예약은 목록만(실행은 claude.ai)
import { useEffect, useState } from 'react';
import { routineDo, routinesList } from '../../data/web';
import { groupRoutines, isCloud, parseRoutines, routineItem, routineSummary, type Routine } from '../../domain/routine';
import { IconBack } from '../Icons';
import type { Session } from '../../domain/session';
import { FileView } from './FileView';
import { remember, remembered } from './memo';
import { Notice, type NoticeMsg } from './Notice';

const dot = (s: string) => (s === 'running' ? 'st-work' : s === 'failed' || s === 'noReport' ? 'st-wait' : s === 'paused' || s === 'done' ? 'st-off' : 'st-done');

export function RoutineBoard({ sessions, onBack }: { sessions: Session[]; onBack: () => void }) {
  const [tick, setTick] = useState(0);
  // 목록 — 못 읽으면 이유를 따로(빈 목록이 '예약 없음'인지 '못 읽음'인지 갈라야 한다, 2026-10-03 사용자). 못 읽어도 마지막으로 읽은 목록은 남긴다
  const [raw, setRaw] = useState<string | null>(() => remembered<string>('routines') ?? null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const pull = async () => {
      try { const t = await routinesList(); remember('routines', t); if (alive) { setRaw(t); setErr(null); } } catch (e) { if (alive) setErr((e as Error).message); }
      if (alive) timer = window.setTimeout(() => void pull(), 10_000);
    };
    void pull();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [tick]);
  const routines = parseRoutines(raw ?? '[]');
  const [openName, setOpenName] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<NoticeMsg | null>(null);
  const [doc, setDoc] = useState<Routine | null>(null);
  const now = new Date();
  const items = routines.map((r) => ({ r, ...routineItem(r, sessions, now) }));
  const { active, done } = groupRoutines(items);

  const act = async (r: Routine, action: 'run' | 'pause' | 'resume') => {
    if (action === 'run' && armed !== r.name) {
      setArmed(r.name);
      window.setTimeout(() => setArmed((a) => (a === r.name ? null : a)), 4000);
      return;
    }
    setArmed(null);
    setBusy(r.name);
    setMsg(null);
    try {
      await routineDo(r.name, action);
      setMsg({ text: action === 'run' ? `${r.name} 시작했어요` : action === 'pause' ? `${r.name} 일시정지` : `${r.name} 다시 켬`, error: false });
      setTick((t) => t + 1);
    } catch (e) {
      setMsg({ text: `못 했어요: ${(e as Error).message}`, error: true });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="m-dash">
      <header className="m-dash-head">
        <div className="m-dash-row">
          <button type="button" className="m-rt-btn m-ico" onClick={onBack} aria-label="대시보드로" title="대시보드로"><IconBack /></button>
          <div className="m-dash-title">예약</div>
        </div>
        <div className="m-sm m-rt-sum">{raw === null ? (err ? '예약 목록을 못 읽었어요' : '불러오는 중…') : routineSummary(routines, now)}</div>
      </header>
      {err && <div className="m-error" role="status">{err}</div>}
      {msg && <Notice text={msg.text} error={msg.error} onClose={() => setMsg(null)} />}
      <div className="m-rt-list">
        {active.map(({ r, state, status, line }) => (
          <div key={r.name} className="m-rt">
            <button type="button" className="m-rt-row" onClick={() => setOpenName(openName === r.name ? null : r.name)} aria-expanded={openName === r.name}>
              <span className={`st-dot ${dot(state)}`} />
              <span className="m-rt-mid">
                <b>{r.name}</b>
                <span>{line}</span>
                {r.last?.note && <span className="m-muted">지난번: {r.last.note}</span>}
              </span>
              <span className="m-muted m-sm">{status}</span>
            </button>
            {openName === r.name && (
              <div className="m-rt-acts">
                {isCloud(r) ? (
                  <span className="m-muted m-sm">클라우드 예약 — 실행·일시정지는 claude.ai 에서</span>
                ) : (
                  <>
                    <button type="button" className={armed === r.name ? 'm-send' : 'm-btn'} disabled={busy === r.name} onClick={() => void act(r, 'run')}>
                      {armed === r.name ? '한 번 더 누르면 실행' : '지금 실행'}
                    </button>
                    <button type="button" className="m-btn" disabled={busy === r.name} onClick={() => void act(r, r.enabled ? 'pause' : 'resume')}>
                      {r.enabled ? '일시정지' : '다시 켜기'}
                    </button>
                    <button type="button" className="m-btn" onClick={() => setDoc(r)}>지침서</button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
        {raw !== null && routines.length > 0 && active.length === 0 && <p className="m-muted m-sm">걸린 예약이 없어요 — 다 끝났어요</p>}
        {done.length > 0 && <div className="m-sect">끝난 예약 {done.length}개</div>}
      </div>
      {doc && <FileView path={doc.instructions} title={`${doc.name} 지침서`} onClose={() => setDoc(null)} />}
    </div>
  );
}
