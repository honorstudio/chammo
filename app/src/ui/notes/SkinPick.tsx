// 스킨 견본 넷(시안 v2 K·M3) — 패널 ⋯ 메뉴·따로 창·폰 시트가 같이 쓴다. 색 견본만(이름은 title·aria-label)
import { SKINS, type NoteSkin } from '../../domain/notes';
import { tr } from '../../i18n';

export const skinName = (s: NoteSkin) => ({ paper: tr('메모지', 'Paper'), lined: tr('줄 노트', 'Lined'), dark: tr('어두운 종이', 'Dark paper'), term: tr('터미널', 'Terminal') })[s];

export function SkinPick({ value, onPick, className = 'nt-sw' }: { value: NoteSkin; onPick: (s: NoteSkin) => void; className?: string }) {
  return (
    <span className={className} role="group" aria-label={tr('스킨', 'Skin')}>
      {SKINS.map((s) => (
        <button key={s} type="button" className={`sk-${s}`} aria-pressed={s === value} aria-label={skinName(s)} title={skinName(s)} onClick={() => onPick(s)} />
      ))}
    </span>
  );
}
