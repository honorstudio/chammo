// 사무실 편집(시안 office-v2 ③A 층 나눠서) — 왼쪽에서 층을 고르면 그 층만 진하고 집힌다. 끄는 동안은 방에 미리 얹어 보고, 놓을 때 규칙(domain/officeRoom)을 통과하면 저장
import { useEffect, useMemo, useRef, useState } from 'react';
import { floorSize, wallSpan } from '../../domain/catalog/art';
import { hangWall, itemOf, layoutOf, moveOrchToOffice, moveZoneIn, officesOf, orchDesksOf, ownedOf, placeFloorIn, placeFurnIn, setLayout, setOrchSeat, type GachaFile, type ItemKind, type Layout, type OrchSeat } from '../../domain/gacha';
import { cellAt, furnitureAt, wallAt, type Room } from '../../domain/office';
import { canHangWall, canMoveOrch, canMoveZone, canPlaceFloor, canPlaceFurn, interiorCells, orchDeskAt, roomDims, seatCount, seatsOf, wallFree, wallSlots, zoneSize, type OfficeRoom, type WallSide } from '../../domain/officeRoom';
import { tr } from '../../i18n';
import { ItemIcon } from '../gacha/GachaPage';
import { IconUndo } from '../Icons';
import { drawRoom, roomSize, type Brush, type Deco } from './draw';
import { skinOf } from './skins';

type Layer = 'wall' | 'desk' | 'furn' | 'floor';
const LAYERS: [Layer, string][] = [['wall', tr('벽 장식', 'Wall')], ['desk', tr('책상', 'Desks')], ['furn', tr('가구', 'Furniture')], ['floor', tr('바닥 장식', 'Floor')]];
const HINT: Record<Layer, string> = {
  wall: tr('벽 칸에 걸어 — 바닥 칸을 안 먹어', 'Hang on the wall — takes no floor'),
  desk: tr('직원 자리는 묶음으로, 참모 책상은 하나씩 옮겨', 'Staff desks move together, advisor desks one by one'),
  furn: tr('바닥 칸에 놓아 — 바닥 장식 위에도 돼', 'Place on the floor — over floor decor is fine'),
  floor: tr('책상·가구 아래에 깔려 — 바닥 장식끼리만 못 겹쳐', 'Goes under desks and furniture — only floor decor can\'t overlap'),
};
const KIND: Record<Exclude<Layer, 'desk'>, ItemKind> = { wall: 'wall', furn: 'furn', floor: 'floor' };
const short = (id: string) => itemOf(id)?.name.replace(/^.* — /, '') ?? '';

type Drag = { kind: 'furn' | 'floor' | 'wall' | 'zone' | 'orch'; id: string; grab: [number, number]; cell: [number, number] | null; wall: { side: WallSide; at: number } | null; ok: boolean; why: string; moved: boolean; w: number };
export type EditOrch = { name: string; label: string; spr: string };
const tile = (b: Brush, P: (x: number, y: number, z?: number) => [number, number], x: number, y: number, w: number, h: number, c: string) => b.poly([P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)], c);

/** 끄는 중인 것을 방에 얹어 본 모양 — 저장 전 미리 보기 */
function applyDrag(room: OfficeRoom, seats: Record<string, OrchSeat>, d: Drag | null, index: number): { room: OfficeRoom; seats: Record<string, OrchSeat> } {
  if (!d) return { room, seats };
  if (d.kind === 'wall') return d.wall ? { room: { ...room, wall: [...room.wall.filter((x) => x.id !== d.id), { id: d.id, ...d.wall }] }, seats } : { room, seats };
  if (!d.cell) return { room, seats };
  const [x, y] = d.cell;
  if (d.kind === 'furn') return { room: { ...room, furn: { ...room.furn, [d.id]: [x, y] } }, seats };
  if (d.kind === 'floor') return { room: { ...room, floor: [...room.floor.filter((f) => f.id !== d.id), { id: d.id, x, y }] }, seats };
  if (d.kind === 'zone') return { room: { ...room, zone: [x, y] }, seats };
  const at = orchDeskAt([x, y], d.w);
  return { room, seats: { ...seats, [d.id]: { office: index, x: at.x, y: at.y, w: d.w } } };
}

