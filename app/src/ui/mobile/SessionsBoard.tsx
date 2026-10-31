// 세션 판 — 참모 말고 하위 세션(프로젝트별·도우미). 묻는·일하는 세션이 위. 누르면 그 세션 대화를 읽기만(SessionPeek)
import { useState } from 'react';
import { liveOf, type Live } from '../../domain/agentBrowser';
import type { Ctx } from '../../domain/ctx';
import { sessionBoard, subStatus, subTag } from '../../domain/mobile';
import { shownName } from '../../domain/orchLabel';
import type { Session } from '../../domain/session';
import { useSubTails } from './useSubTails';
import { SessionPeek } from './SessionPeek';
import { IconBack } from '../Icons';
import { tr } from '../../i18n';

export function SessionsBoard({ sessions, hqDir, ctx, lives, onBack }: { sessions: Session[]; hqDir: string; ctx: Record<string, Ctx>; lives: Live[]; onBack: () => void }) {
  const [peek, setPeek] = useState<string | null>(null);
  const groups = sessionBoard(sessions, hqDir);
  const tails = useSubTails(sessions);
  const now = Date.now();
  const tagOf = (s: Session) => subTag(subStatus(s, tails, now));
  const open = sessions.find((s) => s.id === peek);
  return (
    <div className="m-dash">
      <header className="m-dash-head">
        <div className="m-dash-row">
          <button type="button" className="m-rt-btn m-ico" onClick={onBack} aria-label={tr('대시보드로', 'Back to dashboard')} title={tr('대시보드로', 'Back to dashboard')}><IconBack /></button>
          <div className="m-dash-title">{tr('세션', 'Sessions')}</div>
        </div>
        <div className="m-muted m-sm">{tr('참모가 일을 맡긴 프로젝트 세션 — 누르면 대화를 볼 수 있어요', 'Project sessions your assistant gave work to — tap to read the conversation')}</div>
      </header>
      {groups.length === 0 && <p className="m-muted m-sm">{tr('떠 있는 세션이 없어요', 'No sessions running')}</p>}
      {groups.map((g) => (
        <section key={g.name}>
          <div className="m-sect">{g.name}</div>
          {g.sessions.map((s) => {
            const tag = tagOf(s);
            const used = s.sessionId ? ctx[s.sessionId]?.used : undefined;
            return (
              <button key={s.id} type="button" className="m-task m-task-btn" onClick={() => setPeek(s.id)}>
                <span className={`st-tag ${tag.cls}`}>{tag.text}</span>
                <span className="m-task-mid"><b>{shownName(s.name) || s.project}</b>{s.workspace && <span>{s.workspace}</span>}</span>
                {liveOf(s, lives) && <span className="m-tag-br">{tr('브라우저', 'Browser')}</span>}
                {used !== undefined && <span className={used >= 80 ? 'm-ctx m-hot' : 'm-ctx'}>{Math.round(used)}%</span>}
              </button>
            );
          })}
        </section>
      ))}
      {open && <SessionPeek s={open} tag={tagOf(open)} lives={lives} onClose={() => setPeek(null)} />}
    </div>
  );
}
