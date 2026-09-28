import { useEffect, useRef, useState } from 'react';
import { itemOf, PITY, PRICE, PRICE_TEN, rarityLabel, type GachaFile, type PullResult, type Rarity } from '../../domain/gacha';
import { tr } from '../../i18n';
import { brush } from '../office/draw';
import { SubHead } from '../office/OfficeMenu';
import { drawItem, scaled } from './icons';
import { drawMachine, drawTen, newShow, stepParts, type Show } from './machine';

const RARITY: Rarity[] = ['흔함', '보통', '희귀', '전설'];
const RATE: Record<Rarity, string> = { 흔함: '60%', 보통: '28%', 희귀: '10%', 전설: '2%' };

/** 작은 아이콘(최근·도감·가구 목록). locked = 실루엣 */
export function ItemIcon({ id, locked, big }: { id: string; locked?: boolean; big?: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = cv.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 28, 24);
    const b = brush(ctx);
    drawItem(scaled(locked ? { rect: (x, y, w, h) => b.rect(x, y, w, h, '#3a3350') } : b, 2, 3, 1), id);
  }, [id, locked]);
  return <canvas ref={cv} width={28} height={24} className={`gacha-icon ${big ? 'big' : ''}`} />;
}

type Card = { kind: 'one'; r: PullResult } | { kind: 'ten'; rs: PullResult[] };

/**
 * 뽑기 화면(사무실 칸 안) — 캡슐 머신 + 코인·뽑기·천장·확률·최근. 도감은 따로(DexView).
 * 결과는 누르는 순간 저장되지만(연출 중 꺼도 안 잃음) 화면의 기록·천장은 연출이 끝나 카드가 뜰 때 바뀐다(사용자 2026-09-27)
 */
