// 상점 창 — 뽑기·도감·꾸미기를 한 창에서 오간다. 사무실 메뉴와 펫 탭 코인이 같은 창을 연다(2026-10-04 QA 3번: 도감이 둘·펫 탭에서 뽑은 걸 볼 곳 없음)
// 2026-10-21 사용자 확정(시안 office-ux v1 A): 도감은 보기만, 끼우는 곳은 꾸미기 한 곳 — 도감에서 가진 칸을 누르면 꾸미기 그 종류로
import { useState } from 'react';
import type { GachaFile, PullResult } from '../../domain/gacha';
import { DecoView } from './DecoView';
import { ShopNav, type ShopView } from '../office/OfficeMenu';
import { DexView } from './DexView';
import { GachaPage } from './GachaPage';

type Props = {
  view: ShopView;
  onView: (v: ShopView) => void;
  file: GachaFile | null;
  draw: (n: 1 | 10) => Promise<PullResult[] | null>;
  /** 끼기·빼기(같은 종류는 바꿔 낌) — NEW 도 끈다 */
  equip: (id: string) => void;
  /** 방 스킨 고르기(지금 사무실) — 'wood' = 기본 */
  setSkin: (name: string) => void;
  /** 지금 사무실 번호 — 스킨은 사무실마다 */
  office?: number;
  /** 참모 캐릭터 고르기 창 */
  onChars?: () => void;
  /** NEW 끄기만(도감에서 봄) */
  see: (id: string) => void;
  /** 사무실 편집 열기(그 층으로) — 사무실에서만 */
  onPlace?: (kind: 'furn' | 'floor' | 'wall') => void;
  onClose: () => void;
};

export function Shop({ view, onView, file, draw, equip, setSkin, see, office = 0, onChars, onPlace, onClose }: Props) {
  const [focus, setFocus] = useState<string | null>(null);
  const nav = <ShopNav view={view} onView={(v) => { setFocus(null); onView(v); }} dot={{ dex: !!file?.fresh?.length }} />;
  if (view === 'dex') return <DexView file={file} onPick={(id) => { see(id); setFocus(id); onView('deco'); }} onClose={onClose} nav={nav} />;
  if (view === 'deco') return <DecoView file={file} focus={focus} onEquip={equip} onSkin={setSkin} office={office} onChars={onChars} onPlace={onPlace} onClose={onClose} nav={nav} />;
  return <GachaPage file={file} draw={draw} onClose={onClose} nav={nav} />;
}
