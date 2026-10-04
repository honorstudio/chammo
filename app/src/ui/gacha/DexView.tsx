import { useState, type ReactNode } from 'react';
import { CATALOG, rarityLabel, starTotal, type GachaFile, type ItemKind } from '../../domain/gacha';
import { tr } from '../../i18n';
import { SubHead } from '../office/OfficeMenu';
import { ItemIcon } from './GachaPage';
import { StarCount, Stars } from './Stars';

const KINDS: [ItemKind | 'all', string][] = [['all', tr('전체', 'All')], ['skin', tr('스킨', 'Skins')], ['furn', tr('가구', 'Furniture')], ['hat', tr('모자', 'Hats')], ['window', tr('창밖', 'Views')], ['fx', tr('이펙트', 'Effects')], ['action', tr('반장 액션', 'Boss moves')], ['friend', tr('펫 친구', 'Pet pals')]];
const WEARABLE: ItemKind[] = ['hat', 'window', 'fx', 'action'];

/** 도감(사무실 칸 안) — 모은 것·못 모은 것. 모자·창밖·이펙트·반장 액션은 눌러서 장착/해제. 스킨·가구는 그 메뉴로 안내 */
export function DexView({ file, equip, onClose, nav }: { file: GachaFile | null; equip: (id: string) => void; onClose: () => void; nav?: ReactNode }) {
  const [kind, setKind] = useState<ItemKind | 'all'>('all');
  const owned = file?.owned ?? {};
  const worn = Object.values(file?.equip ?? {});
  const list = CATALOG.filter((c) => kind === 'all' || c.kind === kind);
  const have = CATALOG.filter((c) => (owned[c.id] ?? 0) > 0).length;
  return (
    <div className="office-sub dex">
      <SubHead onClose={onClose} title={`${tr('도감', 'Collection')} ${have} / ${CATALOG.length}`} nav={nav} right={file && <StarCount {...starTotal(file)} />} coins={file?.coins} />
      <div className="dex-kinds">
        {KINDS.map(([k, name]) => {
          const n = CATALOG.filter((c) => (k === 'all' || c.kind === k) && (owned[c.id] ?? 0) > 0).length;
          const all = CATALOG.filter((c) => k === 'all' || c.kind === k).length;
          return <button key={k} className={k === kind ? 'on' : ''} onClick={() => setKind(k)}>{name} <span>{n}/{all}</span></button>;
        })}
      </div>
      <div className="dex-grid">
        {list.map((c) => {
          const n = owned[c.id] ?? 0;
          const on = worn.includes(c.id);
          const wearable = n > 0 && WEARABLE.includes(c.kind);
          const how = !n ? tr('아직 없음', 'Not yet') : on ? tr('장착 중 — 눌러서 해제', 'Equipped — click to remove') : wearable ? tr('눌러서 장착', 'Click to equip') : c.kind === 'skin' ? tr('메뉴 → 스킨에서 고르기', 'Menu → Skins to pick') : c.kind === 'furn' ? tr('메뉴 → 가구 놓기', 'Menu → Place furniture') : tr('사무실에 나와 있어', 'Already in the office');
          return (
            <button key={c.id} className={`dex-cell r-${c.rarity} ${n ? '' : 'locked'} ${on ? 'on' : ''}`} disabled={!wearable} onClick={() => equip(c.id)} title={how}>
              <ItemIcon id={c.id} locked={!n} big />
              <span className="dex-name">{n ? c.name.replace(/^.* — /, '') : '?'}</span>
              <span className={`dex-rare r-${c.rarity}`}>{rarityLabel(c.rarity)}</span>
              <Stars count={n} />
              {on && <span className="dex-on">{tr('장착 중', 'Equipped')}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
