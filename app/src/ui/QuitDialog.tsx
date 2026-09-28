import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import './tour.css';

/**
 * ⌥⌘Q "완전히 종료 — 세션도 끄기" 확인. ⌘Q 는 묻지 않고 독에서만 뺀다(세션은 계속, 사용자 2026-09-28).
 * 이건 참모·프로젝트 세션까지 끄는 드문 길이라 한 번 묻는다. 대화는 남아서 나중에 이어서 켤 수 있다
 */
export function QuitDialog({ running, onQuit, onCancel }: { running: number; onQuit: (stopSessions: boolean) => Promise<void>; onCancel: () => void }) {
  const [busy, setBusy] = useState<'app' | 'all' | null>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [busy, onCancel]);
  const go = (all: boolean) => { setBusy(all ? 'all' : 'app'); void onQuit(all); };
  return (
    <div className="tour" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div className="tour-card" role="dialog" aria-modal="true" aria-label={tr('Chammo 종료', 'Quit Chammo')}>
        <h2>{tr('세션까지 모두 끄고 종료할까요?', 'Stop all sessions and quit?')}</h2>
        <p>
          {running
            ? tr(`Chammo 가 다루는 세션 ${running}개를 끄고 앱을 닫아요. 대화는 남아서 나중에 "꺼진 세션"에서 이어서 켤 수 있어요. 세션은 두고 앱만 닫으려면 ⌘Q.`, `Stops the ${running} sessions Chammo manages and quits. Conversations are kept — resume them later from "Stopped sessions". To close only the app and keep sessions running, use ⌘Q.`)
            : tr('돌고 있는 세션이 없어요. 앱을 닫아요.', 'No sessions are running. The app will quit.')}
        </p>
        <div className="tour-nav">
          <button className="btn" disabled={!!busy} onClick={onCancel}>{tr('취소', 'Cancel')}</button>
          <span className="grow" />
          <button className="btn pri" disabled={!!busy} onClick={() => go(true)}>{busy ? tr('끄는 중…', 'Stopping…') : running ? tr('끄고 종료', 'Stop and quit') : tr('종료', 'Quit')}</button>
        </div>
      </div>
    </div>
  );
}
