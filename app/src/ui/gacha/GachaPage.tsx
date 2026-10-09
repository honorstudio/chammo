import { useEffect, useRef, useState, type ReactNode } from 'react';
import { COIN_LIMITS, COIN_RULES, itemOf, PITY, PRICE, PRICE_TEN, rarityLabel, type GachaFile, type PullResult, type Rarity } from '../../domain/gacha';
import { tr } from '../../i18n';
import { IconSkip } from '../Icons';
import { brush } from '../office/draw';
import { SubHead } from '../office/OfficeMenu';
import { drawItem, scaled } from './icons';
import { drawMachine, drawTen, idleKey, newShow, skipShow, stepParts, type Show } from './machine';
import { Stars } from './Stars';

const RARITY: Rarity[] = ['흔함', '보통', '희귀', '전설'];
const RATE: Record<Rarity, string> = { 흔함: '60%', 보통: '28%', 희귀: '10%', 전설: '2%' };
const short = (name: string) => name.replace(/^.* — /, '');
/** 결과 카드 자리(styles.css .gacha-card-slot 높이 + 틈) — 카드가 기계 배출구를 덮지 않게 그림 밑에 비워 둔다(상점 QA 8) */
const CARD_ROOM = 104;

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

/** 코인 버는 법 — 숫자는 domain/gacha COIN_RULES(계산과 같은 값, 테스트로 묶음). 못 뽑을 땐 펼쳐서 위에, 뽑을 수 있으면 접어서 */
function HowToEarn({ open }: { open: boolean }) {
  return (
    <details className="gacha-how" open={open}>
      <summary>{tr('코인 버는 법', 'How to earn coins')}</summary>
      <ul>{COIN_RULES.map(([n, what]) => <li key={n}><b>{n}</b><span>{what}</span></li>)}</ul>
      <div className="dim">{COIN_LIMITS.map((x) => <span key={x}>{x}</span>)}</div>
    </details>
  );
}

type Card = { kind: 'one'; r: PullResult } | { kind: 'ten'; rs: PullResult[] };

/**
 * 뽑기 화면(사무실 칸 안) — 캡슐 머신 + 코인·뽑기·천장·확률·최근. 도감은 따로(DexView).
 * 결과는 누르는 순간 저장되지만(연출 중 꺼도 안 잃음) 화면의 기록·천장은 연출이 끝나 카드가 뜰 때 바뀐다(사용자 2026-09-27).
 * 연출 중 무대를 누르면 바로 결과(2026-10-04 QA 5번)
 */