export function GachaPage({ file, draw, onClose }: { file: GachaFile | null; draw: (n: 1 | 10) => Promise<PullResult[] | null>; onClose: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const show = useRef<Show | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [playing, setPlaying] = useState(false);
  /** 연출 중엔 뽑기 전 상태(코인만 뺀 것)를 보여 준다 */
  const [frozen, setFrozen] = useState<GachaFile | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [scale, setScale] = useState(2);
  const [ten, setTen] = useState(false);
  const W = ten ? 300 : 220, H = ten ? 120 : 184;
  const view = frozen ?? file;

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => setScale(Math.max(1, Math.floor(Math.min((el.clientWidth - 24) / W, (el.clientHeight - 24) / H))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  useEffect(() => {
    const c = cv.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const b = brush(ctx);
    let id = 0;
    const loop = (now: number) => {
      const s = show.current;
      const w = s?.kind === 'ten' ? 300 : 220, h = s?.kind === 'ten' ? 120 : 184;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      ctx.clearRect(0, 0, w, h);
      if (s?.kind === 'ten') drawTen(b, w, h, s, now); else drawMachine(b, w, h, s, now);
      if (s) stepParts(b, s.parts);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);

  const go = async (n: 1 | 10) => {
    if (playing || !file) return;
    setMsg(null);
    const before = file;
    const rs = await draw(n);
    if (!rs) { setMsg(tr(`코인이 모자라 — ${n === 10 ? PRICE_TEN : PRICE} 필요`, `Not enough coins — need ${n === 10 ? PRICE_TEN : PRICE}`)); return; }
    setFrozen({ ...before, coins: before.coins - (n === 10 ? PRICE_TEN : PRICE) });
    setCard(null);
    setPlaying(true);
    setTen(n === 10);
    show.current = newShow(n === 10 ? 'ten' : 'one', rs.map((r) => ({ id: r.id, rarity: r.rarity })), () => {
      setCard(n === 10 ? { kind: 'ten', rs } : { kind: 'one', r: rs[0]! });
      setPlaying(false);
      setFrozen(null);
    });
  };

  const coins = view?.coins ?? 0;
  const pity = view?.pity ?? 0;
  const recent = [...(view?.history ?? [])].reverse().slice(0, 10);
  const count = (rs: PullResult[], r: Rarity) => rs.filter((x) => x.rarity === r).length;

  return (
    <div className="office-sub gacha">
      <SubHead onClose={onClose} title={tr('뽑기', 'Gacha')} coins={coins} />
      <div className="gacha-body">
        <div className="gacha-stage" ref={stage}>
          <div className="gacha-canvas" style={{ width: W * scale, height: H * scale }}>
            <canvas ref={cv} style={{ width: W * scale, height: H * scale }} />
            {card?.kind === 'one' && (
              <div className="gacha-card on">
                <span className={`gacha-r r-${card.r.rarity}`}>{rarityLabel(card.r.rarity)}</span>
                <span className="gacha-name">{card.r.name}</span>
                <span className="gacha-new">{card.r.dup ? tr(`중복 — 코인 +${card.r.refund} · 조각 +1`, `Duplicate — +${card.r.refund} coins · +1 shard`) : tr('NEW! — 도감에 들어갔어', 'NEW! — added to your collection')}</span>
              </div>
            )}
            {card?.kind === 'ten' && (
              <div className="gacha-card on top">
                <span className="gacha-r r-ten">{tr('10번 뽑기', '10x pull')}</span>
                <span className="gacha-name">{RARITY.map((r) => `${rarityLabel(r)} ${count(card.rs, r)}`).join(' · ')}</span>
                <span className="gacha-new">{tr('새것', 'New')} {card.rs.filter((x) => !x.dup).length} · {tr('중복', 'Dupes')} {card.rs.filter((x) => x.dup).length}({tr('코인', 'coins')} +{card.rs.reduce((n, x) => n + x.refund, 0)})</span>
              </div>
            )}
          </div>
        </div>
        <aside className="gacha-side">
          <button className="gacha-btn" disabled={playing || coins < PRICE} onClick={() => void go(1)}>{tr('1번 뽑기', 'Pull 1')}<small>{tr('코인', 'Coins')} {PRICE}</small></button>
          <button className="gacha-btn ten" disabled={playing || coins < PRICE_TEN} onClick={() => void go(10)}>{tr('10번 뽑기', 'Pull 10')}<small>{tr(`코인 ${PRICE_TEN} · 희귀 이상 1개 보장`, `Coins ${PRICE_TEN} · 1 Rare or better guaranteed`)}</small></button>
          {msg && <div className="gacha-msg">{msg}</div>}
          {card?.kind === 'ten' && (
            <div className="gacha-list">
              {card.rs.map((r, i) => <span key={i} className={`r-${r.rarity}`}>{r.name.replace(/^.* — /, '')}{r.dup ? '' : ' · NEW'}</span>)}
            </div>
          )}
          <section>
            <h4>{tr('전설까지', 'Until Legendary')}</h4>
            <div className="gacha-bar"><i style={{ width: `${(pity / PITY) * 100}%` }} /></div>
            <div className="dim">{pity} / {PITY} — {tr(`${PITY - pity}번 안에 전설 보장`, `Legendary guaranteed within ${PITY - pity} pulls`)}</div>
          </section>
          <section>
            <h4>{tr('확률', 'Odds')}</h4>
            <div className="gacha-rates">{RARITY.map((r) => <span key={r}><b className={`r-${r}`}>{rarityLabel(r)}</b> {RATE[r]}</span>)}</div>
          </section>
          {recent.length > 0 && (
            <section>
              <h4>{tr('최근 뽑은 것', 'Recent pulls')}</h4>
              <div className="gacha-recent">{recent.map((h, i) => <span key={i} title={itemOf(h.id)?.name}><ItemIcon id={h.id} /></span>)}</div>
            </section>
          )}
          <section className="dim gacha-how">{tr('코인: 머지 10 · 시킨 일 끝남 3 · CI 통과 2 · 테스트 커밋 2 · 300줄 이하 커밋 1', 'Coins: merge 10 · task done 3 · CI pass 2 · commit with tests 2 · commit under 300 lines 1')}{view?.shards ? tr(` · 조각 ${view.shards}`, ` · shards ${view.shards}`) : ''}</section>
        </aside>
      </div>
    </div>
  );
}
