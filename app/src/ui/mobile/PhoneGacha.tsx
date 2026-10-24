// 폰 뽑기·스킨(시안 docs/design-drafts/phone-gacha v1 B "방이 무대", 2026-10-23 사용자) — 폰 사무실 방 아래 칸의 뽑기·스킨 탭.
// 폰은 요청만 보내고 굴리기·장착은 맥 앱 한 줄(domain/phoneGacha, 폰 서버 /api/gacha). 기계 그림은 데스크톱 MachineCanvas·machine.ts 그대로
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { CATALOG, itemOf, PITY, PRICE, PRICE_TEN, rarityLabel, type EquipKind, type PullResult, type Rarity } from '../../domain/gacha';
import { withLounge } from '../../domain/office';
import { makeGachaSender, parseView, PHONE_SLOTS, shortName, slotList, type PhoneGachaView, type PhoneReply, type Preview, type SendBody, type SlotFilter } from '../../domain/phoneGacha';
import { gachaRequest, readGachaView } from '../../data/web';
import { machine } from '../../i18n';
import { IconCheck, IconReplay, IconSkip } from '../Icons';
import { DECO_SLOTS, SAMPLE } from '../gacha/DecoView';
import { HowToEarn, ItemIcon } from '../gacha/GachaPage';
import { MachineCanvas } from '../gacha/MachineCanvas';
import { newShow, skipShow, type Show } from '../gacha/machine';
import { Stars } from '../gacha/Stars';
import { drawRoom, roomSize } from '../office/draw';
import { skinOf } from '../office/skins';

const why = (w: string) => ({ short: '코인이 모자라', 'not-owned': '아직 안 가진 거야', unknown: '모르는 아이템이야', off: `${machine()}에서 뽑기가 꺼져 있어` } as Record<string, string>)[w] ?? w;
const noAnswer = () => `${machine()}이 답이 없어 — 잠깐 뒤에 다시`;
const makeRid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.padEnd(8, '0');

/** 폰 뽑기 상태 — 보기는 30초마다·요청 뒤 바로, 요청은 실패하면 같은 요청 id 로 다시(코인 두 번 안 빠짐) */
export function usePhoneGacha() {
  const [view, setView] = useState<PhoneGachaView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** 요청이 도는 중 — 단추를 흐리게(같은 단추 따닥이 따로 과금되지 않게, 문지기는 makeGachaSender) */
  const [busy, setBusy] = useState(false);
  const sender = useRef(makeGachaSender(gachaRequest, makeRid));
  /** 맥이 답을 안 할 때 — 단추를 잠깐 흐리게(10초 뒤 다시 누르면 같은 요청 id 로) */
  const [stalled, setStalled] = useState(false);
  useEffect(() => { if (!stalled) return; const t = setTimeout(() => setStalled(false), 10_000); return () => clearTimeout(t); }, [stalled]);
  const load = useCallback(() => readGachaView().then((t) => { setView(parseView(t)); setErr(null); }, () => setErr(`${machine()}에 못 닿았어`)), []);
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);
  const send = useCallback(async (what: string, body: SendBody): Promise<PhoneReply | null> => {
    setBusy(true);
    const r = await sender.current.send(what, body);
    setBusy(sender.current.busy);
    if ('error' in r) {
      if (r.error === 'no-answer') { setErr(noAnswer()); setStalled(true); }
      return null;
    }
    setView(r.reply.view);
    setErr(r.reply.ok ? null : why(r.reply.why));
    return r.reply;
  }, []);
  const pull = useCallback((n: 1 | 10) => send(`pull${n}`, { op: 'pull', n }), [send]);
  const equip = useCallback((slot: EquipKind, id: string | null) => send(`equip:${slot}:${id}`, { op: 'equip', slot, id }), [send]);
  return { view, err, stalled: stalled || busy, pull, equip };
}
export type PhoneGachaState = ReturnType<typeof usePhoneGacha>;

