import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CATALOG, COIN_LIMITS, COIN_RULES, EVENTS, itemOf, liveEvent, PITY, PRICE, PRICE_TEN, rarityLabel, type GachaFile, type ItemKind, type PullResult, type Rarity } from '../../domain/gacha';
import { tr } from '../../i18n';
import { IconSkip } from '../Icons';
import { brush } from '../office/draw';
import { SubHead } from '../office/OfficeMenu';
import { drawItem, scaled } from './icons';
import { newShow, skipShow, type Show } from './machine';
import { useMachineLoop } from './MachineCanvas';
import '../office/office2.css';
import './parts.css';
import { Stars } from './Stars';

const RARITY: Rarity[] = ['흔함', '보통', '희귀', '전설'];
const SHELF = 10;
const RATE: Record<Rarity, string> = { 흔함: '60%', 보통: '28%', 희귀: '10%', 전설: '2%' };
const short = (name: string) => name.replace(/^.* — /, '');
const until = (ev: keyof typeof EVENTS) => { const d = new Date(EVENTS[ev].until); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** 작은 아이콘(최근·도감·가구 목록). locked = 실루엣 */
export function ItemIcon({ id, locked, big, size, bob }: { id: string; locked?: boolean; big?: boolean; /** 가로 크기(px) — 진열대·명단 */ size?: number; /** 캐릭터가 까딱인다 */ bob?: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = cv.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 28, 24);
    const b = brush(ctx);
    drawItem(scaled(locked ? { rect: (x, y, w, h) => b.rect(x, y, w, h, '#3a3350') } : b, 2, 3, 1), id);
  }, [id, locked]);
  return <canvas ref={cv} width={28} height={24} className={`gacha-icon ${big ? 'big' : ''} ${bob ? 'bob' : ''}`} style={size ? { width: size, height: (size * 24) / 28 } : undefined} />;
}

/** 코인 버는 법(폰 뽑기 탭도) — 숫자는 domain/gacha COIN_RULES(계산과 같은 값, 테스트로 묶음). 못 뽑을 땐 펼쳐서 위에, 뽑을 수 있으면 접어서 */
export function HowToEarn({ open }: { open: boolean }) {
  return (
    <details className="gacha-how" open={open}>
      <summary>{tr('코인 버는 법', 'How to earn coins')}</summary>
      <ul>{COIN_RULES.map(([n, what]) => <li key={n}><b>{n}</b><span>{what}</span></li>)}</ul>
      <div className="dim">{COIN_LIMITS.map((x) => <span key={x}>{x}</span>)}</div>
    </details>
  );
}

const HAVE: [ItemKind, string][] = [['chr', tr('캐릭터', 'Characters')], ['furn', tr('가구', 'Furniture')], ['floor', tr('바닥 장식', 'Floor')], ['wall', tr('벽 장식', 'Wall')]];
const haveOf = (f: GachaFile, k: ItemKind) => { const all = CATALOG.filter((c) => c.kind === k && !c.limited); return [all.filter((c) => (f.owned[c.id] ?? 0) > 0).length, all.length] as const; };

/** 지난번 뽑은 것 — 창을 열면 선반이 비어 있지 않게. 새로 뽑으면 그 판으로 바뀐다 */
const recentShelf = (f: GachaFile): PullResult[] => [...f.history].reverse().slice(0, SHELF).flatMap((h) => {
  const it = itemOf(h.id);
  return it ? [{ id: h.id, rarity: it.rarity, name: it.name, dup: true, refund: 0, star: 0, up: false }] : [];
});

/** 선반 한 칸 — 캐릭터는 까딱이며 서 있고 가구·장식은 놓여 있다. 중복은 그 자리에서 별이 오르고 환급이 뜬다 */
function ShelfCell({ r, i, owned, fresh }: { r?: PullResult; i: number; owned: number; fresh: boolean }) {
  return (
    <div className={`a1-cell ${fresh && r ? 'v-popin' : ''}`} data-r={r?.rarity} style={fresh && r ? { animationDelay: `${i * 60}ms` } : undefined}>
      <div className="a1-spot">{r && <><i className="a1-ped" /><ItemIcon id={r.id} bob={r.id.startsWith('chr.')} /></>}</div>
      <div className="a1-label">
        <div className="a1-name">{r ? short(r.name) : ' '}</div>
        <div className="a1-meta">{r && (r.dup ? <><Stars count={owned} up={r.up} />{r.refund > 0 && <em>+{r.refund}</em>}</> : <span className="gacha-new">NEW</span>)}</div>
      </div>
    </div>
  );
}

/**
 * 뽑기 화면(사무실 칸 안, 시안 office-v2 ①A 진열대) — 왼쪽 캡슐 머신·버튼·전설까지·확률, 오른쪽 이번 판 선반. 도감은 따로(DexView).
 * 결과는 누르는 순간 저장되지만(연출 중 꺼도 안 잃음) 화면의 기록·천장은 연출이 끝나 선반에 올라올 때 바뀐다(사용자 2026-09-27).
 * 연출 중 기계를 누르면 바로 결과(2026-10-04 QA 5번)
 */
