// 폰 사무실 편집(시안 office-v2 ③C 평면도) — 위에서 본 평면도에서 누르기 두 번: 물건이나 카드를 누르고, 놓을 칸을 누른다. 끌기는 없다(폰은 화면을 밀어 굴린다).
// 칸은 늘 44px 이상 — 전체 보기로 줄였을 땐 누르면 그 자리로 확대부터. 고치기는 맥 앱 한 줄(/api/gacha) — 옆 방 그림은 바로 따라온다
import { useEffect, useMemo, useRef, useState } from 'react';
import { floorSize, wallSpan } from '../../domain/catalog/art';
import { itemOf, type OrchSeat } from '../../domain/gacha';
import { colorFor, type Room } from '../../domain/office';
import { roomDims, seatsOf, wallFree, zoneSize, type OfficeRoom, type WallSide } from '../../domain/officeRoom';
import type { OfficeOp } from '../../domain/phoneGacha';
import { tr } from '../../i18n';
import { IconBack, IconUndo, IconZoomFit, IconZoomIn } from '../Icons';
import { ItemIcon } from '../gacha/GachaPage';
import { drawItem, scaled } from '../gacha/icons';
import { ART_SPR } from '../gacha/packs/artSprites.gen';
import { brush, type Deco } from '../office/draw';
import { OfficeView } from '../office/OfficeView';
import { skinOf } from '../office/skins';
import { pet } from '../office/sprite';
import type { PhoneGachaState } from './PhoneGacha';

type Tab = 'desk' | 'floor' | 'furn' | 'wall';
const TABS: [Tab, string][] = [['desk', tr('책상', 'Desks')], ['floor', tr('바닥 장식', 'Floor')], ['furn', tr('가구', 'Furniture')], ['wall', tr('벽 장식', 'Wall')]];
const MIN_CELL = 44;
const short = (id: string) => itemOf(id)?.name.replace(/^.* — /, '') ?? '';
type Armed = { kind: 'furn' | 'floor' | 'wall' | 'zone' | 'orch'; id: string; w?: number };
type Hit = { wall: { side: WallSide; at: number } } | { cell: [number, number] };
export type EditOrchP = { name: string; label: string; spr: string };

