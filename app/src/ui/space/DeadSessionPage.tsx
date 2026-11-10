// 꺼진 세션 탭(2026-11-10) — 세션 탭을 열어 둔 채 세션이 꺼지면 '왼쪽 메뉴에서 골라 줘'만 떠서 할 게 없었다.
// 이름 + 한 줄 + 아이콘 둘(다시 켜기 = claude respawn 같은 대화·번호, 탭 닫기). 다시 켜지면 같은 탭이 곧 살아 있는 세션 화면이 된다
import { useEffect, useState } from 'react';
import { tr } from '../../i18n';
import { IconClose, IconResume } from '../Icons';
import { IconButton } from '../kit/IconButton';

export function DeadSessionPage({ name, canResume, onResume, onClose }: { name: string; canResume: boolean; onResume: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  // 켜기를 누르면 꺼진 목록에서 바로 빠진다(복사본 방지) — 실패하면 앱이 알림을 띄우니 잠시 뒤 다시 누를 수 있게
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setBusy(false), 20_000);
    return () => clearTimeout(t);
  }, [busy]);
  return (
    <div className="sp-dead">
      <b className="sp-dead-name">{name}</b>
      <span className="sp-dead-line">{busy ? tr('켜는 중', 'Starting') : canResume ? tr('꺼졌어 · 대화는 남아 있어', 'Stopped · conversation kept') : tr('꺼졌어', 'Stopped')}</span>
      <span className="sp-dead-acts">
        {(canResume || busy) && (
          <IconButton tone="line" size="l" label={tr('다시 켜기', 'Resume')} busy={busy} busyLabel={tr('켜는 중', 'Starting')} onClick={() => { setBusy(true); onResume(); }}><IconResume /></IconButton>
        )}
        <IconButton tone="line" size="l" label={tr('탭 닫기', 'Close tab')} onClick={onClose}><IconClose /></IconButton>
      </span>
    </div>
  );
}