export function OfficeEdit({ file, index, skin, deco, plan, orchs, change, onDone, layer0 }: {
  file: GachaFile; index: number; skin: string; deco?: Deco;
  /** 사무실 모양 → 그릴 방(세션이 앉은 채로) */ plan: (room: OfficeRoom, seats: Record<string, OrchSeat>) => Room;
  orchs: EditOrch[]; change: (op: (f: GachaFile) => GachaFile | null) => Promise<unknown>; onDone: () => void; layer0?: Layer;
}) {
  const [layer, setLayer] = useState<Layer>(layer0 ?? 'floor');
  const [toast, setToast] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [floatId, setFloatId] = useState<string | null>(null);
  const hist = useRef<Layout[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const float = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [scale, setScale] = useState(2);
  const room = officesOf(file)[index]!;
  const seats = file.orchSeats ?? {};
  const desks = orchDesksOf(file, index);
  const latest = useRef({ room, seats, layer, plan, skin, deco, desks });
  latest.current = { room, seats, layer, plan, skin, deco, desks };
  const size = roomSize({ cols: roomDims(room.lv)[0], rows: roomDims(room.lv)[1], desks: [] });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setScale(Math.max(1, Math.floor(Math.min((el.clientWidth - 24) / size.W, (el.clientHeight - 24) / size.H))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size.W, size.H]);

  // 그리기 — 고른 층만 진하게: 벽·바닥 층이면 책상·가구를 옅게 얹는다
  useEffect(() => {
    const c = cv.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const off = document.createElement('canvas');
    let t = 0;
    const frame = () => {
      const L = latest.current, d = drag.current;
      const draft = applyDrag(L.room, L.seats, d, index);
      const r = L.plan(draft.room, draft.seats);
      const { W, H } = roomSize(r), sk = skinOf(L.skin);
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      if (off.width !== W || off.height !== H) { off.width = W; off.height = H; }
      const [cols, rows] = roomDims(L.room.lv);
      const under = (b: Brush, P: (x: number, y: number, z?: number) => [number, number]) => {
        if (L.layer === 'desk') {
          const [w, h] = zoneSize(L.room.lv), [x, y] = draft.room.zone, zd = d?.kind === 'zone';
          tile(b, P, x, y, w, h, zd ? (d!.ok ? 'rgba(80,200,120,.45)' : 'rgba(229,72,77,.45)') : 'rgba(47,116,224,.13)');
          const col = zd ? (d!.ok ? '#2f9a58' : '#d9462f') : '#2f74e0';
          for (const [p, q] of [[P(x, y), P(x + w, y)], [P(x + w, y), P(x + w, y + h)], [P(x + w, y + h), P(x, y + h)], [P(x, y + h), P(x, y)]] as const) b.line(p, q, col);
        }
        if (d?.cell && d.kind !== 'zone') {
          const [x, y] = d.cell, [w, h] = d.kind === 'floor' ? floorSize(d.id) : d.kind === 'orch' ? [Math.ceil(d.w) + 1, 2] : [1, 1];
          tile(b, P, x, y, w!, h!, d.ok ? 'rgba(80,200,120,.5)' : 'rgba(229,72,77,.72)');
        }
        if (L.layer === 'wall' || d?.kind === 'wall') {
          const quad = (side: WallSide, at: number, col: string) => { const pt = (u: number, z: number) => (side === 'R' ? P(at + u, 0, z) : P(0, at + u, z)); b.poly([pt(0.04, 13), pt(0.96, 13), pt(0.96, 41), pt(0.04, 41)], col); };
          for (const [side, n] of [['R', cols], ['L', rows]] as const) for (let at = 0; at < n; at++) {
            const span = d?.kind === 'wall' ? wallSpan(d.id) : 1;
            const hover = d?.wall?.side === side && at >= d.wall.at && at < d.wall.at + span;
            if (!wallFree(L.room.lv, side, at) && !hover) continue;
            const taken = L.room.wall.some((w) => w.id !== d?.id && w.side === side && at >= w.at && at < w.at + wallSpan(w.id));
            if (hover) quad(side, at, d!.ok ? 'rgba(80,200,120,.6)' : 'rgba(229,72,77,.55)');
            else if (!taken) quad(side, at, 'rgba(255,211,77,.32)');
          }
        }
      };
      if (L.layer === 'wall' || L.layer === 'floor') {
        drawRoom(ctx, r, sk, t, { deco: L.deco, edit: { grid: L.layer === 'floor', skipItems: true, under } });
        const octx = off.getContext('2d')!;
        drawRoom(octx, r, sk, t, { deco: L.deco });
        ctx.save(); ctx.globalAlpha = 0.28; ctx.drawImage(off, 0, 0); ctx.restore();
      } else {
        drawRoom(ctx, r, sk, t, { deco: L.deco, edit: { grid: true, under } });
      }
      t++;
    };
    frame();
    const id = setInterval(frame, 120);
    return () => clearInterval(id);
  }, [index]);

  const say = (m: string) => { setToast(m); window.setTimeout(() => setToast((x) => (x === m ? '' : x)), 1400); };

  const logical = (e: { clientX: number; clientY: number }) => {
    const r = cv.current!.getBoundingClientRect(), k = r.width / cv.current!.width;
    return [(e.clientX - r.left) / k, (e.clientY - r.top) / k] as const;
  };
  const planNow = () => latest.current.plan(latest.current.room, latest.current.seats);

  const check = (d: Drag) => {
    const { room: R, desks: ds } = latest.current;
    if (d.kind === 'wall') { const ok = !!d.wall && canHangWall(R, d.id, d.wall.side, d.wall.at, wallSpan); d.ok = ok; d.why = ok ? '' : tr('여긴 못 걸어', "Can't hang here"); return; }
    const c = d.cell;
    if (!c) { d.ok = false; d.why = ''; return; }
    if (d.kind === 'furn') d.ok = canPlaceFurn(R, ds, d.id, c);
    else if (d.kind === 'floor') d.ok = canPlaceFloor(R, d.id, c, floorSize);
    else if (d.kind === 'zone') d.ok = canMoveZone(R, ds, c);
    else d.ok = canMoveOrch(R, ds, d.id, c, d.w);
    d.why = d.ok ? '' : d.kind === 'floor' ? tr('바닥 장식끼리는 못 겹쳐', "Floor decor can't overlap") : tr('자리가 겹쳐', 'That spot is taken');
  };

  const commit = (d: Drag, toTray: boolean) => {
    const before = layoutOf(file);
    const push = () => { hist.current.push(before); setCanUndo(true); };
    const { desks: ds } = latest.current;
    if (toTray) {
      if (d.kind === 'furn') void change((f) => placeFurnIn(f, index, d.id, null, ds)).then(push);
      if (d.kind === 'floor') void change((f) => placeFloorIn(f, index, d.id, null)).then(push);
      if (d.kind === 'wall') void change((f) => hangWall(f, index, d.id, null, 0)).then(push);
      return;
    }
    if (!d.ok) { if (d.why) say(d.why); return; }
    if (d.kind === 'wall') void change((f) => hangWall(f, index, d.id, d.wall!.side, d.wall!.at)).then(push);
    else if (d.kind === 'furn') void change((f) => placeFurnIn(f, index, d.id, d.cell!, ds)).then(push);
    else if (d.kind === 'floor') void change((f) => placeFloorIn(f, index, d.id, d.cell!)).then(push);
    else if (d.kind === 'zone') void change((f) => moveZoneIn(f, index, d.cell!, ds)).then(push);
    else { const at = orchDeskAt(d.cell!, d.w); void change((f) => setOrchSeat(f, d.id, { office: index, x: at.x, y: at.y, w: d.w })).then(push); }
  };

  /** 끌기 시작 — 방 위면 칸을 따라가고, 밖이면 커서 옆에 작은 아이콘. 트레이에 놓으면 창고 */
  const begin = (d: Drag, e: { clientX: number; clientY: number }, icon: boolean) => {
    drag.current = d;
    setDragging(d.id);
    const start = [e.clientX, e.clientY] as const;
    const move = (ev: PointerEvent) => {
      if (!d.moved && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) < 4) return;
      d.moved = true;
      const [x, y] = logical(ev), r = planNow(), { ox, oy } = roomSize(r);
      let over = false;
      if (d.kind === 'wall') { const w = wallAt(r, ox, oy, x, y); if (w) { d.wall = w; over = true; } }
      else { const c = cellAt(r, ox, oy, x, y); if (c) { d.cell = [c[0] - d.grab[0], c[1] - d.grab[1]]; over = true; } }
      check(d);
      const fl = float.current;
      if (fl && icon) { fl.style.display = over ? 'none' : 'block'; fl.style.left = `${ev.clientX}px`; fl.style.top = `${ev.clientY}px`; }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (float.current) float.current.style.display = 'none';
      const toTray = !!(ev.target as HTMLElement | null)?.closest?.('.e-tray');
      if (d.moved) commit(d, toTray);
      drag.current = null;
      setDragging(null);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const down = (e: React.PointerEvent) => {
    const [x, y] = logical(e), r = planNow(), { ox, oy } = roomSize(r), base = { wall: null, ok: true, why: '', moved: false, w: 1.6 };
    const a = (x - ox) / 12, b = (y - oy) / 6, fx = (a + b) / 2, fy = (b - a) / 2;
    const near = (gx: number, gy: number) => { const px = ox + (gx - gy) * 12, py = oy + (gx + gy) * 6 - 5; return Math.abs(px - x) < 22 && y > py - 22 && y < py + 16; };
    const c = cellAt(r, ox, oy, x, y) ?? [0, 0];
    if (layer === 'furn') { const id = furnitureAt(r, ox, oy, x, y); if (id) { const at = room.furn[id]; if (at) begin({ ...base, kind: 'furn', id, grab: [0, 0], cell: at }, e, false); } }
    if (layer === 'floor') { const f = [...room.floor].reverse().find((v) => { const [w, h] = floorSize(v.id); return fx >= v.x && fx < v.x + w && fy >= v.y && fy < v.y + h; }); if (f) begin({ ...base, kind: 'floor', id: f.id, grab: [c[0] - f.x, c[1] - f.y], cell: [f.x, f.y] }, e, false); }
    if (layer === 'wall') { const w = wallAt(r, ox, oy, x, y); const it = w && room.wall.find((v) => v.side === w.side && w.at >= v.at && w.at < v.at + wallSpan(v.id)); if (it) begin({ ...base, kind: 'wall', id: it.id, grab: [0, 0], cell: null, wall: { side: it.side, at: it.at } }, e, false); }
    if (layer === 'desk') {
      const o = desks.find((q) => near(q.x + q.w / 2, q.y + 0.6));
      if (o) { const fc: [number, number] = [Math.floor(o.x), Math.floor(o.y)]; begin({ ...base, kind: 'orch', id: o.id, w: o.w, grab: [c[0] - fc[0], c[1] - fc[1]], cell: fc }, e, false); return; }
      if (seatsOf(room).some(([sx, sy]) => near(sx + 1, sy + 0.6))) begin({ ...base, kind: 'zone', id: 'zone', grab: [c[0] - room.zone[0], c[1] - room.zone[1]], cell: room.zone }, e, false);
    }
  };

  const undo = () => { const s = hist.current.pop(); setCanUndo(hist.current.length > 0); if (s) void change((f) => setLayout(f, s)); };
  const owned = useMemo(() => (layer === 'desk' ? [] : ownedOf(file, KIND[layer])), [file, layer]);
  const stateOf = (id: string): string => {
    const where = officesOf(file).findIndex((r) => (layer === 'furn' ? !!r.furn[id] : layer === 'floor' ? r.floor.some((f) => f.id === id) : r.wall.some((w) => w.id === id)));
    if (layer === 'floor') { const [w, h] = floorSize(id); return tr(`${w}×${h}칸`, `${w}×${h}`); }
    return where < 0 ? tr('창고', 'Stored') : where === index ? tr('놓임', 'Placed') : tr(`${where + 1}번 사무실`, `Office ${where + 1}`);
  };
  const placedHere = (id: string) => (layer === 'furn' ? !!room.furn[id] : layer === 'floor' ? room.floor.some((f) => f.id === id) : room.wall.some((w) => w.id === id));
  const grabCard = (id: string, e: React.PointerEvent) => {
    e.preventDefault();
    const base = { grab: [0, 0] as [number, number], cell: null, wall: null, ok: false, why: '', moved: false, w: 1.6 };
    if (layer === 'desk') return;
    setFloatId(id);
    begin({ ...base, kind: layer, id }, e, true);
  };
  const moveOrchTo = (name: string, k: number) => {
    const before = layoutOf(file), next = moveOrchToOffice(file, name, k);
    if (next === file) { if (seats[name]?.office !== k) say(tr('그 사무실에 자리가 없어', 'No room in that office')); return; }
    void change((f) => moveOrchToOffice(f, name, k)).then(() => { hist.current.push(before); setCanUndo(true); });
  };
  const used = Object.keys(room.furn).length, wallUsed = room.wall.reduce((n, w) => n + wallSpan(w.id), 0);
  const rooms = officesOf(file);

  return (
    <div className="e-edit" style={{ background: skinOf(skin).bg }}>
      <div className="office" ref={wrap} style={{ background: 'transparent' }}>
        <div className="office-room" style={{ width: size.W * scale, height: size.H * scale }}>
          <canvas ref={cv} className="office-cv" style={{ width: size.W * scale, height: size.H * scale, touchAction: 'none' }} onPointerDown={down} />
        </div>
      </div>
      <div className="e-rail" role="tablist" aria-label={tr('편집 층', 'Layers')}>
        {LAYERS.map(([k, n]) => <button key={k} type="button" role="tab" aria-selected={k === layer} className={k === layer ? 'on' : ''} onClick={() => setLayer(k)}>{n}</button>)}
      </div>
      <div className="e-top">
        <button className="v-ico-btn" aria-label={tr('되돌리기', 'Undo')} title={tr('되돌리기', 'Undo')} disabled={!canUndo} onClick={undo}><IconUndo /></button>
        <button className="v-cta ink" onClick={onDone}>{tr('다 했어', 'Done')}</button>
      </div>
      {toast && <div className="e-toast on">{toast}</div>}
      <div className={`e-tray ${dragging ? 'drop' : ''}`}>
        <div className="e-head">
          <b>{LAYERS.find(([k]) => k === layer)![1]}</b>
          <span className="dim">{dragging && layer !== 'desk' ? tr('여기로 가져오면 창고', 'Bring it back here to store') : HINT[layer]}</span>
          <span className="e-count">{tr('인테리어 칸', 'Interior')} <b>{used}</b>/{interiorCells(room.lv)} · {tr('벽 칸', 'Wall')} <b>{wallUsed}</b>/{wallSlots(room.lv)}</span>
        </div>
        <div className="e-cards">
          {layer === 'desk' && <>
            <div className="e-card" title={tr('직원 책상 묶음 — 방에서 끌어 옮긴다', 'Staff desks — drag them in the room')}>
              <span className="e-zone" aria-hidden />
              <span className="nm">{tr('직원 자리', 'Staff')}</span><span className="e-st">{tr(`${seatCount(room.lv)}자리`, `${seatCount(room.lv)} seats`)}</span>
            </div>
            {orchs.map((o) => (
              <div key={o.name} className="e-card" title={o.label}>
                <ItemIcon id={`chr.${o.spr}`} size={49} />
                <span className="nm">{o.label}</span>
                <div className="seg">{[0, 1, 2].map((k) => <button key={k} type="button" className={(seats[o.name]?.office ?? 0) === k ? 'on' : ''} disabled={!rooms[k]} aria-label={tr(`${k + 1}번 사무실`, `Office ${k + 1}`)} title={tr(`${k + 1}번 사무실`, `Office ${k + 1}`)} onClick={() => moveOrchTo(o.name, k)}>{k + 1}</button>)}</div>
              </div>
            ))}
          </>}
          {layer !== 'desk' && owned.length === 0 && <span className="dim">{tr('아직 없어 — 뽑기에서 나와', 'None yet — get some from the gacha')}</span>}
          {layer !== 'desk' && owned.map((id) => (
            <button key={id} type="button" className={`e-card ${placedHere(id) ? 'placed' : ''} ${dragging === id ? 'lifted' : ''}`} title={short(id)} onPointerDown={(e) => grabCard(id, e)}>
              <ItemIcon id={id} size={56} />
              <span className="nm">{short(id)}</span>
              <span className="e-st">{stateOf(id)}</span>
              {placedHere(id) && <i className="chk" />}
            </button>
          ))}
        </div>
      </div>
      <div className="furn-float2" ref={float} style={{ display: 'none' }}>{floatId && <ItemIcon id={floatId} size={84} />}</div>
    </div>
  );
}
