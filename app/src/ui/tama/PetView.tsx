// 참모 대시보드의 '펫' 탭 — 참모가 키우는 펫(시안 docs/design-drafts/tama-v2 v1 B, 2026-10-03 사용자 확정).
// 둘레는 앱 무채색, 초록은 LCD 화면 안에만. 지금 애 · 오늘 먹은 것(= 오늘 끝낸 일) · 도감/업적/보관함/무덤 탭
import { useEffect, useState } from 'react';
import { BADGES } from '../../domain/tama/badges';
import { fullness, type TamaEvent } from '../../domain/tama/pet';
import { todayFed } from '../../domain/tama/signals';
import { isFinal, RETIRE_AFTER } from '../../domain/tama/lineage';
import { archive, BOX_SIZE, fuse, restart, retire, retrieve, type TamaFile } from '../../domain/tama/store';
import { fuseTarget, nameOf, stageOf, type Egg, type Slot } from '../../domain/tama/tree';
import { getLang, tr } from '../../i18n';
import { OrchAvatar } from '../avatar/OrchAvatar';
import { IconBox } from '../Icons';
import { OfficeModal, type ShopView } from '../office/OfficeMenu';
import { EGGS, eggName, STAGES } from './labels';
import { DiaryTab } from './DiaryTab';
import { LineageTab, QuirkChips } from './LineageTab';
import { MonsterNow, MonsterTab } from './MonsterTab';
import { spriteOf } from './lcd';
import { Sprite as Lcd } from './Sprite';
import './pet.css';

const SLOTS: Slot[] = ['egg', 'i1', 'i2', 'r1', 'r2', 'cG', 'cD', 'cA', 'cT', 'cM', 'cS', 'cN', 'cX', 'p1', 'p2', 'p3', 'm1', 'm2'];
const FUSED: [Slot, Egg][] = [['jA', 'fire'], ['jB', 'leaf']];
const TOTAL = EGGS.length * SLOTS.length + FUSED.length;
const day = (t: number) => new Date(t).toLocaleDateString(getLang() === 'en' ? 'en-US' : 'ko-KR', { month: 'numeric', day: 'numeric' });
const hhmm = (t: number) => new Date(t).toTimeString().slice(0, 5);
const when = (t: number) => `${day(t)} ${hhmm(t)}`;

/** 먹이 종류 이름 — 오늘 먹은 것 줄의 작은 알약 */
const KIND: Record<TamaEvent['type'], () => string> = {
  commit: () => tr('커밋', 'Commit'), pr: () => tr('PR 머지', 'PR merge'), task: () => tr('시킨 일', 'Task'), ci: () => 'CI',
  work: () => tr('일한 시간', 'Work'), show: () => tr('결과물', 'Result'), talk: () => tr('대화', 'Talk'),
  routine: () => tr('예약', 'Schedule'), doc: () => tr('문서', 'Doc'), review: () => tr('시안 검토', 'Review'), slay: () => tr('몬스터 처치', 'Monster beaten'),
};
const MAX_ROWS = 12;

const Sprite = ({ egg, slot, size }: { egg: Egg; slot: Slot; size: number }) => <Lcd name={spriteOf(egg, slot)} size={size} />;

