// 펫 모달 '혈통' 탭 — 은퇴한 세대를 1대부터, 맨 끝에 지금 키우는 애(세대 잇기, docs/design-drafts/tama-next v1 E)
import { QUIRK_HINT, QUIRK_NAME, type Ancestor, type Quirk } from '../../domain/tama/lineage';
import type { Pet } from '../../domain/tama/pet';
import { nameOf, stageOf } from '../../domain/tama/tree';
import { getLang, tr } from '../../i18n';
import { eggName, STAGES } from './labels';
import { spriteOf } from './lcd';
import { Sprite } from './Sprite';

const day = (t: number) => new Date(t).toLocaleDateString(getLang() === 'en' ? 'en-US' : 'ko-KR', { month: 'numeric', day: 'numeric' });
const genName = (n: number) => tr(`${n}대`, `Gen ${n}`);

/** 버릇 알약 — 이름만, 얻는 법·효과는 툴팁 */
export function QuirkChips({ quirks }: { quirks: Quirk[] }) {
  if (!quirks.length) return null;
  return <span className="pv-quirks">{quirks.map((q) => <span key={q} className="pv-quirk" title={QUIRK_HINT[q]()}>{QUIRK_NAME[q]()}</span>)}</span>;
}

export function LineageTab({ lineage, pet, heir }: { lineage: Ancestor[]; pet: Pet | null; heir: Quirk[] }) {
  if (!lineage.length) return <div className="pv-blank">{tr('아직 은퇴한 애가 없어 — 궁극체가 되고 하루 지나면 은퇴하고, 다음 알이 버릇을 물려받아', 'No one has retired yet — a day after reaching its final form it retires, and the next egg inherits a habit')}</div>;
  return (
    <ol className="pv-lineage">
      {lineage.map((a, i) => (
        <li key={i}>
          <Sprite name={spriteOf(a.egg, a.slot)} size={36} />
          <div className="pv-name"><b>{genName(i + 1)} {nameOf(a.egg, a.slot)}</b><span>{eggName(a.egg)} · {STAGES[stageOf(a.slot)]} · {day(a.bornAt)}~{day(a.retiredAt)}</span></div>
          <span className="pv-gave">{tr('물려줌', 'Passed on')}<QuirkChips quirks={[a.quirk]} /></span>
        </li>
      ))}
      <li className="pv-now-gen">
        {pet ? <Sprite name={spriteOf(pet.egg, pet.slot)} size={36} /> : <span className="pv-cell off" />}
        <div className="pv-name"><b>{genName(lineage.length + 1)} {pet ? nameOf(pet.egg, pet.slot) : tr('새 알을 기다리는 중', 'Waiting for a new egg')}</b><span>{tr('지금', 'Now')}</span></div>
        <span className="pv-gave">{tr('물려받음', 'Inherited')}<QuirkChips quirks={pet ? pet.quirks ?? [] : heir} /></span>
      </li>
    </ol>
  );
}