function drawPlan(cv: HTMLCanvasElement, room: OfficeRoom, seats: Record<string, OrchSeat>, index: number, skin: string, armed: Armed | null, sprs: EditOrchP[], staff: string[], S: number) {
  const [cols, rows] = roomDims(room.lv), sk = skinOf(skin), W = (cols + 1) * S, H = (rows + 1) * S;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  cv.style.width = `${W}px`; cv.style.height = `${H}px`;
  const c = cv.getContext('2d');
  if (!c) return;
  c.imageSmoothingEnabled = false; c.clearRect(0, 0, W, H);
  const X = (g: number) => S + g * S, Y = (g: number) => S + g * S;
  // 벽 띠 — 위 = 뒤 벽, 왼쪽 = 왼 벽
  c.fillStyle = sk.wallR; c.fillRect(S, 0, cols * S, S); c.fillStyle = sk.wallL; c.fillRect(0, S, S, rows * S); c.fillStyle = sk.wallTop; c.fillRect(0, 0, S, S);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { c.fillStyle = sk.floor[(i + j) % 2]!; c.fillRect(X(i), Y(j), S, S); }
  // 바닥 장식
  for (const f of room.floor) {
    const a = ART_SPR[`floor:${f.id.slice(6)}`];
    if (!a) continue;
    const [w, h] = floorSize(f.id), du = (w * S) / a.w, dv = (h * S) / a.h;
    a.rows.forEach((row, v) => [...row].forEach((ch, u) => { if (ch === '.') return; c.fillStyle = a.pal[parseInt(ch, 36)]!; c.fillRect(Math.floor(X(f.x) + u * du), Math.floor(Y(f.y) + v * dv), Math.ceil(du), Math.ceil(dv)); }));
  }
  // 고정 소품
  c.fillStyle = sk.shelf; c.fillRect(X(5) + 2, Y(0) + 2, S * 3 - 4, S * 0.4);
  c.fillStyle = sk.leaf[0]!; c.fillRect(X(0) + S * 0.25, Y(0) + S * 0.25, S * 0.5, S * 0.5); c.fillRect(X(cols - 1) + S * 0.25, Y(0) + S * 0.25, S * 0.5, S * 0.5);
  c.fillStyle = sk.water; c.fillRect(X(cols - 1) + S * 0.25, Y(1) + S * 0.25, S * 0.5, S * 0.5);
  // 책상 — 앉은 캐릭터 얼굴과 함께
  const off = document.createElement('canvas'); off.width = 26; off.height = 26;
  const octx = off.getContext('2d')!;
  const desk = (gx: number, gy: number, w: number, spr: string | null, boss: boolean, faded: boolean) => {
    const x = X(gx), y = Y(Math.floor(gy));
    c.globalAlpha = faded ? 0.55 : 1;
    c.fillStyle = sk.deskTop; c.fillRect(x, y + S * 0.95, w * S, S * 0.6);
    c.fillStyle = sk.deskL; c.fillRect(x, y + S * 1.55, w * S, S * 0.12);
    if (boss) { c.fillStyle = '#e0b94f'; c.fillRect(x + w * S * 0.4, y + S * 1.2, w * S * 0.2, S * 0.2); }
    if (spr) { octx.clearRect(0, 0, 26, 26); pet(brush(octx), sk, spr, 5, 9, sk.pets[colorFor(spr) % sk.pets.length]!); const s = Math.min(S, 40); c.drawImage(off, x + (w * S - s) / 2, y + S * 0.1, s, s); }
    c.globalAlpha = 1;
  };
  seatsOf(room).forEach(([x, y], k) => desk(x + 0.2, y, 1.6, staff[k] ?? null, false, !staff[k]));
  const [zw, zh] = zoneSize(room.lv);
  c.lineWidth = 2; c.strokeStyle = armed?.kind === 'zone' ? '#e8743a' : '#2f74e0'; c.setLineDash([6, 4]); c.strokeRect(X(room.zone[0]) + 1, Y(room.zone[1]) + 1, zw * S - 2, zh * S - 2); c.setLineDash([]);
  for (const [name, s] of Object.entries(seats)) if (s.office === index) desk(s.x, s.y, s.w ?? 1.6, sprs.find((o) => o.name === name)?.spr ?? null, (s.w ?? 0) > 2, false);
  // 가구
  const icon = document.createElement('canvas'); icon.width = 28; icon.height = 24;
  const ictx = icon.getContext('2d')!;
  const pic = (id: string, x: number, y: number, s: number) => { ictx.clearRect(0, 0, 28, 24); drawItem(scaled(brush(ictx), 2, 3, 1), id); c.drawImage(icon, x, y + (s - (s * 24) / 28) / 2, s, (s * 24) / 28); };
  for (const [id, f] of Object.entries(room.furn)) pic(id, X(f[0]) + 1, Y(f[1]), S - 2);
  // 칸 선
  c.strokeStyle = 'rgba(42,28,20,.13)'; c.lineWidth = 1; c.beginPath();
  for (let i = 0; i <= cols; i++) { c.moveTo(X(i) + 0.5, S); c.lineTo(X(i) + 0.5, H); }
  for (let j = 0; j <= rows; j++) { c.moveTo(S, Y(j) + 0.5); c.lineTo(W, Y(j) + 0.5); }
  c.stroke();
  // 벽 칸
  for (const [side, n] of [['R', cols], ['L', rows]] as const) for (let at = 0; at < n; at++) {
    const x = side === 'R' ? X(at) : 0, y = side === 'R' ? 0 : Y(at);
    if (wallFree(room.lv, side, at)) { c.strokeStyle = armed?.kind === 'wall' ? '#ffd34d' : 'rgba(42,28,20,.22)'; c.strokeRect(x + 2.5, y + 2.5, S - 5, S - 5); }
    else if (side === 'R' && at >= 1) { c.fillStyle = sk.frame; c.fillRect(x, y + 4, S, S - 8); c.fillStyle = sk.sky; c.fillRect(x + 2, y + 6, S - 4, S - 12); }
  }
  for (const w of room.wall) pic(w.id, w.side === 'R' ? X(w.at) + 2 : 2, w.side === 'R' ? 0 : Y(w.at), S - 4);
  // 문
  c.fillStyle = sk.shelf; c.fillRect(2, Y(rows - 2.1), S - 4, S * 1.05); c.fillStyle = sk.paper; c.fillRect(S - 10, Y(rows - 1.7), 4, 4);
  if (armed) { c.fillStyle = 'rgba(255,211,77,.12)'; c.fillRect(0, 0, W, H); }
}