export function GachaPage({ file, draw, onClose, nav }: { file: GachaFile | null; draw: (n: 1 | 10) => Promise<PullResult[] | null>; onClose: () => void; nav?: ReactNode }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const show = useRef<Show | null>(null);
  /** 누른 순간부터 — draw 를 기다리는 사이 또 눌러 두 번 뽑히지 않게 */
  const busy = useRef(false);
  const [rs, setRs] = useState<PullResult[] | null>(null);
  const [playing, setPlaying] = useState(false);
  /** 연출 중엔 뽑기 전 상태(코인만 뺀 것)를 보여 준다 */
  const [frozen, setFrozen] = useState<GachaFile | null>(null);
  const view = frozen ?? file;

  useMachineLoop(cv, show);

  const go = async (n: 1 | 10) => {
    if (busy.current || !file) return;
    busy.current = true;
    const before = file;
    const got = await draw(n).catch(() => null);
    if (!got) { busy.current = false; return; }
    setFrozen({ ...before, coins: before.coins - (n === 10 ? PRICE_TEN : PRICE) });
    setPlaying(true);
    show.current = newShow(n === 10 ? 'ten' : 'one', got.map((r) => ({ id: r.id, rarity: r.rarity })), () => {
      setRs(got);
      setPlaying(false);
      setFrozen(null);
      busy.current = false;
    });
  };
  const skip = () => { if (playing && show.current) skipShow(show.current, performance.now()); };

  const coins = view?.coins ?? 0;
  const pity = view?.pity ?? 0;
  const short1 = coins < PRICE;
  const price = (cost: number) => (coins >= cost ? tr(`코인 ${cost}`, `${cost} coins`) : tr(`코인 ${cost - coins} 모자라`, `${cost - coins} coins short`));
  const owned = (id: string) => view?.owned[id] ?? 0;
  // 한정 이벤트(할로윈) — 기간 중에만 줄이 보인다. 시각은 이 기기 기준
  const ev = liveEvent(Date.now());
  const shelf = rs ?? (view ? recentShelf(view) : []);
  const sum = !rs
    ? tr('최근 뽑은 것', 'Recent pulls')
    : rs.length === 1
      ? (rs[0]!.dup ? tr(`별 ${rs[0]!.up ? '+1' : '그대로'} · 코인 +${rs[0]!.refund}`, `Stars ${rs[0]!.up ? '+1' : 'same'} · +${rs[0]!.refund} coins`) : tr('새것 1', '1 new'))
      : tr(`새것 ${rs.filter((x) => !x.dup).length} · 별 ${rs.filter((x) => x.up).length} · 코인 +${rs.reduce((n, x) => n + x.refund, 0)}`, `New ${rs.filter((x) => !x.dup).length} · stars ${rs.filter((x) => x.up).length} · +${rs.reduce((n, x) => n + x.refund, 0)} coins`);

  return (
    <div className="office-sub gacha a1">
      <SubHead onClose={onClose} title={tr('뽑기', 'Gacha')} nav={nav} coins={coins} />
      <div className="a1-body">
        <div className="a1-left">
          <div className={`a1-mach ${playing ? 'skippable' : ''}`} onClick={skip}>
            <canvas ref={cv} className="mach" width={220} height={184} />
            {playing && <button className="gacha-skip" onClick={(e) => { e.stopPropagation(); skip(); }} aria-label={tr('건너뛰기', 'Skip')} title={tr('건너뛰기', 'Skip')}><IconSkip /></button>}
          </div>
          <div className="a1-btns">
            <button className="gacha-btn" disabled={playing || coins < PRICE} onClick={() => void go(1)}>{tr('1번 뽑기', 'Pull 1')}<small>{price(PRICE)}</small></button>
            <button className="gacha-btn ten" disabled={playing || coins < PRICE_TEN} onClick={() => void go(10)}>{tr('10번 뽑기', 'Pull 10')}<small>{coins >= PRICE_TEN ? tr(`코인 ${PRICE_TEN} · 희귀 이상 1개`, `${PRICE_TEN} coins · 1 Rare+`) : price(PRICE_TEN)}</small></button>
          </div>
          <div className="v-pity"><span>{tr('전설까지', 'Until Legendary')}</span><div className="gacha-bar"><i style={{ width: `${(pity / PITY) * 100}%` }} /></div><span>{pity} / {PITY}</span></div>
          <div className="v-rates">{RARITY.map((r) => <span key={r}><b className={`r-${r}`}>{rarityLabel(r)}</b> {RATE[r]}</span>)}</div>
          {ev && <div className="v-event"><b>{tr(EVENTS[ev].ko, EVENTS[ev].en)}</b>{tr(`${until(ev)}까지 · 뽑을 때 ${Math.round(EVENTS[ev].share * 100)}%`, `Until ${until(ev)} · ${Math.round(EVENTS[ev].share * 100)}% of pulls`)}</div>}
          <HowToEarn open={short1 && !playing} />
        </div>
        <div className="a1-right">
          <div className="a1-sum"><b>{sum}</b></div>
          <div className="a1-shelves">
            {[0, 1].map((row) => (
              <div key={row} className="a1-row">
                {Array.from({ length: 5 }, (_, k) => { const i = row * 5 + k, r = shelf[i]; return <ShelfCell key={`${i}-${r?.id ?? ''}`} r={r} i={i} owned={r ? owned(r.id) : 0} fresh={!!rs} />; })}
              </div>
            ))}
          </div>
          {view && <div className="v-have">{HAVE.map(([k, name]) => { const [n, all] = haveOf(view, k); return <span key={k}>{name} <b>{n}</b>/{all}</span>; })}</div>}
        </div>
      </div>
    </div>
  );
}
