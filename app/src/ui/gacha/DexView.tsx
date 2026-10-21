import { useState, type ReactNode } from 'react';
import { dexCatalog, EVENTS, rarityLabel, starTotal, type GachaFile, type Item, type ItemKind } from '../../domain/gacha';
import { tr } from '../../i18n';
import { SubHead } from '../office/OfficeMenu';
import { ItemIcon } from './GachaPage';
import { StarCount, Stars } from './Stars';

const KINDS: [ItemKind | 'all', string][] = [['all', tr('전체', 'All')], ['skin', tr('스킨', 'Skins')], ['furn', tr('가구', 'Furniture')], ['hat', tr('모자', 'Hats')], ['window', tr('창밖', 'Views')], ['fx', tr('이펙트', 'Effects')], ['action', tr('반장 액션', 'Boss moves')], ['friend', tr('펫 친구', 'Pet pals')], ['desk', tr('책상 소품', 'Desk items')], ['title', tr('칭호', 'Titles')], ['light', tr('조명', 'Lighting')]];

/** 도감(사무실 칸 안) — 모은 것·못 모은 것·별 보기만. 처음 얻고 안 눌러 본 건 NEW. 가진 칸을 누르면 꾸미기의 그 종류로 간다(끼우는 곳은 꾸미기 한 곳 — 2026-10-21 사용자 A안) */
export function DexView({ file, onPick, onClose, nav }: { file: GachaFile | null; /** 가진 칸 누름 — NEW 끄고 꾸미기로 */ onPick: (id: string) => void; onClose: () => void; nav?: ReactNode }) {
  const [kind, setKind] = useState<ItemKind | 'all' | 'limited'>('all');
  const owned = file?.owned ?? {};
  // 기간이 지난 한정은 가진 것만 — 못 모으는 칸이 남지 않게(domain/gacha dexCatalog)
  const CATALOG = dexCatalog(owned);
  const inKind = (c: Item, k: ItemKind | 'all' | 'limited') => k === 'all' || (k === 'limited' ? !!c.limited : c.kind === k);
  const kinds: [ItemKind | 'all' | 'limited', string][] = CATALOG.some((c) => c.limited) ? [...KINDS, ['limited', tr('한정', 'Limited')]] : KINDS;
  const fresh = new Set(file?.fresh ?? []);
  const worn = Object.values(file?.equip ?? {});
  // NEW 는 맨 앞 — 새로 뽑은 게 107칸 사이에 묻혀 안 보였다(2026-10-10 사용자)
  const list = CATALOG.filter((c) => inKind(c, kind)).sort((a, b) => Number(fresh.has(b.id)) - Number(fresh.has(a.id)));
  const have = CATALOG.filter((c) => (owned[c.id] ?? 0) > 0).length;
  return (
    <div className="office-sub dex">
      <SubHead onClose={onClose} title={`${tr('도감', 'Collection')} ${have} / ${CATALOG.length}`} nav={nav} right={file && <StarCount {...starTotal(file)} />} coins={file?.coins} />
      <div className="dex-kinds">
        {kinds.map(([k, name]) => {
          const n = CATALOG.filter((c) => inKind(c, k) && (owned[c.id] ?? 0) > 0).length;
          const all = CATALOG.filter((c) => inKind(c, k)).length;
          const isNew = CATALOG.some((c) => inKind(c, k) && fresh.has(c.id));
          return <button key={k} className={`${k === kind ? 'on' : ''} ${isNew ? 'has-new' : ''}`} onClick={() => setKind(k)}>{name} <span>{n}/{all}</span></button>;
        })}
      </div>
      <div className="dex-grid">
        {list.map((c) => {
          const n = owned[c.id] ?? 0;
          const on = worn.includes(c.id);
          const how = !n ? tr('아직 없음', 'Not yet') : on ? tr('끼는 중 — 눌러서 꾸미기로', 'On — click to open Decorate') : tr('눌러서 꾸미기로', 'Click to open Decorate');
          return (
            <button key={c.id} className={`dex-cell r-${c.rarity} ${n ? '' : 'locked'} ${on ? 'on' : ''}`} disabled={!n} onClick={() => onPick(c.id)} title={how}>
              <ItemIcon id={c.id} locked={!n} big />
              <span className="dex-name">{n ? c.name.replace(/^.* — /, '') : '?'}</span>
              <span className={`dex-rare r-${c.rarity}`}>{rarityLabel(c.rarity)}</span>
              <Stars count={n} />
              {fresh.has(c.id) && <span className="dex-new">NEW</span>}
              {c.limited && <span className="dex-limited" title={tr(EVENTS[c.limited].ko, EVENTS[c.limited].en)}>{tr('한정', 'Ltd')}</span>}
              {on && <span className="dex-on">{c.kind === 'skin' ? tr('사용 중', 'In use') : tr('장착 중', 'Equipped')}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
