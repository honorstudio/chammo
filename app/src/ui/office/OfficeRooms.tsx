// 사무실 넘기기·넓히기·열기·출근 명단(시안 office-v2 ④A) — 방 칸을 감싼다. 아래 세 칸 = 사무실(안 산 건 값), 양옆 화살표로 넘긴다
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Room } from '../../domain/office';
import { expandPrice, interiorCells, LEVELS, MAX_OFFICES, officePrice, roomDims, seatCount, wallSlots } from '../../domain/officeRoom';
import { tr } from '../../i18n';
import { ItemIcon } from '../gacha/GachaPage';
import { IconChevron, IconLock, IconPeople } from '../Icons';
import { drawRoom, roomSize, type Brush, type Deco } from './draw';
import { skinOf } from './skins';
import './office2.css';

const fmt = (n: number) => n.toLocaleString();
type P3 = (x: number, y: number, z?: number) => [number, number];
export type RosterRow = { key: string; label: string; spr: string; office: number; set: (i: number) => void };
/** 직원 자리를 쓰는 사람 수(선 사람 포함) — 뒷줄 제자리 참모까지 세면 자리는 남는데 13/12 처럼 넘친 것처럼 보였다(11-09) */
const countOf = (r: Room) => r.used ?? r.desks.filter((d) => !d.empty).length;

/** 작은 방 그림 — 모양이 바뀔 때만 다시 그린다 */
function RoomThumb({ room, skin, deco, width }: { room: Room; skin: string; deco?: Deco; width: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify([room.cols, room.rows, room.desks.map((d) => [d.id, d.spr, d.gx, d.gy, !!d.empty]), room.furniture, room.floor, room.wall, skin, deco?.window]);
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const { W, H } = roomSize(room), off = document.createElement('canvas');
    off.width = W; off.height = H;
    const octx = off.getContext('2d');
    if (!octx) return;
    drawRoom(octx, room, skinOf(skin), 3, { deco: { window: deco?.window } });
    const k = width / W;
    c.width = Math.round(W * k * 2); c.height = Math.round(H * k * 2);
    c.style.width = `${Math.round(W * k)}px`; c.style.height = `${Math.round(H * k)}px`;
    const x = c.getContext('2d');
    if (!x) return;
    x.imageSmoothingEnabled = false; x.clearRect(0, 0, c.width, c.height); x.drawImage(off, 0, 0, c.width, c.height);
  }, [key, width]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={cv} />;
}

/** 넓어질 자리 — 안개처럼 덮고 지금 벽 끝을 깜빡인다 */
export const growOverlay = (lv: number) => {
  const next = LEVELS[lv + 1];
  if (!next) return undefined;
  return (b: Brush, P: P3) => {
    const [cc, cr] = roomDims(lv), f = Math.floor(Date.now() / 120);
    for (let x = 0; x < next.cols; x++) for (let y = 0; y < next.rows; y++) if ((x >= cc || y >= cr) && ((x + y) % 2 === 0 || f % 2 === 0)) b.poly([P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)], 'rgba(255,255,255,.38)');
    const col = f % 8 < 4 ? '#e8743a' : '#ffb27a';
    b.line(P(cc, 0), P(cc, cr), col); b.line(P(0, cr), P(cc, cr), col);
  };
};
/** 넓히기 카드 — 값·늘어나는 칸 수를 먼저 보여 주고 산다 */
export function GrowCard({ lv, coins, onCancel, onBuy }: { lv: number; coins: number; onCancel: () => void; onBuy: () => void }) {
  const next = LEVELS[lv + 1], price = expandPrice(lv);
  if (!next || price === null) return null;
  return (
    <div className="r-grow-card">
      <h4>{tr(`${lv + 1}단계로 넓히기`, `Expand to level ${lv + 1}`)}</h4>
      <div className="r-steps">{[1, 2, 3].map((k) => <i key={k} className={k <= lv + 1 ? 'on' : ''} />)}</div>
      <ul>
        <li>{tr('넓이', 'Size')}</li><b>{roomDims(lv).join('×')} → {next.cols}×{next.rows}</b>
        <li>{tr('직원 자리', 'Staff seats')}</li><b>{seatCount(lv)} → {seatCount(lv + 1)}</b>
        <li>{tr('인테리어 칸', 'Interior')}</li><b>{interiorCells(lv)} → {interiorCells(lv + 1)}</b>
        <li>{tr('벽 장식 칸', 'Wall')}</li><b>{wallSlots(lv)} → {wallSlots(lv + 1)}</b>
      </ul>
      <div className="r-grow-btns">
        <button className="v-cta quiet" onClick={onCancel}>{tr('취소', 'Cancel')}</button>
        <button className="v-cta" disabled={coins < price} onClick={onBuy}>{coins < price ? tr(`코인 ${fmt(price - coins)} 모자라`, `${fmt(price - coins)} coins short`) : tr(`코인 ${fmt(price)}으로 넓히기`, `Expand for ${fmt(price)}`)}</button>
      </div>
    </div>
  );
}
/** 안 산 사무실 — 값을 보여 주고 연다. 차례대로만 */
export function LockCard({ index, opened, coins, onOpen }: { index: number; opened: number; coins: number; onOpen: () => void }) {
  const p = officePrice(index) ?? 0, need = p - coins, canOpen = index === opened;
  return (
    <div className="r-lock">
      <div className="r-lock-card">
        <h4>{tr(`${index + 1}번째 사무실`, `Office ${index + 1}`)}</h4>
        <p>{canOpen ? tr('기본 크기로 시작해. 넓히기는 따로.', 'Starts at the base size. Expanding is separate.') : tr(`${opened + 1}번째 사무실부터 열어야 해`, `Open office ${opened + 1} first`)}</p>
        <button className="v-cta" disabled={need > 0 || !canOpen} onClick={onOpen}>{need > 0 ? tr(`코인 ${fmt(need)} 모자라`, `${fmt(need)} coins short`) : tr(`코인 ${fmt(p)}으로 열기`, `Open for ${fmt(p)}`)}</button>
      </div>
    </div>
  );
}