/** 방 위 연출 덮개 — 누르면 바로 결과(데스크톱과 같음, 결과는 이미 맥에 저장됨) */
export function PlayOverlay({ show, ten }: { show: MutableRefObject<Show | null>; ten: boolean }) {
  const skip = () => { if (show.current) skipShow(show.current, performance.now()); };
  return (
    <div className="m-gacha-over" onClick={skip}>
      <MachineCanvas show={show} className={ten ? 'm-gacha-cv ten' : 'm-gacha-cv'} />
      <button type="button" className="m-rt-btn m-ico m-gacha-skip" onClick={(e) => { e.stopPropagation(); skip(); }} aria-label="건너뛰기" title="건너뛰기"><IconSkip /></button>
    </div>
  );
}

export type Result = { n: 1 | 10; rs: PullResult[] };

/** 연출 시작 — 끝나면 onDone(결과 카드) */
export const startShow = (n: 1 | 10, rs: PullResult[], onDone: () => void): Show => newShow(n === 10 ? 'ten' : 'one', rs.map((r) => ({ id: r.id, rarity: r.rarity })), onDone);

const wearSlot = (id: string): EquipKind | null => { const k = itemOf(id)?.kind as EquipKind | undefined; return k && PHONE_SLOTS.includes(k) ? k : null; };

function ResultCard({ res, g }: { res: Result; g: PhoneGachaState }) {
  const owned = (id: string) => g.view?.owned[id] ?? 0;
  if (res.n === 1) {
    const r = res.rs[0]!;
    const slot = wearSlot(r.id);
    const worn = slot && g.view?.equip[slot] === r.id;
    return (
      <div className="m-gacha-card">
        <span className={`m-gacha-r r-${r.rarity}`}>{rarityLabel(r.rarity)}</span>
        <b>{shortName(r.id)}</b>
        {r.dup ? <Stars count={owned(r.id)} up={r.up} /> : <span className="m-gacha-new">NEW</span>}
        <span className="m-grow" />
        {slot && (worn
          ? <span className="m-gacha-worn"><IconCheck />입힘</span>
          : <button type="button" className="m-gacha-wear" onClick={() => void g.equip(slot, r.id)}>지금 입히기</button>)}
      </div>
    );
  }
  const fresh = res.rs.filter((x) => !x.dup).length, up = res.rs.filter((x) => x.up).length, back = res.rs.reduce((n, x) => n + x.refund, 0);
  const order = [...res.rs].sort((a, b) => RANK[b.rarity] - RANK[a.rarity]);
  return (
    <div className="m-gacha-ten">
      <div className="m-gacha-sum">새것 {fresh} · 별 {up} · 코인 +{back}</div>
      <ul className="m-gacha-tenl">
        {order.map((r, i) => (
          <li key={i} className={`r-${r.rarity}`}>
            <ItemIcon id={r.id} />
            <span>{shortName(r.id)}</span>
            {r.dup ? <Stars count={owned(r.id)} up={r.up} /> : <b className="m-gacha-new">NEW</b>}
          </li>
        ))}
      </ul>
    </div>
  );
}
const RANK: Record<Rarity, number> = { 흔함: 0, 보통: 1, 희귀: 2, 전설: 3 };

