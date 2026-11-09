// 사무실 E2E 폰 판 — 폰 서버 대신 fetch 를 가로채 phoneAnswer 로 답한다(맥 앱 한 줄과 같은 코드)
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '/src/ui/layers.css';
import '/src/ui/mobile/mobile.css';
import '/src/ui/office/room.css';
import '/src/ui/office/office2.css';
import '/src/ui/gacha/parts.css';
import { CATALOG, EMPTY_GACHA, officesOf, skinOfRoom, type GachaFile } from '/src/domain/gacha';
import { officeShape } from '/src/domain/phoneOffice';
import { gachaView, phoneAnswer } from '/src/domain/phoneGacha';
import type { Session } from '/src/domain/session';

localStorage.setItem('chammo.token', 'x');
const q = new URLSearchParams(location.search);
const hash = (s: string) => [...s].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381);
const owned: Record<string, number> = {};
for (const c of CATALOG) if (hash(c.id) % 3 !== 0) owned[c.id] = 1 + (hash(c.id) % 5);
owned['chr.bear'] = 3;
for (const id of ['chr.a_panda', 'furn.a_loveseat', 'furn.a_tent', 'floor.persian', 'floor.bearrug', 'wall.catposter', 'wall.mirror']) owned[id] = 1;
let file: GachaFile = {
  ...EMPTY_GACHA, coins: 6112, since: 0, owned, pity: 42, tamaMoved: { at: 1, coins: 0, chars: 0 },
  offices: [{ lv: Number(q.get('lv') ?? 1), zone: [1, 3], furn: { 'furn.a_loveseat': [8, 3], 'furn.a_tent': [7, 7] }, floor: [{ id: 'floor.persian', x: 2, y: 1 }, { id: 'floor.bearrug', x: 7, y: 3 }], wall: [{ id: 'wall.catposter', side: 'L', at: 0 }, { id: 'wall.mirror', side: 'R', at: 5 }] }, { lv: 0, zone: [1, 3], furn: {}, floor: [], wall: [] }],
  chars: q.get('undec') ? { 참모: 'chr.a_panda' } : { 참모: 'chr.a_panda', '참모-2': 'chr.a_devcoon', '참모-3': 'chr.bear' },
  orchSeats: { 참모: { office: 0, x: 2.8, y: 1.1, w: 2.4 }, '참모-2': { office: 0, x: 0.6, y: 1.1, w: 1.6 } },
};
owned['chr.a_devcoon'] = 1;
const shape = () => officeShape({ offices: officesOf(file), slots: [], skins: officesOf(file).map((_, i) => skinOfRoom(file, i)), seats: file.orchSeats ?? {}, assign: file.assign ?? {}, sprs: { 참모: 'a_panda', '참모-2': 'a_devcoon' }, off: [], deco: {} });
const real = window.fetch.bind(window);
window.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
  const url = String(u);
  const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.includes('/api/office')) return new Response(`${JSON.stringify({ tag: 'a', same: false })}\n${JSON.stringify(shape())}`, { status: 200 });
  if (url.includes('/api/gacha')) {
    if (init?.method === 'POST') { const r = phoneAnswer(file, JSON.parse(String(init.body)), false, Math.random, Date.now()); if (r.file) file = r.file; return json(r.reply); }
    return new Response(JSON.stringify(gachaView(file)), { status: 200 });
  }
  if (url.includes('/api/')) return new Response('{}', { status: 200 });
  return real(u as RequestInfo, init);
}) as typeof fetch;
const sess = (id: string, name: string, project: string, cwd: string, state: Session['state'] = 'working'): Session => ({ id, name, project, cwd, state, kind: 'background', startedAt: 1, sessionId: id }) as Session;
const hq = '/hq';
const orchs = [sess('o1', '참모 · 참모 업데이트', 'hq', hq), sess('o2', '참모-2 · 디자인', 'hq', hq, 'idle'), sess('o3', '참모-3 · 회사 비서', 'hq', hq, 'idle')];
const workers = ['acme-shop', 'pet-diary', 'todo-api', 'pixel-blog', 'ops', 'cafe-site', 'photo-book'].map((p, i) => sess(`w${i}`, p, p, `/d/${p}`));
const { default: PhoneOffice } = await import('/src/ui/mobile/PhoneOffice');
function App() {
  const [current, setCurrent] = useState(q.get('me') ?? 'o1');
  return <div className="m-root" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><PhoneOffice sessions={[...orchs, ...workers]} orchs={orchs} hqDir={hq} lives={[]} onBack={() => {}} current={current} onTalk={setCurrent} /></div>;
}
createRoot(document.getElementById('root')!).render(<App />);
