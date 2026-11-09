// 붐비는 사무실 시험 — 참모 7·직원 6이 3단계 방(직원 자리 12)에 앉은 사용자 11-09 화면 그대로(serverfire 스킨·장착 그대로).
// 겹침(캐릭터·이름표·카드 줄)과 캐릭터 정하기 길(방에서 참모를 누르면 고르기 창)을 본다. ?me=<참모 이름> = 이 사무실을 연 참모
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/ui/layers.css';
import '/src/ui/styles.css';
import '/src/ui/office/room.css';
import '/src/ui/office/office2.css';
import '/src/ui/gacha/parts.css';
import { EMPTY_GACHA, officesOf, skinOfRoom, sprOfOrch, type GachaFile } from '/src/domain/gacha';
import { planOffice, type OrchIn, type Seat } from '/src/domain/office';
import { gachaDeco } from '/src/domain/phoneOffice';
import { charDot, deskAction } from '/src/domain/spaceOffice';
import { CharGate } from '/src/ui/office/CharPicker';
import { OfficeRooms } from '/src/ui/office/OfficeRooms';
import { OfficeTools } from '/src/ui/office/OfficeMenu';
import { OfficeView } from '/src/ui/office/OfficeView';
import { OfficeDock } from '/src/ui/office/OfficeDock';
import { skinOf } from '/src/ui/office/skins';

const q = new URLSearchParams(location.search);
const me = q.get('me') ?? '모모-2';
const owned: Record<string, number> = { 'chr.a_sweatlamb': 1, 'chr.star_r1': 1, 'chr.a_donut': 1, 'chr.bear': 2, 'chr.a_panda': 1, 'chr.a_devcoon': 1,
  'skin.serverfire': 1, 'hat.pumpkinhead': 1, 'window.batswarm': 1, 'fx.ghosts': 1, 'action.coffee': 1, 'title.night': 1, 'light.moonbeam': 1, 'desk.candybowl': 1, 'friend.dog': 1 };
const start: GachaFile = {
  ...EMPTY_GACHA, coins: 1384, since: 0, owned, pity: 0,
  equip: { hat: 'hat.pumpkinhead', window: 'window.batswarm', fx: 'fx.ghosts', action: 'action.coffee', title: 'title.night', skin: 'skin.serverfire', light: 'light.moonbeam', desk: 'desk.candybowl' },
  offices: [{ lv: Number(q.get('lv') ?? 2), zone: [1, 3], furn: {}, floor: [], wall: [] }, { lv: 0, zone: [1, 3], furn: {}, floor: [], wall: [] }],
  orchSeats: { '모모-2': { office: 0, x: 8.3, y: 1.1, w: 2.4 }, '모모-5': { office: 0, x: 0.6, y: 1.1, w: 1.6 }, '모모-7': { office: 0, x: 5.6, y: 1.1, w: 1.6 } },
  chars: q.get('chars') === 'none' ? {} : { 참모: 'chr.a_sweatlamb', '모모-8': 'chr.a_sweatlamb', '모모-5': 'chr.a_sweatlamb', '모모-7': 'chr.a_donut', '참모-3': 'chr.star_r1', '참모-2': 'chr.star_r1', ...(q.get('chars') === 'mine' ? {} : { '모모-2': 'chr.star_r1' }) },
  tamaMoved: { at: 1, coins: 0, chars: 0 },
};
const seat = (id: string, status: Seat['status'] = 'working', act?: Seat['act'], doing?: string): Seat => ({ id, label: id, project: id, status, startedAt: 0, ...(act ? { act } : {}), ...(doing ? { doing } : {}) });
const ORCH: [string, string, Seat['status']][] = [['모모-2', '홍보 담당', 'working'], ['모모-8', '운영 담당', 'done'], ['참모-3', '연구 담당', 'done'], ['모모-5', '개발 담당', 'working'], ['참모', '회사 비서', 'done'], ['참모-2', '디자인 담당', 'done'], ['모모-7', '회계 담당', 'asks']];
const WORK: [string, Seat['status']][] = [['acme-shop', 'working'], ['pet-diary', 'asks'], ['todo-api', 'working'], ['pixel-blog', 'working'], ['cafe-site', 'working'], ['photo-book', 'working']];
const workers = WORK.slice(0, Number(q.get('staff') ?? WORK.length)).map(([p, st], i) => seat(p, st, i % 2 ? 'type' : 'run', 'Bash until grep -qE'));

function App() {
  const [file, setFile] = useState<GachaFile>(start);
  const [cur, setCur] = useState(0);
  const [pick, setPick] = useState<string | null>(null);
  const [dockH, setDockH] = useState(0);
  const orchs: OrchIn[] = ORCH.map(([name, label, st]) => ({ ...seat(`o-${name}`, st, 'think'), label, project: 'hq', name, ...(sprOfOrch(file, name) ? { spr: sprOfOrch(file, name)! } : {}) }));
  const rooms = officesOf(file);
  const plans = rooms.map((room, i) => planOffice({ room, index: i, orchs, workers: i === 0 ? workers : [], seats: file.orchSeats }));
  const skin = skinOfRoom(file, Math.min(cur, rooms.length - 1));
  const deco = gachaDeco(file);
  const nameOf = new Map(orchs.map((o) => [o.id, o.name]));
  const pickOrchs = orchs.map((o) => ({ name: o.name, label: o.label }));
  const meId = orchs.find((o) => o.name === me)?.id;
  const w = window as unknown as { __opened: string[] };
  w.__opened ??= [];
  // App officeCol openDesk 와 같은 길
  const open = (id: string) => { const a = deskAction(id, { orchIds: orchs.map((o) => o.id), offIds: [], chars: true }); if (a === 'char') setPick(nameOf.get(id)!); else w.__opened.push(id); };
  return (
    <div className="office-col" style={{ position: 'relative', width: '100%', height: '100vh', overflow: 'hidden', background: skinOf(skin).bg }}>
      <OfficeRooms cur={cur} onCur={setCur} rooms={plans} lv={rooms.map((r) => r.lv)} skins={rooms.map((_, i) => skinOfRoom(file, i))} coins={file.coins} deco={deco}
        roster={[]} onExpand={() => {}} onOpen={() => {}}
        view={({ room, roomId, overlay, bottom }) => (
          <OfficeView room={room} roomId={roomId} overlay={overlay} skin={skin} bottom={bottom + (dockH ? dockH + 8 : 0)} deco={deco} coins={file.coins} onGacha={() => {}} menu={<OfficeTools tab="office" onTab={() => {}} />}
            onOpen={open} dot={charDot(meId, orchs, (n) => !!sprOfOrch(file, n))}
            bossIn={{ status: 'working', reply: null, voice: false, cheerAt: null }} />
        )} />
      <OfficeDock onHeight={setDockH} desks={plans.flatMap((p) => p.desks).filter((d) => !d.boss && !d.empty)} sk={skinOf(skin)} notes={{}} onOpen={() => {}} />
      <CharGate file={file} orchs={pickOrchs} open={!!pick} first={pick ?? undefined} onClose={() => setPick(null)}
        onPick={(n, id) => setFile((f) => ({ ...f, chars: { ...f.chars, [n]: id } }))} />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
