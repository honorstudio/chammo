// 폰 채팅 시트 + 사람 부르기 카드 받침 — ?snap=half|full &asks=1|2 &kb=1(키보드: 시트가 보이는 화면을 다 쓴다) &reason=짧게|길게
import '../../src/ui/layers.css';
import '../../src/ui/mobile/mobile.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AskPlaced } from '../../src/domain/agentAsk';
import type { Live } from '../../src/domain/agentBrowser';
import type { ChatItem } from '../../src/domain/chat';
import type { Snap } from '../../src/domain/mobile';
import { ChatSheet } from '../../src/ui/mobile/ChatSheet';
import { PhoneAskCards } from '../../src/ui/mobile/DirectCards';
import { SheetHostProvider } from '../../src/ui/mobile/kit';
import { MessageList } from '../../src/ui/mobile/MessageList';

const q = new URLSearchParams(location.search);
const snap0 = (q.get('snap') ?? 'full') as Snap;
const n = Number(q.get('asks') ?? 1);
const kb = q.get('kb') === '1';
const reason = q.get('reason') === 'long'
  ? '구글 패스키 로그인이 떠 있어. 맥에서 지문으로 확인해 주고, 끝나면 다 했어를 눌러 줘. 그래야 사이트 시안 작업을 이어서 할 수 있어.'
  : '구글 패스키 로그인을 해 줘';

const live = (i: number): Live => ({ profile: i ? `other-site-${i}` : 'shop-site', pid: 10 + i, sessionPid: 20 + i, url: 'https://accounts.google.com/signin', title: '로그인 - Google 계정', tabs: [], tool: '', toolAt: 0, busy: false, ts: Date.now(), ask: { reason, at: Date.now() } });
const asks = Array.from({ length: n }, (_, i) => ({ live: live(i) })) as AskPlaced[];
const now = new Date().toISOString();
const items: ChatItem[] = Array.from({ length: 30 }, (_, i) => (i % 2
  ? { kind: 'assistant', id: `a${i}`, ts: now, text: `${i}번째 답 — 사이트 시안을 이어서 만들고 있어. 프로필 빌리는 명령과 이미지 도구 프로필을 확인했어.`, end: true }
  : { kind: 'user', id: `u${i}`, ts: now, text: `${i}번째 말 — 야 다른 프로필 빌려바` }));

function Phone() {
  const [snap, setSnap] = useState<Snap>(snap0);
  return (
    <div className="m-app" style={{ top: 0, height: '100dvh' }}>
      <div className="m-space">
        <SheetHostProvider kb={kb}>
          <ChatSheet snap={snap} onSnap={setSnap} peekLine="" vh={window.innerHeight} kb={kb}
            composer={<div className="m-composer-e2e" style={{ height: 96, margin: '0 8px 8px', borderRadius: 24, boxShadow: '0 0 0 1px var(--line)' }}>입력칸</div>}>
            <MessageList items={items} out={[]} onRetry={() => {}} onDrop={() => {}} />
            <PhoneAskCards asks={asks} sessions={[]} />
          </ChatSheet>
        </SheetHostProvider>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Phone />);
