import { useState } from 'react';
import type { SnapSession } from '../domain/revive';
import type { TaskCard } from '../domain/tasks';
import { Sec } from './TaskPanel';
import { tr } from '../i18n';

const label = (s: SnapSession) => s.name || s.cwd.split('/').filter(Boolean).pop() || s.sessionId.slice(0, 8);

/** 작업 패널 맨 위 — 관리 프로그램이 다시 켜지면서 꺼진 세션. 한 번에 이어서 켜거나 그냥 둔다 */
export function LostSessions({ lost, onReviveAll, onDismiss }: { lost: SnapSession[]; onReviveAll: () => Promise<void>; onDismiss: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!lost.length) return null;
  return (
    <div className="revive">
      <Sec title={tr('재시작으로 꺼진 세션', 'Sessions stopped by restart')} count={lost.length} tone="hot" />
      <div className="revive-names">
        {lost.map((s) => (
          <span key={s.sessionId} className="revive-name" title={`${s.cwd} · ${s.sessionId}`}>{label(s)}</span>
        ))}
      </div>
      <div className="revive-acts">
        <button
          className="mini pri"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onReviveAll().finally(() => setBusy(false));
          }}
        >
          {busy ? tr('켜는 중', 'Starting') : tr('다 이어서 켜기', 'Resume all')}
        </button>
        <button className="mini" disabled={busy} onClick={onDismiss}>{tr('안 켬', 'Skip')}</button>
      </div>
    </div>
  );
}

/** 주인 잃은 일 한 줄 아래 버튼 — 그 세션을 이어서 켜거나, 끝난 걸로 치운다 */
export function OrphanActions({ card, canResume, onResume, onFinish }: { card: TaskCard; canResume: boolean; onResume: (c: TaskCard) => Promise<void>; onFinish: (c: TaskCard) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="revive-acts orphan-acts">
      <button
        className="mini"
        disabled={busy || !canResume}
        title={canResume ? tr('같은 대화 그대로 다시 띄운다', 'Reopens the same conversation') : tr('이어갈 대화 기록이 없어', 'No conversation to resume')}
        onClick={() => {
          setBusy(true);
          void onResume(card).finally(() => setBusy(false));
        }}
      >
        {busy ? tr('켜는 중', 'Starting') : tr('이어서 켜기', 'Resume')}
      </button>
      <button className="mini" disabled={busy} onClick={() => onFinish(card)}>{tr('끝난 걸로', 'Mark done')}</button>
    </div>
  );
}