export function PhoneEdit({ g, room, seats, index, skin, deco, orchs, staff, plan, onClose }: {
  g: PhoneGachaState; room: OfficeRoom; seats: Record<string, OrchSeat>; index: number; skin: string; deco?: Deco; orchs: EditOrchP[];
  /** 직원 자리마다 앉은 캐릭터(평면도 얼굴) */ staff: string[]; plan: Room; onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('floor');
  const [armed, setArmed] = useState<Armed | null>(null);
  const [zoomed, setZoomed] = useState(true);
  const [toast, setToast] = useState('');
  const undo = useRef<OfficeOp[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [cols, rows] = roomDims(room.lv);
  const [boxW, setBoxW] = useState(360);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setBoxW(el.clientWidth);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fitS = Math.max(16, Math.floor(boxW / (cols + 1)));
  const S = zoomed ? Math.max(MIN_CELL, fitS) : fitS;
  const key = JSON.stringify([room, seats, armed, staff, S, skin]);
  useEffect(() => { if (cv.current) drawPlan(cv.current, room, seats, index, skin, armed, orchs, staff, S); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const say = (m: string) => { setToast(m); window.setTimeout(() => setToast((x) => (x === m ? '' : x)), 1400); };
  const send = async (op: OfficeOp, back: OfficeOp | null) => {
    const r = await g.office(op);
    if (r?.ok) { if (back) { undo.current.push(back); setCanUndo(true); } setArmed(null); return; }
    if (r && r.why === 'spot') say(op.op === 'floor' ? tr('바닥 장식끼리는 못 겹쳐', "Floor decor can't overlap") : op.op === 'wall' ? tr('여긴 못 걸어', "Can't hang here") : tr('자리가 겹쳐', 'That spot is taken'));
  };
  /** 지금 자리로 되돌리는 요청 */
  const backOf = (a: Armed): OfficeOp | null => {
    if (a.kind === 'furn') return { op: 'furn', office: index, id: a.id, cell: room.furn[a.id] ?? null };
    if (a.kind === 'floor') { const f = room.floor.find((x) => x.id === a.id); return { op: 'floor', office: index, id: a.id, cell: f ? [f.x, f.y] : null }; }
    if (a.kind === 'wall') { const w = room.wall.find((x) => x.id === a.id); return { op: 'wall', office: index, id: a.id, side: w?.side ?? null, at: w?.at ?? 0 }; }
    if (a.kind === 'zone') return { op: 'zone', office: index, cell: room.zone };
    const s = seats[a.id];
    return s ? { op: 'orch', office: s.office, name: a.id, cell: [Math.floor(s.x), Math.floor(s.y)], w: a.w ?? s.w ?? 1.6 } : null;
  };
  const hitOf = (t: Hit): Armed | null => {
    if ('wall' in t) { const it = room.wall.find((v) => v.side === t.wall.side && t.wall.at >= v.at && t.wall.at < v.at + wallSpan(v.id)); return it ? { kind: 'wall', id: it.id } : null; }
    const [x, y] = t.cell;
    const furn = Object.entries(room.furn).find(([, c]) => c[0] === x && c[1] === y);
    if (furn) return { kind: 'furn', id: furn[0] };
    for (const [name, s] of Object.entries(seats)) if (s.office === index && x >= Math.floor(s.x) && x < Math.ceil(s.x + (s.w ?? 1.6)) && y >= Math.floor(s.y) && y < Math.floor(s.y) + 2) return { kind: 'orch', id: name, w: s.w ?? 1.6 };
    if (seatsOf(room).some(([a, b]) => x >= a && x < a + 2 && y >= b && y < b + 2)) return { kind: 'zone', id: 'zone' };
    const fl = [...room.floor].reverse().find((f) => { const [w, h] = floorSize(f.id); return x >= f.x && x < f.x + w && y >= f.y && y < f.y + h; });
    return fl ? { kind: 'floor', id: fl.id } : null;
  };
  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = cv.current!, r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    // 줄여 본 평면도 — 칸이 44px 보다 작으니 먼저 그 자리로 확대(잘못 놓는 일 없게)
    if (S < MIN_CELL) {
      setZoomed(true);
      const k = MIN_CELL / S;
      window.requestAnimationFrame(() => { box.current?.scrollTo({ left: x * k - boxW / 2, top: y * k - 120 }); });
      return;
    }
    const gx = Math.floor((x - S) / S), gy = Math.floor((y - S) / S);
    let t: Hit | null = null;
    if (x >= S && y < S && gx >= 0 && gx < cols) t = { wall: { side: 'R', at: gx } };
    else if (x < S && y >= S && gy >= 0 && gy < rows) t = { wall: { side: 'L', at: gy } };
    else if (x >= S && y >= S && gx < cols && gy < rows) t = { cell: [gx, gy] };
    if (!t) return;
    if (!armed) { const h = hitOf(t); if (h) setArmed(h); return; }
    const hit = hitOf(t);
    if (hit && hit.kind === armed.kind && hit.id === armed.id) { setArmed(null); return; } // 같은 걸 또 누르면 내려놓기
    const back = backOf(armed);
    if (armed.kind === 'wall') { if ('wall' in t) void send({ op: 'wall', office: index, id: armed.id, side: t.wall.side, at: t.wall.at }, back); else say(tr('벽 칸을 눌러', 'Tap a wall cell')); return; }
    if (!('cell' in t)) { say(tr('바닥 칸을 눌러', 'Tap a floor cell')); return; }
    const [cx, cy] = t.cell;
    if (armed.kind === 'furn') void send({ op: 'furn', office: index, id: armed.id, cell: [cx, cy] }, back);
    else if (armed.kind === 'floor') void send({ op: 'floor', office: index, id: armed.id, cell: [cx, cy] }, back);
    else if (armed.kind === 'zone') void send({ op: 'zone', office: index, cell: [cx, cy] }, back);
    else void send({ op: 'orch', office: index, name: armed.id, cell: [cx, cy], w: armed.w ?? 1.6 }, back);
  };
  const doUndo = () => { const op = undo.current.pop(); setCanUndo(undo.current.length > 0); if (op) void g.office(op); };
  const owned = useMemo(() => (tab === 'desk' || !g.view ? [] : Object.keys(g.view.owned).filter((id) => itemOf(id)?.kind === tab && (g.view!.owned[id] ?? 0) > 0)), [g.view, tab]);
  const placed = (id: string) => (tab === 'furn' ? !!room.furn[id] : tab === 'floor' ? room.floor.some((f) => f.id === id) : room.wall.some((w) => w.id === id));
  const stowable = armed && (armed.kind === 'furn' ? !!room.furn[armed.id] : armed.kind === 'floor' ? room.floor.some((f) => f.id === armed.id) : armed.kind === 'wall' ? room.wall.some((w) => w.id === armed.id) : false);
  const stow = () => {
    if (!armed) return;
    const back = backOf(armed);
    if (armed.kind === 'furn') void send({ op: 'furn', office: index, id: armed.id, cell: null }, back);
    if (armed.kind === 'floor') void send({ op: 'floor', office: index, id: armed.id, cell: null }, back);
    if (armed.kind === 'wall') void send({ op: 'wall', office: index, id: armed.id, side: null, at: 0 }, back);
  };
  return (
    <div className="m-dash m-office m-wide m-plan">
      <header className="m-dash-head">
        <div className="m-dash-row">
          <button type="button" className="m-rt-btn m-ico" onClick={onClose} aria-label={tr('뒤로', 'Back')} title={tr('뒤로', 'Back')}><IconBack /></button>
          <div className="m-dash-title">{tr('꾸미기', 'Decorate')}</div>
          <span className="m-grow" />
          <button type="button" className="m-rt-btn m-ico" onClick={() => setZoomed((v) => !v)} aria-pressed={zoomed} aria-label={zoomed ? tr('전체 보기', 'Fit') : tr('확대', 'Zoom in')} title={zoomed ? tr('전체 보기', 'Fit') : tr('확대', 'Zoom in')}>{zoomed ? <IconZoomFit /> : <IconZoomIn />}</button>
          <button type="button" className="m-rt-btn m-ico" disabled={!canUndo} onClick={doUndo} aria-label={tr('되돌리기', 'Undo')} title={tr('되돌리기', 'Undo')}><IconUndo /></button>
        </div>
      </header>
      <div className="m-plan-box" ref={box}><canvas ref={cv} onClick={click} /></div>
      {toast && <div className="e-toast on">{toast}</div>}
      <div className="m-plan-iso" style={{ background: skinOf(skin).bg }}><OfficeView room={plan} skin={skin} deco={deco} fit="box" tags="few" onOpen={() => {}} /></div>
      <div className="m-office-sheet m-plan-sheet">
        <div className="e-chips m-plan-tabs">
          {TABS.map(([k, n]) => <button key={k} type="button" className={k === tab ? 'on' : ''} onClick={() => { setTab(k); setArmed(null); }}>{n}</button>)}
          {stowable && <button type="button" className="m-plan-stow" onClick={stow}>{tr('창고로', 'Store')}</button>}
        </div>
        <div className="e-tray">
          <div className="e-cards">
            {tab === 'desk' && <>
              <button type="button" className={`e-card ${armed?.kind === 'zone' ? 'on' : ''}`} onClick={() => setArmed(armed?.kind === 'zone' ? null : { kind: 'zone', id: 'zone' })}>
                <span className="e-zone" aria-hidden /><span className="nm">{tr('직원 자리', 'Staff')}</span>
              </button>
              {orchs.map((o) => (
                <button key={o.name} type="button" className={`e-card ${armed?.kind === 'orch' && armed.id === o.name ? 'on' : ''}`} title={o.label} onClick={() => setArmed(armed?.id === o.name ? null : { kind: 'orch', id: o.name, w: seats[o.name]?.w ?? 1.6 })}>
                  <ItemIcon id={`chr.${o.spr}`} /><span className="nm">{o.label}</span>
                </button>
              ))}
            </>}
            {tab !== 'desk' && owned.length === 0 && <span className="m-muted m-sm">{tr('아직 없어 — 뽑기에서 나와', 'None yet — they drop from gacha')}</span>}
            {tab !== 'desk' && owned.map((id) => (
              <button key={id} type="button" className={`e-card ${armed?.id === id ? 'on' : ''} ${placed(id) ? 'placed' : ''}`} title={short(id)} onClick={() => setArmed(armed?.id === id ? null : { kind: tab as 'furn' | 'floor' | 'wall', id })}>
                <ItemIcon id={id} /><span className="nm">{short(id)}</span>
                <span className="e-st">{tab === 'floor' ? floorSize(id).join('×') : placed(id) ? tr('놓임', 'Placed') : tr('창고', 'Stored')}</span>
                {placed(id) && <i className="chk" />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
