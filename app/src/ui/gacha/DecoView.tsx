import { useEffect, useRef, useState, type ReactNode } from 'react';
import { itemOf, ownedOf, rarityLabel, skinOfFile, type GachaFile, type ItemKind } from '../../domain/gacha';
import { catWalk, planRoom, withLounge, type Room } from '../../domain/office';
import { tr } from '../../i18n';
import { drawRoom, roomSize } from '../office/draw';
import { SubHead } from '../office/OfficeMenu';
import { skinOf } from '../office/skins';
import { ItemIcon } from './GachaPage';
import { Stars } from './Stars';

// 미리보기용 작은 방 — 반장 + 세 명
const SAMPLE: Room = planRoom(
  [{ id: 'b', label: '', project: 'b', status: 'working', startedAt: 0 }],
  ['todo-api', 'acme-shop', 'pixel-blog'].map((p, i) => ({ id: p, label: '', project: p, status: i === 1 ? 'done' : 'working', startedAt: i })),
  'bear',
);

/** 꾸미기 자리 — 순서 = 왼쪽 목록 순서. 가구는 방에 놓기(트레이), 펫 친구는 가지면 늘 나온다(보기만) */
export const DECO_SLOTS: [ItemKind, string][] = [
  ['skin', tr('방 스킨', 'Room skin')], ['window', tr('창밖', 'Window view')], ['light', tr('조명', 'Lighting')], ['hat', tr('모자', 'Hat')],
  ['title', tr('칭호', 'Title')], ['desk', tr('책상 소품', 'Desk item')], ['action', tr('반장 액션', 'Boss move')], ['fx', tr('펑 효과', 'Pop effect')],
  ['furn', tr('가구', 'Furniture')], ['friend', tr('펫 친구', 'Pet pals')],
];
const short = (id: string) => itemOf(id)?.name.replace(/^.* — /, '') ?? '';

