import { useState } from 'react';
import { IconCollapse, IconMaximize, IconPower, IconRestore } from './Icons';
import { tr } from '../i18n';

type Props = {
  maximized: boolean;
  onMaximize: () => void;
  onRestore: () => void;
  onCollapse: () => void;
  /** 없으면 끄기 버튼을 안 보인다 (터미널 대화형 세션 등) */
  onStop?: () => Promise<void>;
};

/** 창 머리줄 아이콘 버튼: 크게 ↔ 원래대로 · 접기 · 끄기(한 번 더 확인). 이름이 길어도 밀리지 않게 아이콘만 */
export function PaneControls({ maximized, onMaximize, onRestore, onCollapse, onStop }: Props) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (armed && onStop) {
    return (
      <>
        <span className="warn">{tr('끌까? 대화는 남아', 'Stop it? The conversation is kept')}</span>
        <button
          className="mini danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onStop();
            } finally {
              setBusy(false);
              setArmed(false);
            }
          }}
        >
          {busy ? tr('끄는 중', 'Stopping') : tr('끄기', 'Stop')}
        </button>
        <button className="mini" disabled={busy} onClick={() => setArmed(false)}>{tr('취소', 'Cancel')}</button>
      </>
    );
  }
  return (
    <>
      {maximized ? (
        <button className="ib" title={tr('원래대로', 'Restore')} aria-label={tr('원래대로', 'Restore')} onClick={onRestore}><IconRestore /></button>
      ) : (
        <button className="ib" title={tr('크게', 'Maximize')} aria-label={tr('크게', 'Maximize')} onClick={onMaximize}><IconMaximize /></button>
      )}
      <button className="ib" title={tr('접기', 'Collapse')} aria-label={tr('접기', 'Collapse')} onClick={onCollapse}><IconCollapse /></button>
      {onStop && (
        <button className="ib danger" title={tr('끄기 (대화는 남아)', 'Stop (conversation is kept)')} aria-label={tr('끄기', 'Stop')} onClick={() => setArmed(true)}><IconPower /></button>
      )}
    </>
  );
}