/** 뽑기 탭 — 작은 기계 + 천장 + 단추 둘, 모자라면 '다음 뽑기까지' 막대 + 버는 법 */
export function GachaTab({ g, playing, result, onPull }: { g: PhoneGachaState; playing: boolean; result: Result | null; onPull: (n: 1 | 10) => void }) {
  const idle = useRef<Show | null>(null);
  const v = g.view;
  if (!v) return <p className="m-muted m-sm m-gacha-wait">{g.err ?? `${machine()}에서 뽑기 상태를 받는 중…`}</p>;
  const short = v.coins < PRICE;
  const price = (cost: number) => (v.coins >= cost ? `코인 ${cost}` : `코인 ${cost - v.coins} 모자라`);
  return (
    <div className="m-gacha">
      {result && !playing && <ResultCard res={result} g={g} />}
      {short ? (
        <>
          <div className="m-gacha-next"><span>다음 뽑기까지</span><div className="m-gacha-bar"><i style={{ width: `${(v.coins / PRICE) * 100}%` }} /></div><b>코인 {PRICE - v.coins}</b></div>
          <div className="m-gacha-how"><HowToEarn open /></div>
        </>
      ) : (
        <div className="m-gacha-split">
          <MachineCanvas show={idle} className="m-gacha-mini" />
          <div className="m-gacha-side">
            <div className="m-gacha-pity"><span>전설까지</span><div className="m-gacha-bar"><i style={{ width: `${(v.pity / PITY) * 100}%` }} /></div><span>{v.pity} / {PITY}</span></div>
            <button type="button" className="m-gacha-btn" disabled={playing || g.stalled || v.coins < PRICE} onClick={() => onPull(1)}>1번 뽑기<small>{price(PRICE)}</small></button>
            <button type="button" className="m-gacha-btn ten" disabled={playing || g.stalled || v.coins < PRICE_TEN} onClick={() => onPull(10)}>10번 뽑기<small>{v.coins >= PRICE_TEN ? `코인 ${PRICE_TEN} · 희귀 이상 1개` : price(PRICE_TEN)}</small></button>
          </div>
        </div>
      )}
      {g.err && <p className="m-gacha-err">{g.err}</p>}
    </div>
  );
}

// ───────── 스킨 탭 ─────────

const SLOT_NAME = new Map(DECO_SLOTS.filter(([k]) => PHONE_SLOTS.includes(k as EquipKind)).map(([k, n]) => [k as EquipKind, n]));
/** 첫 칸 — 스킨은 기본 나무, 장식은 '없음'(빼기) */
const baseOf = (slot: EquipKind) => (slot === 'skin' ? 'skin.wood' : null);

/** 입혀 보기 상태 — 방 화살표·밀기·아래 줄이 같이 쓴다 */
export function useSkinPick(view: PhoneGachaView | null) {
  const [slot, setSlotRaw] = useState<EquipKind>('skin');
  const [filter, setFilter] = useState<SlotFilter>('all');
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const list = useMemo(() => (view ? slotList(view, slot, filter, q) : []), [view, slot, filter, q]);
  const entries: (string | null)[] = filter === 'all' && !q.trim() ? [baseOf(slot), ...list] : list;
  const current = view?.equip[slot] ?? baseOf(slot);
  const shown = preview && preview.slot === slot ? preview.id : current;
  const step = (d: 1 | -1) => {
    if (!entries.length) return;
    const i = entries.indexOf(shown);
    const next = entries[((i < 0 ? 0 : i + d) + entries.length) % entries.length]!;
    setPreview(next === current ? null : { slot, id: next });
  };
  const setSlot = (k: EquipKind) => { setSlotRaw(k); setFilter('all'); setQ(''); setPreview(null); };
  const pick = (id: string | null) => setPreview(id === current ? null : { slot, id });
  return { slot, setSlot, filter, setFilter, q, setQ, preview, setPreview, entries, current, shown, step, pick };
}
export type SkinPick = ReturnType<typeof useSkinPick>;

/** 작은 방 — 보일 때 한 번 그린다(스킨 74개를 한꺼번에 안 그리게) */
function MiniRoom({ name }: { name: string }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const draw = () => {
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const room = withLounge(SAMPLE, [], {});
      const { W, H } = roomSize(room);
      c.width = W; c.height = H;
      drawRoom(ctx, room, skinOf(name), 0, {});
    };
    if (typeof IntersectionObserver !== 'function') { draw(); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { draw(); io.disconnect(); } });
    io.observe(c);
    return () => io.disconnect();
  }, [name]);
  return <canvas ref={cv} className="m-skin-mini" />;
}

/** 자리 대표 그림 — 스킨은 지금 방, 장식은 그 자리에서 가진 첫 아이템(없으면 도감 첫 아이템을 흐리게) */
function SlotPic({ k, v }: { k: EquipKind; v: PhoneGachaView }) {
  if (k === 'skin') return <MiniRoom name={(v.equip.skin ?? 'skin.wood').slice(5)} />;
  const first = CATALOG.find((c) => c.kind === k && v.owned[c.id]) ?? CATALOG.find((c) => c.kind === k);
  return first ? <ItemIcon id={first.id} locked={!v.owned[first.id]} big /> : null;
}