export function GachaPage({ file, draw, onClose, nav }: { file: GachaFile | null; draw: (n: 1 | 10) => Promise<PullResult[] | null>; onClose: () => void; nav?: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const show = useRef<Show | null>(null);
  /** 누른 순간부터 — draw 를 기다리는 사이 또 눌러 두 번 뽑히지 않게 */
  const busy = useRef(false);
  const [card, setCard] = useState<Card | null>(null);
  const [playing, setPlaying] = useState(false);
  /** 연출 중엔 뽑기 전 상태(코인만 뺀 것)를 보여 준다 */
  const [frozen, setFrozen] = useState<GachaFile | null>(null);
  const [scale, setScale] = useState(2);
  const [ten, setTen] = useState(false);
  const W = ten ? 300 : 220, H = ten ? 120 : 184;
  const view = frozen ?? file;

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    // 도트가 고르게 — 화면 화소에 딱 맞는 배율만(레티나면 1.5배 같은 반 단계도 된다)
    const dpr = window.devicePixelRatio || 1;
    const fit = () => setScale(Math.max(1, Math.floor(Math.min((el.clientWidth - 24) / W, (el.clientHeight - 24 - CARD_ROOM) / H) * dpr) / dpr));
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
    /** 기다리는 기계를 마지막에 그린 박자 — 같으면 건너뛴다(상점 QA 19, 연출 중엔 매 프레임) */
    let last = '';
    const loop = (now: number) => {
      id = requestAnimationFrame(loop);
      const s = show.current;
      const w = s?.kind === 'ten' ? 300 : 220, h = s?.kind === 'ten' ? 120 : 184;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; last = ''; }
      if (!s) {
        const k = idleKey(now);
        if (k === last) return;
        last = k;
      }
      ctx.clearRect(0, 0, w, h);
      if (s?.kind === 'ten') drawTen(b, w, h, s, now); else drawMachine(b, w, h, s, now);
      if (s) stepParts(b, s.parts);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);

  const go = async (n: 1 | 10) => {
    if (busy.current || !file) return;
    busy.current = true;
    const before = file;
    const rs = await draw(n).catch(() => null);
    if (!rs) { busy.current = false; return; }
    setFrozen({ ...before, coins: before.coins - (n === 10 ? PRICE_TEN : PRICE) });
    setCard(null);
    setPlaying(true);
    setTen(n === 10);
    show.current = newShow(n === 10 ? 'ten' : 'one', rs.map((r) => ({ id: r.id, rarity: r.rarity })), () => {
      setCard(n === 10 ? { kind: 'ten', rs } : { kind: 'one', r: rs[0]! });
      setPlaying(false);
      setFrozen(null);
      busy.current = false;
    });
  };
  const skip = () => { if (playing && show.current) skipShow(show.current, performance.now()); };

  const coins = view?.coins ?? 0;
  const pity = view?.pity ?? 0;
  const recent = [...(view?.history ?? [])].reverse().slice(0, 10);
  const short1 = coins < PRICE;
  const price = (cost: number) => (coins >= cost ? tr(`코인 ${cost}`, `${cost} coins`) : tr(`코인 ${cost - coins} 모자라`, `${cost - coins} coins short`));
  const owned = (id: string) => view?.owned[id] ?? 0;

  return (
    <div className="office-sub gacha">
      <SubHead onClose={onClose} title={tr('뽑기', 'Gacha')} nav={nav} coins={coins} />
      <div className="gacha-body">
        <div className={`gacha-stage ${playing ? 'skippable' : ''}`} ref={stage} onClick={skip}>
          <div className="gacha-canvas" style={{ width: W * scale, height: H * scale }}>
            <canvas ref={cv} style={{ width: W * scale, height: H * scale }} />
            {playing && <button className="gacha-skip" onClick={(e) => { e.stopPropagation(); skip(); }} aria-label={tr('건너뛰기', 'Skip')} title={tr('건너뛰기', 'Skip')}><IconSkip /></button>}
          </div>
          <div className="gacha-card-slot">
            {card?.kind === 'one' && (
              <div className="gacha-card on">
                <span className={`gacha-r r-${card.r.rarity}`}>{rarityLabel(card.r.rarity)}</span>
                <span className="gacha-name">{short(card.r.name)}</span>
                {card.r.dup
                  ? <span className="gacha-dup"><Stars count={owned(card.r.id)} up={card.r.up} /><em>+{card.r.refund}</em></span>
                  : <span className="gacha-new">NEW</span>}
              </div>
            )}
          </div>
        </div>
        <aside className="gacha-side">
          <button className="gacha-btn" disabled={playing || coins < PRICE} onClick={() => void go(1)}>{tr('1번 뽑기', 'Pull 1')}<small>{price(PRICE)}</small></button>
          <button className="gacha-btn ten" disabled={playing || coins < PRICE_TEN} onClick={() => void go(10)}>{tr('10번 뽑기', 'Pull 10')}<small>{coins >= PRICE_TEN ? tr(`코인 ${PRICE_TEN} · 희귀 이상 1개`, `${PRICE_TEN} coins · 1 Rare+`) : price(PRICE_TEN)}</small></button>
          {short1 && !playing && <HowToEarn open />}
          {card?.kind === 'ten' && (
            <section>
              <h4>{tr(`새것 ${card.rs.filter((x) => !x.dup).length} · 별 ${card.rs.filter((x) => x.up).length} · 코인 +${card.rs.reduce((n, x) => n + x.refund, 0)}`, `New ${card.rs.filter((x) => !x.dup).length} · stars ${card.rs.filter((x) => x.up).length} · +${card.rs.reduce((n, x) => n + x.refund, 0)} coins`)}</h4>
              <ul className="gacha-list">
                {card.rs.map((r, i) => (
                  <li key={i} className={`r-${r.rarity}`}>
                    <span>{short(r.name)}</span>
                    {r.dup ? <Stars count={owned(r.id)} up={r.up} /> : <b>NEW</b>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h4>{tr('전설까지', 'Until Legendary')}</h4>
            <div className="gacha-bar"><i style={{ width: `${(pity / PITY) * 100}%` }} /></div>
            <div className="dim">{pity} / {PITY}</div>
          </section>
          <section>
            <h4>{tr('확률', 'Odds')}</h4>
            <div className="gacha-rates">{RARITY.map((r) => <span key={r}><b className={`r-${r}`}>{rarityLabel(r)}</b> {RATE[r]}</span>)}</div>
          </section>
          {!(short1 && !playing) && <HowToEarn open={false} />}
          {recent.length > 0 && (
            <section>
              <h4>{tr('최근 뽑은 것', 'Recent pulls')}</h4>
              <div className="gacha-recent">{recent.map((h, i) => <span key={i} title={short(itemOf(h.id)?.name ?? '')}><ItemIcon id={h.id} /></span>)}</div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
