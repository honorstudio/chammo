import type { GachaFile } from '../../domain/gacha';
import { itemOf, ownedOf } from '../../domain/gacha';
import { ItemIcon } from '../gacha/GachaPage';
import { tr } from '../../i18n';

/** 상태는 클래스 키(st-창고)로도 쓰니 한국어 그대로, 화면 글자만 번역 */
const STATE_LABEL = (s: string) => ({ 창고: tr('창고', 'Stored'), 밀려남: tr('밀려남', 'Moved aside'), 놓임: tr('놓임', 'Placed'), 휴게실: tr('휴게실', 'Lounge') })[s] ?? s;

/**
 * 가구 놓기 트레이(방 아래, 심즈처럼) — 가진 가구가 카드로 늘어서 있고, 카드를 방으로 끌면 놓인다.
 * 방에 놓인 가구도 끌어서 옮기고, 이 트레이로 끌어오면 창고. pushed = 새 책상이 덮어 휴게실로 비켜 있는 가구
 */
export function FurnitureTray({ file, drag, onGrab, onDone, pushed = [] }: { file: GachaFile | null; drag: string | null; onGrab: (id: string) => void; onDone: () => void; pushed?: string[] }) {
  const ids = file ? ownedOf(file, 'furn') : [];
  const state = (id: string) => { const p = file?.placed?.[id]; return p === null ? '창고' : pushed.includes(id) ? '밀려남' : p ? '놓임' : '휴게실'; };
  return (
    <div className={`furn-tray ${drag ? 'drop' : ''}`}>
      <div className="furn-tray-head">
        <b>{tr('가구 놓기', 'Place furniture')}</b>
        <span className="dim">{drag ? tr('방 바닥에 놓아 — 여기로 가져오면 창고', 'Drop it on the floor — bring it back here to store') : tr('카드를 방으로 끌어 놓기 · 놓인 가구도 끌어서 옮기기', 'Drag a card into the room · drag placed furniture to move it')}</span>
        <span className="grow" />
        <button className="furn-done" onClick={onDone}>{tr('다 했어', 'Done')}</button>
      </div>
      <div className="furn-cards">
        {ids.length === 0 && <span className="dim">{tr('아직 가구가 없어 — 뽑기에서 나와', 'No furniture yet — get some from the gacha')}</span>}
        {ids.map((id) => (
          <button key={id} className={`furn-card st-${state(id)} ${drag === id ? 'lifted' : ''}`} title={tr('끌어서 방에 놓기', 'Drag into the room')}
            onPointerDown={(e) => { e.preventDefault(); onGrab(id); }}>
            <ItemIcon id={id} big />
            <span className="furn-name">{itemOf(id)?.name.replace(/^.* — /, '')}</span>
            <span className="furn-state">{STATE_LABEL(state(id))}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