/** 스킨·장식 칸 — 인벤토리 가방(시안 office-fit v2 G1, 2026-10-24 사용자). 위 자리 슬롯은 그림만, 4줄 격자 칸(등급 빛·NEW·×n·장착 중 점),
 *  고르면 방에 바로 입혀 보고 바닥 줄 '장착'. 장착되면 onEquipped(방에 반짝) */
export function SkinTab({ g, p, dark, onEquipped }: { g: PhoneGachaState; p: SkinPick; dark: boolean; onEquipped?: () => void }) {
  const v = g.view;
  if (!v) return <p className="m-muted m-sm m-gacha-wait">{g.err ?? `${machine()}에서 가진 것을 받는 중…`}</p>;
  const id = p.shown;
  const it = id && id !== 'skin.wood' ? itemOf(id) : undefined;
  const fresh = new Set(v.fresh);
  const worn = v.equip[p.slot] ?? baseOf(p.slot);
  const changed = !!p.preview && p.preview.slot === p.slot;
  const apply = async () => { if (!p.preview) return; const r = await g.equip(p.preview.slot, p.preview.id); if (r?.ok) { p.setPreview(null); onEquipped?.(); } };
  const label = (e: string | null) => (e === 'skin.wood' ? '나무' : e ? shortName(e) || e : '없음');
  return (
    <div className="m-g1">
      <div className="m-g1-slots" role="tablist" aria-label="꾸밀 자리">
        {PHONE_SLOTS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === p.slot} className={k === p.slot ? 'm-g1-slot m-on' : 'm-g1-slot'} onClick={() => p.setSlot(k)} aria-label={SLOT_NAME.get(k)} title={SLOT_NAME.get(k)}>
            <SlotPic k={k} v={v} />
          </button>
        ))}
      </div>
      <div className="m-g1-sub"><b>{SLOT_NAME.get(p.slot)}</b><span>{p.entries.length}칸</span></div>
      {p.entries.length === 0 && <p className="m-muted m-sm m-g1-none">아직 없어 — 뽑기에서 나와</p>}
      <div className="m-g1-grid">
        {p.entries.map((e) => {
          const r = e && e !== 'skin.wood' ? itemOf(e)?.rarity : undefined;
          return (
            <button key={e ?? 'none'} type="button" className={`m-g1-cell${r ? ` r-${r}` : ''}${e === id ? ' m-on' : ''}${e === worn ? ' m-worn' : ''}`} onClick={() => p.pick(e)} aria-label={label(e)} aria-pressed={e === id}>
              {p.slot === 'skin' ? <MiniRoom name={(e ?? 'skin.wood').slice(5)} /> : e ? <ItemIcon id={e} big /> : <span className="m-skin-none" aria-hidden />}
              {e && fresh.has(e) && <i className="m-g-new">NEW</i>}
              {e && (v.owned[e] ?? 0) > 1 && <i className="m-g-cnt">×{v.owned[e]}</i>}
            </button>
          );
        })}
      </div>
      <div className="m-g-foot">
        <span className="m-g-name">
          <b>{label(id)}</b>
          {it && <em className={`m-g-r r-${it.rarity}`}>{rarityLabel(it.rarity)}</em>}
          {id && <Stars count={v.owned[id] ?? 0} />}
          {id === 'skin.wood' && dark && <small>밤엔 네온</small>}
        </span>
        <button type="button" className="m-g-undo" disabled={!changed} onClick={() => p.setPreview(null)} aria-label="되돌리기" title="되돌리기"><IconReplay /></button>
        <button type="button" className="m-g-equip" disabled={!changed || g.stalled} onClick={() => void apply()}>{changed ? '장착' : '장착 중'}</button>
      </div>
      {g.err && <p className="m-gacha-err">{g.err}</p>}
    </div>
  );
}
