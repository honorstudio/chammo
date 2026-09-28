import { useEffect, type ReactNode } from 'react';
import { tr } from '../../i18n';

/**
 * 사무실 칸 위에 띄우는 것 — 뽑기·도감·스킨은 모달, 가구는 방 위에서 바로 끌어 놓기.
 * 참모 열·작업 패널은 그대로 두고 이 칸 안에서만(사용자 2026-09-27: 채팅을 가리지 말 것, 2026-09-28: 페이지 말고 모달)
 */
export type OfficeTab = 'office' | 'gacha' | 'dex' | 'skins' | 'furniture';

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

function PixelIcon({ rows }: { rows: string[] }) {
  return (
    <svg viewBox="0 0 16 16" width="22" height="22" shapeRendering="crispEdges" aria-hidden>
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

/** 모달 머리줄 — 제목 · 오른쪽 코인 · 닫기 */
export function SubHead({ title, coins, right, onClose }: { title: string; coins?: number; right?: ReactNode; onClose?: () => void }) {
  return (
    <div className="office-subhead">
      <b>{title}</b>
      <span className="grow" />
      {right}
      {coins != null && <span className="office-subcoin"><i />{coins.toLocaleString()}</span>}
      {onClose && <button className="office-close" onClick={onClose} aria-label={tr('닫기', 'Close')}>{tr('닫기', 'Close')}</button>}
    </div>
  );
}
