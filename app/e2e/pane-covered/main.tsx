// 덮인 칸 E2E 받침(11-18 사용자 "알림이 떠 있을 때 참모 브라우저 렌더링이 멈춤") — 진짜 usePanePlace(스페이스 브라우저·Craft 칸 공통)와 진짜 결정 대기함 팝오버.
// 비추기(Rust·Swift)는 가짜: 마지막 place 가 보임이거나 덮임일 때만 받기가 돌아 0.1초마다 새 그림(번호)이 생긴다 — 진짜 Swift updatePause·Rust mark_pane 과 같은 규칙.
// still 은 지금 그림(번호 SVG)을 준다. 칸 안 img 는 진짜 BrowserPane 처럼 still 을 그린다
import '../../src/ui/layers.css';
import '../../src/ui/styles.css';
import { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { InboxItem } from '../../src/domain/inbox';
import { itemRank } from '../../src/domain/inboxDeck';
import { InboxCard, InboxPopover, type InboxPage } from '../../src/ui/Inbox';
import { usePanePlace, type PaneApi } from '../../src/ui/space/panePlace';

type W = { __places: { visible: boolean; covered?: boolean }[]; __stills: number[]; __frame: number; __open: (o: boolean) => void };
const w = window as unknown as W;
w.__places = [];
w.__stills = [];
w.__frame = 0;
let live = false;
setInterval(() => { if (live) w.__frame++; }, 100);
const pic = (n: number) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="700" height="440"><rect width="700" height="440" fill="#dfe9f7"/><text x="40" y="250" font-size="160" font-family="Helvetica" fill="#1d4ed8">${n}</text></svg>`)}`;

const ITEM: InboxItem = { key: 'terms', kind: 'decide', project: '개발 담당', where: '', lead: '약관 동의 필요', text: 'example.com 들어가서 약관 동의.', ts: new Date().toISOString(), target: 'dev', toOrch: true, taskId: 't-1' };

function Harness() {
  const stage = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  w.__open = setOpen;
  const api: PaneApi = useMemo(() => ({
    place: async (_r, _vh, visible, covered) => { w.__places.push({ visible, covered }); live = visible || covered === true; return 'live'; },
    still: async () => { w.__stills.push(w.__frame); return pic(w.__frame); },
    detach: () => {},
  }), []);
  const { still } = usePanePlace(true, stage, api, 'p', 500);
  const pages: InboxPage[] = [{ key: 'i:terms', rank: itemRank(ITEM), who: ITEM.project, node: <InboxCard item={ITEM} blockedWhy={() => null} onReply={async () => {}} onOpen={() => {}} onDismiss={() => {}} /> }];
  return (
    <div style={{ height: '100vh', background: 'var(--bg)' }}>
      <header className="topbar"><span className="grow" /></header>
      <div ref={stage} className="e2e-stage" style={{ position: 'absolute', left: 20, top: 60, width: 860, height: 480, background: '#111' }}>
        {still && <img className="e2e-still" src={still} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
      </div>
      <InboxPopover open={open} onClose={() => setOpen(false)} pages={pages} />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