function Stat({ name, value, max, text }: { name: string; value: number; max: number; text: string }) {
  return (
    <div className="pv-stat"><span>{name}</span><i><b style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%` }} /></i><em>{text}</em></div>
  );
}

type Tab = 'diary' | 'dex' | 'lineage' | 'monsters' | 'badges' | 'box' | 'graves';
type Props = {
  file: TamaFile | null;
  apply: (op: (f: TamaFile, now: number) => TamaFile | null) => Promise<boolean>;
  feed: TamaEvent[];
  /** 먹인 세션 id → 참모(이름·색). 참모가 아니면 null */
  who: (id: string) => { name: string; color: string } | null;
  coins?: number;
  /** 상점 창(뽑기·도감·스킨) — 펫 탭 안 창으로 띄운다(채팅 뷰에서 눌러도 뷰가 안 바뀌게, 2026-10-03 사용자). 없으면 코인 버튼 숨김 */
  shop?: (view: ShopView, onView: (v: ShopView) => void, close: () => void) => React.ReactNode;
};

export function PetView({ file, apply, feed, who, coins, shop }: Props) {
  const [picked, setTab] = useState<Tab | null>(null); // 처음엔 일기가 있으면 일기, 없으면 진화
  const [shopView, setShopView] = useState<ShopView | null>(null);
  const [sure, setSure] = useState(false); // 처음부터: 두 번 눌러야
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 4000); return () => clearTimeout(t); }, [sure]);
  if (!file) return <div className="pv-blank">{tr('불러오는 중…', 'Loading…')}</div>;
  const pet = file.pet && !file.pet.dead ? file.pet : null;
  const seen = new Set(file.dex);
  const act = async (op: (f: TamaFile, now: number) => TamaFile | null, fail: string) => setMsg((await apply(op)) ? null : fail);
  const today = todayFed(feed, Date.now());
  const badges = file.badges ?? {};
  const lineage = file.lineage ?? [];
  const diary = file.diary ?? [];
  const tab: Tab = picked ?? (diary.length ? 'diary' : 'dex');
  const slain = (file.monsters?.log ?? []).filter((l) => !l.fled).length;
  const seenCount = new Set(file.dex.map((d) => (d.endsWith('.jA') || d.endsWith('.jB') ? d.slice(-2) : d))).size;
  const tabs: [Tab, string][] = [
    ['diary', tr(`일기 ${diary.length}`, `Diary ${diary.length}`)],
    ['dex', tr(`진화 ${seenCount}/${TOTAL}`, `Evolutions ${seenCount}/${TOTAL}`)], // 뽑기 '도감'과 이름이 겹치지 않게(2026-10-04 QA 3번)
    ['lineage', tr(`혈통 ${lineage.length + 1}대`, `Lineage · Gen ${lineage.length + 1}`)],
    ['monsters', tr(`몬스터 ${slain}`, `Monsters ${slain}`)],
    ['badges', tr(`업적 ${Object.keys(badges).length}/${BADGES.length}`, `Badges ${Object.keys(badges).length}/${BADGES.length}`)],
    ['box', tr(`보관함 ${file.box.length}/${BOX_SIZE}`, `Storage ${file.box.length}/${BOX_SIZE}`)],
    ['graves', tr(`무덤 ${file.graves.length}`, `Graves ${file.graves.length}`)],
  ];

  return (
    <div className="pv">
      <section className="pv-now">
        {pet ? <Sprite egg={pet.egg} slot={pet.slot} size={120} /> : <div className="pv-lcd pv-empty" />}
        <div className="pv-info">
          {pet ? (
            <>
              <div className="pv-name"><b>{nameOf(pet.egg, pet.slot)}</b><span>{tr(`${lineage.length + 1}대`, `Gen ${lineage.length + 1}`)} · {STAGES[stageOf(pet.slot)]} · {tr(`${Math.floor((Date.now() - pet.bornAt) / 86_400_000) + 1}일째`, `Day ${Math.floor((Date.now() - pet.bornAt) / 86_400_000) + 1}`)}</span></div>
              <QuirkChips quirks={pet.quirks ?? []} />
              <Stat name={tr('배', 'Belly')} value={fullness(pet)} max={4} text={`${fullness(pet)}/4`} />
              <Stat name={tr('훈련', 'Training')} value={pet.c.training} max={16} text={String(pet.c.training)} />
              <Stat name={tr('배틀', 'Battles')} value={pet.c.wins} max={Math.max(15, pet.c.battles)} text={`${pet.c.wins}/${pet.c.battles}`} />
              <Stat name={tr('실수', 'Mistakes')} value={pet.c.mistakes} max={5} text={String(pet.c.mistakes)} />
              {isFinal(pet.slot) && (
                <div className="pv-retire">
                  <button className="btn" onClick={() => void act(retire, tr('은퇴시키지 못했어', 'Could not retire'))}>{tr('은퇴', 'Retire')}</button>
                  <span>{pet.peakAt !== undefined ? tr(`${when(pet.peakAt + RETIRE_AFTER)} 저절로 은퇴 — 다음 알이 버릇을 물려받아`, `Retires on its own ${when(pet.peakAt + RETIRE_AFTER)} — the next egg inherits a habit`) : tr('은퇴하면 다음 알이 버릇을 물려받아', 'Retire it and the next egg inherits a habit')}</span>
                </div>
              )}
              {pet.sick && <span className="pv-warn">{tr('아파 — 먹이 세 번이 약', 'Sick — three feedings cure it')}</span>}
            </>
          ) : (
            <div className="pv-name"><b>{file.pet?.dead ? tr(`${nameOf(file.pet.egg, file.pet.dead.slot)} — 떠났어`, `${nameOf(file.pet.egg, file.pet.dead.slot)} has left`) : tr('키우는 애가 없어', 'No pet')}</b><span>{tr('위젯에서 알을 골라줘', 'Pick an egg in the widget')}</span></div>
          )}
        </div>
        <div className="pv-acts">
          {pet && (
            <button className="pv-ic" disabled={file.box.length >= BOX_SIZE} onClick={() => void act(archive, tr('보관함이 꽉 찼어', 'Storage is full'))} aria-label={tr('보관함에 넣기', 'Put in storage')} title={tr('보관함에 넣기 — 넣어 둔 동안 시간이 멈춰', 'Put in storage — time stops while stored')}><IconBox /></button>
          )}
          {coins !== undefined && shop && <button className="pv-coin" onClick={() => setShopView('gacha')} aria-label={tr(`코인 ${coins} — 뽑기`, `${coins} coins — gacha`)} title={tr('먹은 일만큼 쌓인 코인 — 뽑기·도감·스킨', 'Coins from what it ate — gacha, collection, skins')}><i />{coins.toLocaleString()}</button>}
        </div>
      </section>
      {msg && <div className="banner">{msg}</div>}
      <MonsterNow monsters={file.monsters} now={Date.now()} />

      <section className="pv-fed">
        <div className="pv-h">{tr('오늘 먹은 것', 'Fed today')}<span>{today.length}</span></div>
        {today.length === 0 ? <div className="pv-blank">{tr('아직 — 일이 끝나면 먹어', 'Nothing yet — it eats when work gets done')}</div> : (
          <ul>
            {today.slice(0, MAX_ROWS).map((e, i) => {
              const o = e.by ? who(e.by) : null;
              return (
                <li key={`${e.t}:${i}`}>
                  <time>{hhmm(e.t)}</time>
                  <span className="pv-by">{o && <OrchAvatar name={o.name} size={16} state="rest" color={o.color} label={o.name} />}</span>
                  <span className="pv-what">{e.label ?? KIND[e.type]()}</span>
                  <em>{KIND[e.type]()}</em>
                </li>
              );
            })}
            {today.length > MAX_ROWS && <li className="pv-more">{tr(`그 밖 ${today.length - MAX_ROWS}개`, `${today.length - MAX_ROWS} more`)}</li>}
          </ul>
        )}
      </section>

      <div className="pv-tabs" role="tablist">
        {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
      </div>

      {tab === 'diary' && <DiaryTab diary={diary} />}

      {tab === 'dex' && (
        <div className="pv-dex">
          {EGGS.map(([egg, name]) => (
            <div key={egg} className="pv-line">
              <span className="pv-line-name">{name}</span>
              <div className="pv-cells">
                {SLOTS.map((s) => (seen.has(`${egg}.${s}`)
                  ? <span key={s} className="pv-cell" title={`${nameOf(egg, s)} · ${STAGES[stageOf(s)]}`}><Sprite egg={egg} slot={s} size={36} /></span>
                  : <span key={s} className="pv-cell off" title={STAGES[stageOf(s)]} />))}
              </div>
            </div>
          ))}
          <div className="pv-line">
            <span className="pv-line-name">{tr('합체', 'Fusion')}</span>
            <div className="pv-cells">
              {FUSED.map(([s, egg]) => (file.dex.some((d) => d.endsWith(`.${s}`))
                ? <span key={s} className="pv-cell" title={nameOf(egg, s)}><Sprite egg={egg} slot={s} size={36} /></span>
                : <span key={s} className="pv-cell off" title={tr('보관함의 짝 완전체와 합체', 'Fuse with a matching Perfect in storage')} />))}
            </div>
          </div>
        </div>
      )}

      {tab === 'lineage' && <LineageTab lineage={lineage} pet={pet} heir={file.heir ?? []} />}

      {tab === 'monsters' && <MonsterTab monsters={file.monsters} />}

      {tab === 'badges' && (
        <div className="pv-badges">
          {BADGES.map((b) => <span key={b.id} className={`pv-badge ${badges[b.id] ? 'got' : ''}`} title={badges[b.id] ? tr(`${b.hint} · ${day(badges[b.id]!)}`, `${b.hint} · ${day(badges[b.id]!)}`) : b.hint}>{b.name}</span>)}
        </div>
      )}

      {tab === 'box' && (
        <div className="pv-box">
          {Array.from({ length: BOX_SIZE }, (_, i) => file.box[i]).map((b, i) =>
            b ? (
              <div key={i} className="pv-slot">
                <Sprite egg={b.egg} slot={b.slot} size={48} />
                <div className="pv-name"><b>{nameOf(b.egg, b.slot)}</b><span>{STAGES[stageOf(b.slot)]} · {day(b.boxedAt)}</span></div>
                {pet && fuseTarget(pet, b) && <button className="btn pri" onClick={() => void act((f, now) => fuse(f, i, now), tr('합체하지 못했어', 'Could not fuse'))}>{tr('합체', 'Fuse')}</button>}
                <button className="btn" onClick={() => void act((f, now) => retrieve(f, i, now), tr('꺼내지 못했어', 'Could not take it out'))}>{pet ? tr('바꾸기', 'Swap') : tr('꺼내기', 'Take out')}</button>
              </div>
            ) : <div key={i} className="pv-slot off" />,
          )}
        </div>
      )}

      {tab === 'graves' && (
        file.graves.length === 0 ? <div className="pv-blank">{tr('없어', 'None')}</div> : (
          <ul className="pv-graves">
            {[...file.graves].reverse().map((g, i) => (
              <li key={i}><b>{nameOf(g.egg, g.slot)}</b><span>{eggName(g.egg)} · {STAGES[stageOf(g.slot)]} · {day(g.bornAt)}~{day(g.diedAt)} · {g.left ? tr('떠나보냄', 'Let go') : tr('4일 무활동', '4 days idle')}</span></li>
            ))}
          </ul>
        )
      )}

      {shopView && shop && <OfficeModal onClose={() => setShopView(null)}>{shop(shopView, setShopView, () => setShopView(null))}</OfficeModal>}
      {pet && (
        <div className="pv-foot">
          <button className={`pv-restart ${sure ? 'sure' : ''}`} onClick={() => (sure ? void act(restart, '').then(() => setSure(false)) : setSure(true))}>
            {sure ? tr('정말 떠나보낼까? 한 번 더', 'Really let it go? Click again') : tr('처음부터', 'Start over')}
          </button>
        </div>
      )}
    </div>
  );
}
