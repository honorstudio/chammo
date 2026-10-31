// 하위 세션 대화 보기 — 읽기만(지시는 참모에게). 바닥 전체를 덮는다(FileView 와 같은 틀). 대화는 이어 읽기, 일하는 중이면 한 줄
import { useEffect, useMemo, useState } from 'react';
import { tr } from '../../i18n';
import { readTranscript } from '../../data/web';
import { liveOf, type Live } from '../../domain/agentBrowser';
import { liveWork, subStatus, subTag } from '../../domain/mobile';
import { shownName } from '../../domain/orchLabel';
import type { Session } from '../../domain/session';
import { chatLoaded, useChatItems, useChatStale } from '../space/useChatItems';
import { useEarlier } from './useEarlier';
import { IconClose } from '../Icons';
import { BrowserView } from './BrowserView';
import { MessageList } from './MessageList';
import { useSubTails } from './useSubTails';
import { BottomSheet, IconBtn } from './kit';

const noop = () => {};

/** tag = 세션판이 이미 잰 칩 — 없으면(참모 대시보드에서 열 때) 이 세션 꼬리만 따로 받아 같은 판단으로 */
export function SessionPeek({ s, tag: given, lives, onClose }: { s: Session; tag?: { cls: string; text: string }; lives: Live[]; onClose: () => void }) {
  const one = useMemo(() => (given ? [] : [s]), [given, s]);
  const tails = useSubTails(one);
  const br = liveOf(s, lives);
  const items = useChatItems(s.sessionId, 2500, readTranscript);
  const stale = useChatStale(s.sessionId);
  const earlier = useEarlier(s.sessionId);
  const [now, setNow] = useState(() => Date.now());
  const live = liveWork({ state: s.state, items, pending: 0, stateAt: 0, now });
  useEffect(() => {
    if (!live.busy) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live.busy]);
  const tag = given ?? subTag(subStatus(s, tails, now));
  const name = shownName(s.name) || s.project;
  return (
    <BottomSheet kind="full" label={tr(`${name} 대화`, `${name} conversation`)} onClose={onClose} head={
      <div className="m-picker-head">
        <span className="m-peek-head">
          <b className="m-view-title">{name}</b>
          <span className={`st-tag ${tag.cls}`}>{tag.text}</span>
        </span>
        <IconBtn label={tr('닫기', 'Close')} onClick={onClose}><IconClose /></IconBtn>
      </div>}>
      <div className="m-muted m-sm m-peek-sub">{s.project}{s.workspace ? ` · ${s.workspace}` : ''} · {tr('보기만 — 지시는 참모에게', 'View only — give instructions to your assistant')}</div>
      {br && <div className="m-peek-br"><BrowserView live={br} /></div>}
      {s.sessionId ? <MessageList items={items} earlier={earlier} loading={!chatLoaded(s.sessionId)} stale={stale} out={[]} onRetry={noop} onDrop={noop} live={stale ? undefined : live} /> : <p className="m-muted m-peek-sub">{tr('대화 기록이 없어요', 'No conversation yet')}</p>}
    </BottomSheet>
  );
}