export function OfficeRooms({ cur, onCur, rooms, skins, coins, deco, roster, onExpand, onOpen, lv, view }: {
  cur: number; onCur: (i: number) => void; rooms: Room[]; skins: string[]; coins: number; deco?: Deco; roster: RosterRow[];
  /** 넓히기(지금 사무실)·다음 사무실 열기 */ onExpand: () => void; onOpen: () => void; lv: number[];
  /** 방 칸 그리기 — overlay = 넓어질 자리, bottom = 아래 세 칸 높이, room = 미리보기까지 얹은 방 */
  view: (o: { room: Room; roomId: number; overlay?: (b: Brush, P: P3) => void; bottom: number }) => ReactNode;
}) {
  const [preview, setPreview] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const page = useRef<HTMLDivElement>(null);
  const opened = rooms.length;
  const go = (i: number) => {
    if (i < 0 || i >= MAX_OFFICES || i === cur) return;
    page.current?.animate([{ transform: `translateX(${i > cur ? 46 : -46}px)`, opacity: 0.35 }, { transform: 'none', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(.3,.9,.3,1)' });
    setPreview(false);
    onCur(i);
  };
  useEffect(() => { setPreview(false); }, [cur]);
  const locked = cur >= opened;
  const myLv = lv[cur] ?? 0;
  const next = LEVELS[myLv + 1];
  const room = rooms[cur] ?? { cols: 8, rows: 7, desks: [], door: true };
  const shown: Room = preview && next ? { ...room, cols: next.cols, rows: next.rows } : room;
  const overlay = preview ? growOverlay(myLv) : undefined;
  const price = expandPrice(myLv);
  const short = room.short ?? 0;

  return (
    <>
      <div className="r-page" ref={page}>{view({ room: shown, roomId: cur, overlay, bottom: 136 })}</div>
      {cur > 0 && <button className="r-edge l" aria-label={tr('앞 사무실', 'Previous office')} title={tr('앞 사무실', 'Previous office')} onClick={() => go(cur - 1)}><IconChevron /></button>}
      {cur < MAX_OFFICES - 1 && !showRoster && <button className="r-edge r" aria-label={tr('다음 사무실', 'Next office')} title={tr('다음 사무실', 'Next office')} onClick={() => go(cur + 1)}><IconChevron /></button>}
      <button className="v-ico-btn r-toggle" aria-label={tr('출근 명단', 'Who works where')} title={tr('출근 명단', 'Who works where')} aria-pressed={showRoster} onClick={() => setShowRoster((v) => !v)}><IconPeople /></button>
      {!locked && short > 0 && !preview && (
        <div className="r-warn">{tr(`자리 ${short} 모자람`, `${short} short`)}{price !== null && <button onClick={() => setPreview(true)}>{tr('넓히기', 'Expand')}</button>}</div>
      )}
      <div className="ra-dock">
        {Array.from({ length: MAX_OFFICES }, (_, i) => {
          const r = rooms[i], n = r ? countOf(r) : 0, cap = seatCount(lv[i] ?? 0), s = r?.short ?? 0;
          return (
            <button key={i} type="button" className={`ra-th ${cur === i ? 'on' : ''}`} aria-label={tr(`${i + 1}번 사무실`, `Office ${i + 1}`)} title={tr(`${i + 1}번 사무실`, `Office ${i + 1}`)} onClick={() => go(i)}>
              <div className="pic">{r ? <RoomThumb room={r} skin={skins[i] ?? 'wood'} deco={deco} width={84 + (lv[i] ?? 0) * 12} /> : <div className="v-lockpic"><IconLock /></div>}</div>
              <span className="ln">{r ? <>{n}/{cap}{s > 0 && <i> -{s}</i>}</> : <span className="v-price"><i />{fmt(officePrice(i) ?? 0)}</span>}</span>
            </button>
          );
        })}
      </div>
      <div className="r-grow-slot">
        {!locked && preview && <GrowCard lv={myLv} coins={coins} onCancel={() => setPreview(false)} onBuy={() => { onExpand(); setPreview(false); }} />}
        {!locked && !preview && price !== null && (
          <button className="v-cta quiet" onClick={() => setPreview(true)}>{tr('넓히기', 'Expand')}<small>{tr(`${myLv + 1}단계 · 코인 ${fmt(price)}`, `Level ${myLv + 1} · ${fmt(price)} coins`)}</small></button>
        )}
      </div>
      {locked && <LockCard index={cur} opened={opened} coins={coins} onOpen={onOpen} />}
      {showRoster && (
        <div className="r-roster-slot">
          <div className="r-roster">
            <h4>{tr('출근 명단', 'Who works where')}</h4>
            <div className="r-rows">
              {roster.map((x) => (
                <div key={x.key} className="r-row">
                  <div className="fc"><ItemIcon id={`chr.${x.spr}`} size={28} /></div>
                  <b title={x.label}>{x.label}</b>
                  <div className="r-seg">{[0, 1, 2].map((k) => <button key={k} type="button" className={x.office === k ? 'on' : ''} disabled={!rooms[k]} aria-label={tr(`${k + 1}번 사무실`, `Office ${k + 1}`)} title={tr(`${k + 1}번 사무실`, `Office ${k + 1}`)} onClick={() => x.set(k)}>{k + 1}</button>)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
