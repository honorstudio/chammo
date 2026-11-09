// 폰 알림 시트 '답 기다림' 한 장씩 E2E 받침 — 진짜 AlertsSheet·WaitPager·DirectCardView·WaitCard, 가짜 invoke(phone.html)
import '../../src/ui/layers.css';
import '../../src/ui/mobile/mobile.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DirectCard } from '../../src/domain/directAsk';
import { directRank, kindRank } from '../../src/domain/inboxDeck';
import type { Waiting } from '../../src/domain/mobile';
import { DirectCardView } from '../../src/ui/chat/DirectCard';
import { AlertsSheet } from '../../src/ui/mobile/AlertsSheet';
import { SheetHostProvider } from '../../src/ui/mobile/kit';
import { WaitCard } from '../../src/ui/mobile/OrchPicker';
import { WaitPager } from '../../src/ui/mobile/WaitPager';

const now = new Date().toISOString();
const pay = (id: string, amount: string, q: string): DirectCard => ({ id, ts: now, lastTs: now, from: 'orch-1', cwd: '/tmp/shop', q, kind: 'pay', amount, detail: '카드 끝 0000', yes: '승인', no: '거절', options: [], state: 'wait' });
const wait: Waiting = { orch: 'o-sci', name: '여행 담당', kind: 'ask', ts: now, lead: '좋아, 여행 얘기 하자', q: '다음 달 여행은 바다가 좋아, 산이 좋아? 고르면 숙소부터 찾아볼게.', taskId: 't-sci' };

function Phone() {
  const [cards, setCards] = useState<DirectCard[]>([pay('p1', 'US$9.99', 'example.com 도메인을 1년 연장할까요?'), pay('p2', 'US$20.00', '팀 보관함 저장 공간을 늘릴까요?')]);
  (window as unknown as { __drop: (id: string) => void }).__drop = (id) => setCards((cs) => cs.filter((c) => c.id !== id));
  const answer = async (id: string, pick: unknown) => { (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke('direct_answer', { id, pick }); };
  return (
    <SheetHostProvider kb={false}>
      <div className="m-app" style={{ top: 0, height: '100vh' }}>
        <AlertsSheet rows={[]} nameOf={(t) => t} onOpen={() => {}} onClose={() => {}}
          waiting={<WaitPager pages={[
            ...cards.map((c) => ({ key: `d:${c.id}`, rank: directRank(c.kind), node: <div className="dc-row"><DirectCardView c={c} name="참모 업데이트" onAnswer={answer} /></div> })),
            { key: 'w:t-sci', rank: kindRank(wait.kind), node: <WaitCard w={wait} orchs={[]} sent={{}} /> },
          ]} />} />
      </div>
    </SheetHostProvider>
  );
}
createRoot(document.getElementById('root')!).render(<Phone />);
