import { useEffect, useState } from 'react';
import { subagentTails } from '../../data/tauri';
import { agentRows, agentWord, nowDoing, revive, type SubAgent } from '../../domain/subAgents';
import { termTail } from '../../domain/termTail';
import { tr } from '../../i18n';

type Tail = { mtime: number; tail: string };
const clean = (t: string) => t.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/`/g, '');

/**
 * 참모 대시보드 제목 아래 — 그 참모가 Agent 도구로 띄운 분신들(2026-10-02 사용자 "제목 아래 왼쪽이 비어 있으니 여기에").
 * 일하는 중이 위, 끝난 지 1시간 넘은 건 접고, 하루 넘은 건 안 보인다. 없으면 칸을 안 그린다. 줄을 누르면 분신 기록 꼬리를 터미널처럼 펼친다
 */
export function AgentList({ sid, agents }: { sid?: string; agents: SubAgent[] }) {
  const [now, setNow] = useState(Date.now());
  const [tails, setTails] = useState<Record<string, Tail>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [showOld, setShowOld] = useState(false);
  // 끝났어도 기록이 그 뒤로 또 쓰이면 다시 일하는 중(revive)
  const rows = agentRows(agents.map((a) => revive(a, tails[a.id]?.mtime)), now);
  // 일하는 중·끝난 지 1시간 안·펼친 것만 기록 꼬리를 읽는다 — 보이는 동안 5초마다
  const want = [...new Set([...rows.running, ...rows.recent].map((a) => a.id).concat(open ? [open] : []))].join();
  useEffect(() => {
    let alive = true;
    const tick = () => {
      setNow(Date.now());
      if (!sid || !want) return;
      void subagentTails(sid, want.split(',')).then((r) => {
        if (!alive) return;
        setTails((p) => { const n = { ...p }; for (const t of r) n[t.toolUseId] = { mtime: t.mtime, tail: t.tail }; return n; });
      }).catch(() => {});
    };
    tick();
    const t = window.setInterval(tick, 5000);
    return () => { alive = false; window.clearInterval(t); };
  }, [sid, want]);
  const shown = [...rows.running, ...rows.recent, ...(showOld ? rows.folded : [])];
  if (shown.length === 0 && rows.folded.length === 0) return null;
  const row = (a: SubAgent) => {
    const t = tails[a.id];
    const line = a.status === 'run' ? (t ? nowDoing(t.tail) : '') : clean(a.result ?? '');
    const isOpen = open === a.id;
    return (
      <li key={a.id} className={`cv-agent ${a.status} ${isOpen ? 'open' : ''}`}>
        <button className="cv-agent-row" onClick={() => setOpen(isOpen ? null : a.id)} title={a.kind ? `${a.name} · ${a.kind}` : a.name} aria-expanded={isOpen}>
          {a.status === 'run' ? <span className="cv-spin" /> : <span className="cv-agent-dot" />}
          <b>{a.name}</b>
          <em>{agentWord(a, now, a.status === 'run' ? t?.mtime : undefined)}</em>
          {line && <span className="cv-agent-line">{line}</span>}
        </button>
        {isOpen && (
          <div className="cv-agent-log">
            {t ? termTail(t.tail, 12, { sidechain: true }).map((l, i) => <span key={i} className={l.startsWith('  ⎿') ? 'res' : ''}>{l}</span>)
              : <span className="res">{tr('기록을 읽는 중…', 'Reading log…')}</span>}
          </div>
        )}
      </li>
    );
  };
  return (
    <section className="cv-agents" aria-label={tr('분신', 'Subagents')}>
      <div className="cv-h2">{tr('분신', 'Subagents')}<span>{rows.running.length > 0 ? tr(`일하는 중 ${rows.running.length}`, `${rows.running.length} working`) : shown.length + rows.folded.length}</span></div>
      <ul>{shown.map(row)}</ul>
      {rows.folded.length > 0 && (
        <button className="cv-link" onClick={() => setShowOld((v) => !v)}>
          {showOld ? tr('접기', 'Show less') : tr(`끝난 분신 ${rows.folded.length}개`, `${rows.folded.length} finished`)}
        </button>
      )}
    </section>
  );
}
