import { useEffect, type ReactNode } from 'react';
import { tr } from '../../i18n';
import { IconClose } from '../Icons';

/**
 * 사무실 칸 위에 띄우는 것 — 뽑기·도감·스킨은 모달, 가구는 방 위에서 바로 끌어 놓기.
 * 참모 열·작업 패널은 그대로 두고 이 칸 안에서만(사용자 2026-09-27: 채팅을 가리지 말 것, 2026-09-28: 페이지 말고 모달)
 */
export type OfficeTab = 'office' | 'gacha' | 'dex' | 'skins' | 'furniture';
/** 한 창 안에서 오가는 상점 화면 — 사무실 메뉴와 펫 탭 코인이 같은 창을 연다 */
export type ShopView = 'gacha' | 'dex' | 'skins';

/** 직접 그린 도트 아이콘(16칸) — '#' 칸을 글자색으로 칠한다. 라이브러리·이모지 금지(CLAUDE.md) */
const ICON: Record<Exclude<OfficeTab, 'office'>, string[]> = {
  gacha: [
    '.....######.....', '...##......##...', '..#..##.......#.', '..#.##..##....#.', '..#.....##..#.#.', '...##......##...',
    '....########....', '....#......#....', '....#.####.#....', '....#.#..#.#....', '....#.####.#....', '....#......#....',
    '....#..##..#....', '....########....', '...#........#...', '...##########...',
  ],
  dex: [
    '................', '..###########...', '..#.#.......##..', '..#.#.......#.#.', '..#.#.#####.#.#.', '..#.#.......#.#.',
    '..#.#.####.#.#..', '..#.#.......#.#.', '..#.#.......#.#.', '..#.#.......#.#.', '..#.#.......#.#.', '..#.#.......#.#.',
    '..#.#########.#.', '..#...........#.', '..#############..', '................',
  ],
  skins: [
    '................', '..##########....', '..#........#....', '..#.######.###..', '..#........#.#..', '..##########.#..',
    '.............#..', '.......#######..', '.......#........', '.......#........', '......###.......', '......###.......',
    '......###.......', '......###.......', '......###.......', '................',
  ],
  furniture: [
    '................', '................', '...##########...', '..#..........#..', '..#..........#..', '.##..........##.',
    '#..#........#..#', '#...########...#', '#..............#', '#..............#', '################', '.#............#.',
    '.#............#.', '.##..........##.', '................', '................',
  ],
};

export function PixelIcon({ rows, size = 22 }: { rows: string[]; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" aria-hidden>
      {rows.flatMap((r, y) => [...r].map((c, x) => (c === '#' ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" /> : null)))}
    </svg>
  );
}

const TOOLS: [Exclude<OfficeTab, 'office'>, string][] = [['gacha', tr('뽑기', 'Gacha')], ['dex', tr('도감', 'Collection')], ['skins', tr('스킨', 'Skins')], ['furniture', tr('가구', 'Furniture')]];

/** 왼쪽 위 아이콘 줄 — 누르면 그 모달(가구는 방 위 편집). 켜진 걸 다시 누르면 닫힌다 */
export function OfficeTools({ tab, onTab }: { tab: OfficeTab; onTab: (t: OfficeTab) => void }) {
  return (
    <div className="office-tools" role="toolbar" aria-label={tr('사무실 메뉴', 'Office menu')}>
      {TOOLS.map(([id, name]) => (
        <button key={id} className={`office-tool ${tab === id ? 'on' : ''}`} aria-pressed={tab === id} title={name} onClick={() => onTab(tab === id ? 'office' : id)}>
          <PixelIcon rows={ICON[id]} />
          <span>{name}</span>
        </button>
      ))}
    </div>
  );
}

/** 뽑기·도감·스킨 모달 — 사무실 칸 위에 뜬다. 바깥을 누르거나 Esc 면 닫힌다 */
export function OfficeModal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="office-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="office-modal-card" role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}

const SHOP: [ShopView, string][] = [['gacha', tr('뽑기', 'Gacha')], ['dex', tr('도감', 'Collection')], ['skins', tr('스킨', 'Skins')]];

/** 상점 창 안에서 뽑기·도감·스킨을 오가는 아이콘 — 펫 탭에서 뽑아도 뽑은 걸 바로 본다(2026-10-04 QA 3번) */
export function ShopNav({ view, onView }: { view: ShopView; onView: (v: ShopView) => void }) {
  return (
    <div className="shop-nav" role="tablist" aria-label={tr('상점', 'Shop')}>
      {SHOP.map(([id, name]) => (
        <button key={id} role="tab" aria-selected={view === id} aria-label={name} title={name} className={view === id ? 'on' : ''} onClick={() => onView(id)}>
          <PixelIcon rows={ICON[id]} size={18} />
        </button>
      ))}
    </div>
  );
}

/** 모달 머리줄 — 제목 · (상점 아이콘) · 오른쪽 코인 · 닫기 */
export function SubHead({ title, coins, right, nav, onClose }: { title: ReactNode; coins?: number; right?: ReactNode; nav?: ReactNode; onClose?: () => void }) {
  return (
    <div className="office-subhead">
      <b>{title}</b>
      {nav}
      <span className="grow" />
      {right}
      {coins != null && <span className="office-subcoin" title={tr('코인', 'Coins')}><i />{coins.toLocaleString()}</span>}
      {onClose && <button className="office-close" onClick={onClose} aria-label={tr('닫기', 'Close')} title={tr('닫기', 'Close')}><IconClose /></button>}
    </div>
  );
}
