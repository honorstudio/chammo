import { useState } from 'react';
import { canAdopt, parseSpawnOutput } from '../domain/adopt';
import type { Session } from '../domain/session';
import { adoptSession } from '../data/tauri';
import { assistant, tr } from '../i18n';

type Props = {
  session: Session;
  title: string;
  /** 비서 자리면 "지금 이 대화가 옮겨온다"는 걸 알려준다 */
  isOrchestrator?: boolean;
  onDone: (message: string | null) => void;
};

/** 터미널에서 연 대화형 세션 자리. attach 가 안 되니 앱으로 옮기는 버튼을 둔다 */
export function AdoptCard({ session, title, isOrchestrator, onDone }: Props) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const check = canAdopt(session);

  const go = async () => {
    if (!check.ok || session.pid == null || !session.sessionId) return;
    setBusy(true);
    try {
      const out = await adoptSession(session.pid, session.sessionId, session.cwd, title);
      const { copy } = parseSpawnOutput(out);
      onDone(copy ? tr('원본이 아직 살아 있어서 복사본이 생겼어 — 터미널 쪽 세션을 확인해줘', 'The original is still running, so a copy was made — check the terminal session') : null);
    } catch (e: unknown) {
      onDone(tr(`옮기기 실패: ${String(e)}`, `Move failed: ${String(e)}`));
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  return (
    <div className="pane">
      <div className="pane-head">
        <b>{title}</b>
        <span className="dim">{tr('터미널에서 열린 세션', 'Opened in a terminal')} · {session.name}</span>
      </div>
      <div className="empty">
        <b>{isOrchestrator
            ? tr(`${assistant()}가 지금 터미널에서 돌고 있어`, `${assistant()} is running in a terminal right now`)
            : tr('터미널에서 연 세션이라 여기선 못 붙어', "This session was opened in a terminal, so it can't be attached here")}</b>
        <span className="note">
          {tr('앱으로 옮기면 터미널 쪽 세션은 닫히고, 같은 대화가 여기서 이어져.', 'Moving it closes the terminal session and continues the same conversation here.')}
          {isOrchestrator && tr(' 지금 나눈 이 대화도 그대로 넘어와.', ' This conversation comes along too.')}
        </span>
        {!check.ok ? (
          <span className="note">{check.reason}</span>
        ) : armed ? (
          <span className="row">
            <button className="btn pri" disabled={busy} onClick={() => void go()}>
              {busy ? tr('옮기는 중…', 'Moving…') : tr('터미널 세션 닫고 옮기기', 'Close terminal session and move')}
            </button>
            <button className="btn" disabled={busy} onClick={() => setArmed(false)}>
              {tr('취소', 'Cancel')}
            </button>
          </span>
        ) : (
          <button className="btn pri" onClick={() => setArmed(true)}>
            {tr('앱으로 가져오기', 'Bring into the app')}
          </button>
        )}
      </div>
    </div>
  );
}
