import { useState } from 'react';
import { tr } from '../../i18n';
import type { TaskCard } from '../../domain/tasks';
import { IconCheck, IconChevron, IconResume } from '../Icons';

/**
 * 참모 대시보드의 "닫히지 않은 일 N" 한 줄 — 맡긴 세션이 꺼졌는데 끝 표시가 없는 일(domain/orphans).
 * 작업 패널 '주인 잃은 일'로 쌓여 누구 것인지 몰랐던 것을 맡긴 참모 밑으로(2026-10-02 사용자). 누르면 펼쳐서 이어서 켜기·끝난 걸로
 */
export function UnclosedTasks({ cards, nameOf = (t) => t, canResume, onResume, onFinish }: { cards: TaskCard[]; /** 대상 → 화면 이름(세션 id·참모 번호 대신) */ nameOf?: (target: string) => string; canResume: (c: TaskCard) => boolean; onResume: (c: TaskCard) => Promise<void>; onFinish: (c: TaskCard) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  if (!cards.length) return null;
  return (
    <div className={`cv-unclosed ${open ? 'open' : ''}`}>
      <button className="cv-unclosed-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        title={tr('맡긴 세션이 꺼졌는데 끝났다고 표시 안 된 일', 'Tasks whose session stopped without being marked done')}>
        <b>{tr(`닫히지 않은 일 ${cards.length}`, `${cards.length} unclosed`)}</b><span>{tr('정리', 'Tidy')}</span><IconChevron />
      </button>
      {open && cards.map((c) => (
        <div key={c.id} className="cv-unclosed-row">
          <b>{nameOf(c.target)}</b><span>{c.title}</span><em>{new Date(c.sentAt).toTimeString().slice(0, 5)}</em>
          <button className="cv-btn" disabled={busy !== null || !canResume(c)} aria-label={tr(`${nameOf(c.target)} 이어서 켜기`, `Resume ${nameOf(c.target)}`)}
            title={canResume(c) ? tr('이어서 켜기 — 같은 대화 그대로', 'Resume — same conversation') : tr('이어갈 대화 기록이 없어', 'No conversation to resume')}
            onClick={() => { setBusy(c.id); void onResume(c).finally(() => setBusy(null)); }}><IconResume /></button>
          <button className="cv-btn" disabled={busy !== null} aria-label={tr(`${nameOf(c.target)} 끝난 걸로`, `Mark ${nameOf(c.target)} done`)} title={tr('끝난 걸로', 'Mark done')}
            onClick={() => onFinish(c)}><IconCheck /></button>
        </div>
      ))}
    </div>
  );
}
