import { useState } from 'react';
import type { TaskCard } from '../domain/tasks';
import { tr } from '../i18n';

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
