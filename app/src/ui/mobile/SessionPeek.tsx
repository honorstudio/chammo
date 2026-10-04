// 하위 세션 대화 보기 — 읽기만(지시는 참모에게). 바닥 전체를 덮는다(FileView 와 같은 틀). 대화는 이어 읽기, 일하는 중이면 한 줄
import { useEffect, useState } from 'react';
import { readTranscript } from '../../data/web';
import { liveOf, type Live } from '../../domain/agentBrowser';
import { liveWork } from '../../domain/mobile';
import { shownName } from '../../domain/orchLabel';
import type { Session } from '../../domain/session';
import { chatLoaded, useChatItems, useChatStale } from '../space/useChatItems';
import { useEarlier } from './useEarlier';
import { BrowserView } from './BrowserView';
import { MessageList } from './MessageList';
import { stateTag } from './OrchPicker';

const noop = () => {};

export function SessionPeek({ s, lives, onClose }: { s: Session; lives: Live[]; onClose: () => void }) {
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
  const tag = stateTag(s);
  const name = shownName(s.name) || s.project;
  return (
    <div className="m-view" role="dialog" aria-label={`${name} 대화`}>
      <div className="m-picker-head">
        <span className="m-peek-head">
          <b className="m-view-title">{name}</b>
          <span className={`st-tag ${tag.cls}`}>{tag.text}</span>
        </span>
        <button type="button" className="m-plain" onClick={onClose}>닫기</button>
      </div>
      <div className="m-muted m-sm m-peek-sub">{s.project}{s.workspace ? ` · ${s.workspace}` : ''} · 보기만 — 지시는 참모에게</div>
      {br && <div className="m-peek-br"><BrowserView live={br} /></div>}
      {s.sessionId ? <MessageList items={items} earlier={earlier} loading={!chatLoaded(s.sessionId)} stale={stale} out={[]} onRetry={noop} onDrop={noop} live={stale ? undefined : live} /> : <p className="m-muted m-peek-sub">대화 기록이 없어요</p>}
    </div>
  );
}