/** 지금 낀 것으로 그린 작은 방 — 끼울 때마다 바뀐다(사무실로 안 나가도 모습이 보인다) */
function Preview({ file }: { file: GachaFile | null }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const eq = file?.equip ?? {};
  const furn = file ? ownedOf(file, 'furn') : [];
  const pals = file ? ownedOf(file, 'friend') : [];
  const key = JSON.stringify([eq, furn, pals, file ? skinOfFile(file) : 'wood']);
  useEffect(() => {
    const c = cv.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const room = withLounge(SAMPLE, furn, file?.placed);
    const { W, H } = roomSize(room);
    c.width = W; c.height = H;
    const sk = skinOf(file ? skinOfFile(file) : 'wood');
    let t = 0;
    const frame = () => {
      const now = Date.now();
      drawRoom(ctx, room, sk, t++, {
        boss: eq.action === 'action.dance' ? { mode: 'cheer' } : null,
        deco: { hat: eq.hat, window: eq.window, desk: eq.desk, light: eq.light, action: eq.action, dance: eq.action === 'action.dance', cat: pals.includes('friend.cat') ? catWalk(room, now) : null, pals: pals.filter((p) => p !== 'friend.cat').map((id, k) => ({ id, ...catWalk(room, now + (k + 1) * 6_000) })) },
      });
    };
    frame();
    const id = setInterval(frame, 150);
    return () => clearInterval(id);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={cv} className="deco-preview" />;
}

/**
 * 꾸미기(시안 office-ux v1 A, 2026-10-21 사용자 확정) — 끼우는 곳은 여기 한 곳. 왼쪽 = 자리마다 지금 낀 것, 위 = 미리보기 방, 아래 = 그 자리에 가진 것.
 * 누르면 끼우고 또 누르면 뺀다. 스킨은 '나무' 칸 = 해제(기본). 가구는 '방에 놓기'로 사무실 트레이, 펫 친구는 보기만.
 * focus = 도감에서 눌러 들어왔을 때 그 아이템(그 종류를 열고 표시)
 */
export function DecoView({ file, focus, onEquip, onSkin, onPlace, onClose, nav }: {
  file: GachaFile | null; focus?: string | null; onEquip: (id: string) => void; onSkin: (name: string) => void;
  /** 가구 놓기(사무실 트레이) — 없으면(펫 탭) 버튼 대신 안내 */ onPlace?: () => void; onClose: () => void; nav?: ReactNode;
}) {
  const [kind, setKind] = useState<ItemKind>(() => itemOf(focus ?? '')?.kind ?? 'skin');
  useEffect(() => { const k = itemOf(focus ?? '')?.kind; if (k) setKind(k); }, [focus]);
  const eq = (file?.equip ?? {}) as Record<string, string | undefined>;
  const owned = file?.owned ?? {};
  const fresh = new Set(file?.fresh ?? []);
  const skinNow = file ? skinOfFile(file) : 'wood';
  const current = (k: ItemKind) => {
    if (k === 'skin') return skinNow === 'wood' ? tr('나무', 'Wood') : short(`skin.${skinNow}`);
    if (k === 'furn' || k === 'friend') { const n = file ? ownedOf(file, k).length : 0; return n ? tr(`${n}개`, `${n}`) : tr('없음', 'None'); }
    return eq[k] ? short(eq[k]!) : tr('없음', 'None');
  };
  const on = (id: string) => (kind === 'skin' ? `skin.${skinNow}` === id : eq[kind] === id);
  const press = (id: string) => (kind === 'skin' ? onSkin(on(id) ? 'wood' : id.slice(5)) : onEquip(id));
  const wearable = kind !== 'furn' && kind !== 'friend';
  // 끼는 중인 것 → NEW → 나머지(도감 순서) — 쓰는 스킨이 80칸 사이에 묻히지 않게
  const ids = (file ? ownedOf(file, kind) : []).sort((a, b) => Number(on(b)) - Number(on(a)) || Number(fresh.has(b)) - Number(fresh.has(a)));
  return (
    <div className="office-sub deco">
      <SubHead onClose={onClose} title={tr('꾸미기', 'Decorate')} nav={nav} coins={file?.coins} />
      <div className="deco-body">
        <nav className="deco-slots" aria-label={tr('꾸밀 자리', 'Slots')}>
          {DECO_SLOTS.map(([k, name]) => (
            <button key={k} className={`deco-slot ${k === kind ? 'on' : ''} ${file && ownedOf(file, k).some((id) => fresh.has(id)) ? 'has-new' : ''}`} onClick={() => setKind(k)}>
              <b>{name}</b><span>{current(k)}</span>
            </button>
          ))}
        </nav>
        <div className="deco-main">
          <div className="deco-stage"><Preview file={file} /></div>
          <div className="deco-grid">
            {kind === 'furn' && (onPlace
              ? <button className="deco-place" onClick={onPlace}>{tr('방에 놓기', 'Place in room')}</button>
              : <span className="dim deco-note">{tr('가구는 사무실에서 놓아', 'Place furniture from the office')}</span>)}
            {kind === 'friend' && <span className="dim deco-note">{tr('가진 펫 친구는 사무실 통로를 걷는다', 'Pet pals you own walk around the office')}</span>}
            {kind === 'skin' && (
              <button className={`dex-cell ${skinNow === 'wood' ? 'on' : ''}`} onClick={() => onSkin('wood')} title={tr('기본 방 — 끼운 스킨 해제', 'Default room — removes the skin')}>
                <ItemIcon id="skin.wood" big /><span className="dex-name">{tr('나무', 'Wood')}</span><span className="dex-rare">{tr('기본', 'Default')}</span>
                {skinNow === 'wood' && <span className="dex-on">{tr('사용 중', 'In use')}</span>}
              </button>
            )}
            {wearable && kind !== 'skin' && (
              <button className={`dex-cell ${!eq[kind] ? 'on' : ''}`} onClick={() => eq[kind] && onEquip(eq[kind]!)} title={tr('빼기', 'Remove')}>
                <span className="deco-none" aria-hidden /><span className="dex-name">{tr('없음', 'None')}</span>
              </button>
            )}
            {ids.length === 0 && <span className="dim deco-note">{tr('아직 없어 — 뽑기에서 나와', 'None yet — get some from the gacha')}</span>}
            {ids.map((id) => {
              const it = itemOf(id)!;
              return (
                <button key={id} className={`dex-cell r-${it.rarity} ${wearable && on(id) ? 'on' : ''} ${focus === id ? 'focus' : ''}`} disabled={!wearable} onClick={() => press(id)}
                  title={wearable ? (on(id) ? tr('끼는 중 — 눌러서 빼기', 'On — click to remove') : tr('눌러서 끼기', 'Click to put on')) : short(id)}>
                  <ItemIcon id={id} big />
                  <span className="dex-name">{short(id)}</span>
                  <span className={`dex-rare r-${it.rarity}`}>{rarityLabel(it.rarity)}</span>
                  <Stars count={owned[id] ?? 0} />
                  {fresh.has(id) && <span className="dex-new">NEW</span>}
                  {wearable && on(id) && <span className="dex-on">{kind === 'skin' ? tr('사용 중', 'In use') : tr('끼는 중', 'On')}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
