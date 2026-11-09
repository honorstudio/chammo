// 결정 대기함 해피패스 E2E 받침 — 진짜 InboxPopover·InboxCard·DirectCardView 에 가짜 invoke(index.html)만 붙인다
import '../../src/ui/layers.css';
import '../../src/ui/styles.css';
import { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DirectCard } from '../../src/domain/directAsk';
import type { InboxItem } from '../../src/domain/inbox';
import { directRank, itemRank } from '../../src/domain/inboxDeck';
import { DirectCardView } from '../../src/ui/chat/DirectCard';
import { InboxCard, InboxPopover, type InboxPage } from '../../src/ui/Inbox';
import { IconBell } from '../../src/ui/Icons';
import { Badge } from '../../src/ui/kit/Badge';

const now = new Date().toISOString();
const pay = (id: string, amount: string, q: string): DirectCard => ({ id, ts: now, lastTs: now, from: 'orch-1', cwd: '/tmp/shop', q, kind: 'pay', amount, detail: '카드 끝 0000', yes: '승인', no: '거절', options: [], state: 'wait' });
const yesterday = new Date(Date.now() - 26 * 3600_000).toISOString();
const ITEMS: InboxItem[] = [
  { key: 'ops', kind: 'decide', project: '개발 담당', where: '', lead: 'project-x.day 근거 없는 수치 정리가 끝났어.', text: '승인되면 바로 운영에 올릴게.', ts: now, target: 'dev', toOrch: true, taskId: 't-ops' },
  { key: 'sci', kind: 'ask', project: '여행 담당', where: '', lead: '좋아, 여행 얘기 하자', text: '다음 달 여행은 바다가 좋아, 산이 좋아? 고르면 숙소부터 찾아볼게.', ts: yesterday, target: 'sci', toOrch: true },
];

function Harness() {
  const plain = new URLSearchParams(location.search).get('s') === 'plain';
  const [cards, setCards] = useState<DirectCard[]>(plain ? [] : [pay('p1', 'US$9.99', 'example.com 도메인을 1년 연장할까요?'), pay('p2', 'US$20.00', '팀 보관함 저장 공간을 늘릴까요?')]);
  const [items, setItems] = useState<InboxItem[]>(plain ? ITEMS.slice(1) : ITEMS);
  const [open, setOpen] = useState(true);
  (window as unknown as { __drop: (id: string) => void }).__drop = (id) => setCards((cs) => cs.filter((c) => c.id !== id));
  const replies = ((window as unknown as { __replies?: string[] }).__replies ??= []);
  const onClose = useCallback(() => setOpen(false), []);
  const pages: InboxPage[] = [
    ...cards.map((c) => ({ key: `d:${c.id}`, rank: directRank(c.kind), who: '참모 업데이트', node: <div className="dc-row"><DirectCardView c={c} name="참모 업데이트" place="inbox" /></div> })),
    ...items.map((i) => ({ key: `i:${i.key}`, rank: itemRank(i), who: i.project, node: <InboxCard item={i} blockedWhy={() => null} onReply={async (_, t) => { replies.push(t); }} onOpen={() => {}} onDismiss={(x) => setItems((xs) => xs.filter((y) => y.key !== x.key))} /> })),
  ];
  return (
    <div style={{ height: '100vh', background: 'var(--bg)' }}>
      <header className="topbar"><span className="grow" /><button className={`bell ${pages.some((p) => p.rank < 2) ? 'on' : 'calm'}`} aria-label="결정 대기" onClick={() => setOpen((o) => !o)}><IconBell /><Badge n={pages.length} className="bell-n" /></button></header>
      <div className="e2e-outside" style={{ padding: 40, color: 'var(--text-3)' }}>터미널 자리</div>
      <InboxPopover open={open} onClose={onClose} pages={pages} />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
