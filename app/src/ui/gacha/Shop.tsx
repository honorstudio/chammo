// 상점 창 — 뽑기·도감·스킨을 한 창에서 오간다. 사무실 메뉴와 펫 탭 코인이 같은 창을 연다(2026-10-04 QA 3번: 도감이 둘·펫 탭에서 뽑은 걸 볼 곳 없음)
import type { GachaFile, PullResult } from '../../domain/gacha';
import { SkinsView } from '../office/SkinsView';
import { ShopNav, type ShopView } from '../office/OfficeMenu';
import { DexView } from './DexView';
import { GachaPage } from './GachaPage';

type Props = {
  view: ShopView;
  onView: (v: ShopView) => void;
  file: GachaFile | null;
  draw: (n: 1 | 10) => Promise<PullResult[] | null>;
  equip: (id: string) => void;
  skins: { owned: string[]; current: string; onSkin: (id: string) => void };
  onClose: () => void;
};

export function Shop({ view, onView, file, draw, equip, skins, onClose }: Props) {
  const nav = <ShopNav view={view} onView={onView} dot={{ dex: !!file?.fresh?.length }} />;
  if (view === 'dex') return <DexView file={file} equip={equip} onClose={onClose} nav={nav} />;
  if (view === 'skins') return <SkinsView {...skins} coins={file?.coins} counts={file?.owned} fresh={file?.fresh} onClose={onClose} nav={nav} />;
  return <GachaPage file={file} draw={draw} onClose={onClose} nav={nav} />;
}
