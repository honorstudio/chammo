import { useEffect, useRef, type ReactNode } from 'react';
import { CATALOG, rarityLabel } from '../../domain/gacha';
import { planRoom, type Room } from '../../domain/office';
import { drawRoom, roomSize } from './draw';
import { SubHead } from './OfficeMenu';
import { SKIN_NAMES, skinOf } from './skins';
import { tr } from '../../i18n';
import { Stars } from '../gacha/Stars';

// 미리보기용 작은 방 — 반장 + 세 명
const SAMPLE: Room = planRoom(
  [{ id: 'b', label: '', project: 'b', status: 'working', startedAt: 0 }],
  ['todo-api', 'acme-shop', 'pixel-blog'].map((p, i) => ({ id: p, label: '', project: p, status: i === 1 ? 'done' : 'working', startedAt: i })),
  'bear',
);

function Preview({ skin }: { skin: string }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const { W, H } = roomSize(SAMPLE);
    c.width = W; c.height = H;
    drawRoom(ctx, SAMPLE, skinOf(skin), 1);
  }, [skin]);
  return <canvas ref={cv} className="skin-preview" />;
}

/** 스킨(사무실 칸 안) — 가진 스킨은 미리보기를 눌러 바꾸고, 없는 건 실루엣(뽑기에서) */
/** counts = 뽑기에서 가진 개수(별) */
export function SkinsView({ owned, current, onSkin, coins, counts, fresh, onClose, nav }: { owned: string[]; current: string; onSkin: (id: string) => void; coins?: number; counts?: Record<string, number>; /** NEW — 처음 얻고 안 눌러 본 것(gacha.json fresh) */ fresh?: string[]; onClose: () => void; nav?: ReactNode }) {
  return (
    <div className="office-sub skins">
      <SubHead onClose={onClose} title={`${tr('스킨', 'Skins')} ${owned.length} / ${SKIN_NAMES.length}`} nav={nav} coins={coins} />
      <div className="skins-grid">
        {SKIN_NAMES.map(([id, name]) => {
          const have = owned.includes(id);
          // rarity 는 색 클래스(r-희귀 등) 키 — 글자는 label 로
          const rarity = id === 'wood' ? '기본' : CATALOG.find((c) => c.id === `skin.${id}`)?.rarity ?? '';
          const label = rarity === '기본' ? tr('기본', 'Default') : rarity ? rarityLabel(rarity) : '';
          return (
            <button key={id} className={`skin-cell ${have ? '' : 'locked'} ${id === current ? 'on' : ''}`} disabled={!have} onClick={() => onSkin(id)} title={have ? `${name}${id === current ? tr(' — 지금 쓰는 중', ' — in use') : tr(' — 눌러서 바꾸기', ' — click to switch')}` : tr('뽑기에서 나와', 'Comes from the gacha')}>
              {have ? <Preview skin={id} /> : <span className="skin-lock">?</span>}
              {fresh?.includes(`skin.${id}`) && <span className="dex-new">NEW</span>}
              <span className="skin-name">{have ? name : '?'}</span>
              <span className="skin-meta"><span className={`dex-rare r-${rarity}`}>{label}{id === current ? tr(' · 사용 중', ' · in use') : ''}</span>{have && <Stars count={counts?.[`skin.${id}`] ?? 0} />}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
