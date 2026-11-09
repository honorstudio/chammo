// 사무실 E2E PC 판 — 진짜 컴포넌트 + 지어낸 뽑기 파일(?v=rooms|gacha|dex|deco|pick|edit&layer=)
import { useState, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/ui/layers.css';
import '/src/ui/styles.css';
import '/src/ui/office/room.css';
import '/src/ui/office/office2.css';
import '/src/ui/gacha/parts.css';
import { CATALOG, EMPTY_GACHA, officesOf, type GachaFile, buyExpand, skinOfRoom } from '/src/domain/gacha';
import { planOffice, speciesFor, type OrchIn, type Seat } from '/src/domain/office';
import { Shop } from '/src/ui/gacha/Shop';
import { CharGate } from '/src/ui/office/CharPicker';
import { OfficeEdit } from '/src/ui/office/OfficeEdit';
import { OfficeRooms } from '/src/ui/office/OfficeRooms';
import { OfficeModal, OfficeTools } from '/src/ui/office/OfficeMenu';
import { OfficeView } from '/src/ui/office/OfficeView';
import { OfficeDock } from '/src/ui/office/OfficeDock';
import { skinOf } from '/src/ui/office/skins';

const q = new URLSearchParams(location.search);
// ?bench=1 — 방 그리기(120ms 타이머) 한 번에 걸린 시간을 window.__frames 에
if (q.get('bench')) {
  const frames: number[] = [];
  (window as unknown as { __frames: number[] }).__frames = frames;
  const si = window.setInterval.bind(window);
  window.setInterval = ((fn: () => void, ms?: number) => (ms === 120 ? si(() => { const t = performance.now(); fn(); frames.push(performance.now() - t); }, ms) : si(fn, ms))) as typeof window.setInterval;
}
const v = q.get('v') ?? 'rooms';
const hash = (s: string) => [...s].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381);
const owned: Record<string, number> = {};
for (const c of CATALOG) if (hash(c.id) % 3 !== 0) owned[c.id] = 1 + (hash(c.id) % 5);
owned['chr.bear'] = 3; owned['skin.cafe'] = 1;
const sample: GachaFile = {
  ...EMPTY_GACHA, coins: 6112, since: 0, owned, pity: 42,
  history: CATALOG.filter((c) => owned[c.id] && (c.kind === 'chr' || c.kind === 'floor' || c.kind === 'wall' || c.kind === 'furn')).filter((c) => hash(c.id) % 17 === 0).slice(0, 10).map((c, i) => ({ t: i, id: c.id, dup: i % 2 === 0 })),
  offices: [{
    lv: Number(q.get('lv') ?? 1), zone: [1, 3], furn: { 'furn.a_loveseat': [8, 3], 'furn.a_fireplace': [8, 5], 'furn.a_tent': [7, 7], 'furn.a_bigcactus': [9, 7] },
    floor: [{ id: 'floor.persian', x: 2, y: 1 }, { id: 'floor.bearrug', x: 7, y: 3 }, { id: 'floor.starnight', x: 6, y: 5 }],
    wall: [{ id: 'wall.catposter', side: 'L', at: 0 }, { id: 'wall.mirror', side: 'R', at: 5 }, { id: 'wall.wallguitar', side: 'R', at: 8 }],
  }, { lv: 0, zone: [1, 3], furn: {}, floor: [], wall: [], skin: 'cafe' }],
  chars: { 참모: 'chr.a_panda', '참모-2': 'chr.a_devcoon' },
  orchSeats: { 참모: { office: 0, x: 2.8, y: 1.1, w: 2.4 }, '참모-2': { office: 0, x: 0.6, y: 1.1, w: 1.6 }, '참모-3': { office: 0, x: 5.6, y: 1.1, w: 1.6 } },
  tamaMoved: { at: 1, coins: 0, chars: 0 },
};
for (const id of ['chr.a_panda', 'chr.a_devcoon', 'furn.a_loveseat', 'furn.a_fireplace', 'furn.a_tent', 'furn.a_bigcactus', 'floor.persian', 'floor.bearrug', 'floor.starnight', 'wall.catposter', 'wall.mirror', 'wall.wallguitar']) owned[id] = 1;
const seat = (id: string, status: Seat['status'] = 'working', act?: Seat['act']): Seat => ({ id, label: id, project: id, status, startedAt: 0, ...(act ? { act } : {}) });
const n = Number(q.get('staff') ?? 7);
const workers = Array.from({ length: n }, (_, i) => ['acme-shop', 'pet-diary', 'todo-api', 'pixel-blog', 'ops', 'cafe-site', 'photo-book', 'recipe-box', 'tax-memo', 'chat-bot'][i] ?? `proj-${i}`).map((x, i) => seat(x, i === 1 ? 'asks' : i === 3 ? 'done' : 'working', i % 2 ? 'type' : 'run'));
const orchs: OrchIn[] = [
  { ...seat('o1'), label: '참모 업데이트', name: '참모', spr: 'a_panda', project: 'hq' },
  { ...seat('o2', 'idle'), label: '디자인', name: '참모-2', spr: 'a_devcoon', project: 'hq' },
  { ...seat('o3', 'idle'), label: '회사 비서', name: '참모-3', project: 'hq', off: true },
];
function App() {
  const [file, setFile] = useState<GachaFile>(sample);
  const [cur, setCur] = useState(0);
  const [view, setView] = useState<'gacha' | 'dex' | 'deco'>(v === 'dex' ? 'dex' : v === 'deco' ? 'deco' : 'gacha');
  const rooms = officesOf(file);
  const planOf = (i: number, room = rooms[i]!, seats = file.orchSeats) => planOffice({ room, index: i, orchs, workers: i === 0 ? workers : [], seats });
  const plans = useMemo(() => rooms.map((_, i) => planOf(i)), [file]); // eslint-disable-line
  const change = async (op: (f: GachaFile) => GachaFile | null) => { const nx = op(file); if (nx) setFile(nx); return nx; };
  const skin = skinOfRoom(file, Math.min(cur, rooms.length - 1));
  const deco = { window: 'window.sunset', hasCat: true };
  const pv = (roomNow: typeof plans[number], roomId: number, overlay: Parameters<typeof OfficeView>[0]['overlay'], bottom: number) => (
    <OfficeView room={roomNow} roomId={roomId} overlay={overlay} skin={skin} bottom={bottom} deco={deco} coins={file.coins} onGacha={() => {}} menu={<OfficeTools tab="office" onTab={() => {}} />} onOpen={() => {}} bossIn={{ status: 'working', reply: null, voice: false, cheerAt: null }} />
  );
  return (
    <div className="office-col" style={{ position: 'relative', width: '100%', height: '100vh', overflow: 'hidden', background: skinOf(skin).bg }}>
      {v === 'edit'
        ? <OfficeEdit file={file} index={cur} skin={skin} deco={deco} change={change} onDone={() => {}} layer0={(q.get('layer') as 'floor') ?? 'floor'} plan={(r, s) => planOf(cur, r, s)} orchs={orchs.map((o) => ({ name: o.name, label: o.label, spr: o.spr ?? speciesFor(o.name) }))} />
        : <OfficeRooms cur={cur} onCur={setCur} rooms={plans} lv={rooms.map((r) => r.lv)} skins={rooms.map((_, i) => skinOfRoom(file, i))} coins={file.coins} deco={deco}
            roster={[...orchs.map((o) => ({ key: o.name, label: o.label, spr: o.spr ?? speciesFor(o.name), office: 0, set: () => {} })), ...workers.map((w) => ({ key: w.id, label: w.label, spr: speciesFor(w.id), office: 0, set: () => {} }))]}
            onExpand={() => { const nx = buyExpand(file, cur); if (nx) setFile(nx); }} onOpen={() => {}}
            view={({ room, roomId, overlay, bottom }) => pv(room, roomId, overlay, bottom)} />}
      {q.get('dock') && <OfficeDock desks={plans.flatMap((p) => p.desks).filter((d) => !d.boss && !d.empty)} sk={skinOf(skin)} notes={{}} onOpen={() => {}} />}
      {(v === 'gacha' || v === 'dex' || v === 'deco') && <OfficeModal onClose={() => {}}><Shop view={view} onView={setView} file={file} draw={async () => null} equip={() => {}} setSkin={() => {}} see={() => {}} onPlace={() => {}} onChars={() => {}} onClose={() => {}} /></OfficeModal>}
      {v === 'pick' && <CharGate file={{ ...file, chars: { 참모: 'chr.a_panda' } }} orchs={orchs.map((o) => ({ name: o.name, label: o.label, role: '맡은 일 한 줄' }))} open={false} onClose={() => {}} onPick={() => {}} />}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
