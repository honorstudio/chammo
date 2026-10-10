import { useState, type ReactNode } from 'react';
import { CATALOG, rarityLabel, starTotal, type GachaFile, type ItemKind } from '../../domain/gacha';
import { tr } from '../../i18n';
import { SubHead } from '../office/OfficeMenu';
import { ItemIcon } from './GachaPage';
import { StarCount, Stars } from './Stars';

const KINDS: [ItemKind | 'all', string][] = [['all', tr('전체', 'All')], ['skin', tr('스킨', 'Skins')], ['furn', tr('가구', 'Furniture')], ['hat', tr('모자', 'Hats')], ['window', tr('창밖', 'Views')], ['fx', tr('이펙트', 'Effects')], ['action', tr('반장 액션', 'Boss moves')], ['friend', tr('펫 친구', 'Pet pals')], ['desk', tr('책상 소품', 'Desk items')], ['title', tr('칭호', 'Titles')], ['light', tr('조명', 'Lighting')]];
const WEARABLE: ItemKind[] = ['skin', 'hat', 'window', 'fx', 'action', 'desk', 'title', 'light'];

/** 도감(사무실 칸 안) — 모은 것·못 모은 것. 처음 얻고 안 눌러 본 건 NEW(누르면 꺼짐). 스킨·모자·창밖·이펙트·반장 액션은 눌러서 장착/해제(스킨 화면과 같은 칸). 가구는 그 메뉴로 안내 */
export function DexView({ file, equip, onClose, nav }: { file: GachaFile | null; equip: (id: string) => void; onClose: () => void; nav?: ReactNode }) {
  const [kind, setKind] = useState<ItemKind | 'all'>('all');
  const owned = file?.owned ?? {};
  const fresh = new Set(file?.fresh ?? []);
  const worn = Object.values(file?.equip ?? {});
  // NEW 는 맨 앞 — 새로 뽑은 게 107칸 사이에 묻혀 안 보였다(2026-10-10 사용자)
  const list = CATALOG.filter((c) => kind === 'all' || c.kind === kind).sort((a, b) => Number(fresh.has(b.id)) - Number(fresh.has(a.id)));
  const have = CATALOG.filter((c) => (owned[c.id] ?? 0) > 0).length;
  return (
    <div className="office-sub dex">
      <SubHead onClose={onClose} title={`${tr('도감', 'Collection')} ${have} / ${CATALOG.length}`} nav={nav} right={file && <StarCount {...starTotal(file)} />} coins={file?.coins} />
      <div className="dex-kinds">
        {KINDS.map(([k, name]) => {
          const n = CATALOG.filter((c) => (k === 'all' || c.kind === k) && (owned[c.id] ?? 0) > 0).length;
          const all = CATALOG.filter((c) => k === 'all' || c.kind === k).length;
          const isNew = CATALOG.some((c) => (k === 'all' || c.kind === k) && fresh.has(c.id));
          return <button key={k} className={`${k === kind ? 'on' : ''} ${isNew ? 'has-new' : ''}`} onClick={() => setKind(k)}>{name} <span>{n}/{all}</span></button>;
        })}
      </div>
      <div className="dex-grid">
        {list.map((c) => {
          const n = owned[c.id] ?? 0;
          const on = worn.includes(c.id);
          const wearable = n > 0 && WEARABLE.includes(c.kind);
          const how = !n ? tr('아직 없음', 'Not yet') : on ? (c.kind === 'skin' ? tr('사용 중 — 눌러서 기본으로', 'In use — click for the default') : tr('장착 중 — 눌러서 해제', 'Equipped — click to remove')) : wearable ? tr('눌러서 장착', 'Click to equip') : c.kind === 'furn' ? tr('메뉴 → 가구 놓기', 'Menu → Place furniture') : tr('사무실에 나와 있어', 'Already in the office');
          return (
            <button key={c.id} className={`dex-cell r-${c.rarity} ${n ? '' : 'locked'} ${on ? 'on' : ''}`} disabled={!n} onClick={() => equip(c.id)} title={how}>
              <ItemIcon id={c.id} locked={!n} big />
              <span className="dex-name">{n ? c.name.replace(/^.* — /, '') : '?'}</span>
              <span className={`dex-rare r-${c.rarity}`}>{rarityLabel(c.rarity)}</span>
              <Stars count={n} />
              {fresh.has(c.id) && <span className="dex-new">NEW</span>}
              {on && <span className="dex-on">{c.kind === 'skin' ? tr('사용 중', 'In use') : tr('장착 중', 'Equipped')}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
