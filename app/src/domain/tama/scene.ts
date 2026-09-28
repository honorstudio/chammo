// 위젯이 지금 보여줄 장면과 켜질 표시등. 아이콘은 누르는 버튼이 아니라 그 일이 일어나는 동안 켜지는 표시등(시안 v3 I 덱)
import { DEFAULT_CAL, type Calendar } from './clock';
import { fullness, type Pet } from './pet';

export type SceneName = 'pick' | 'dead' | 'evolve' | 'sick' | 'eat' | 'sleep' | 'poop' | 'walk';
export type Lamp = 'food' | 'light' | 'play' | 'med' | 'clean' | 'stat' | 'train' | 'call';

const EAT_MS = 90_000;

export function sceneFor(pet: Pet | null, now: number, o: { busy: boolean; justEvolved: boolean }, cal: Calendar = DEFAULT_CAL) {
  if (!pet) return { scene: 'pick' as SceneName, lit: [] as Lamp[] };
  if (pet.dead) return { scene: 'dead' as SceneName, lit: [] as Lamp[] };
  const h = new Date(now).getHours();
  const asleep = h >= cal.sleepFrom && h < cal.sleepTo;
  const lastCommit = pet.recent[pet.recent.length - 1] ?? -Infinity;
  const eating = now - lastCommit < EAT_MS;

  const lit: Lamp[] = [];
  if (eating) lit.push('food');
  if (asleep) lit.push('light');
  if (pet.sick) lit.push('med');
  if (pet.poops > 0) lit.push('clean');
  if (o.busy) lit.push('train');
  if (pet.sick || pet.poops > 0 || fullness(pet) === 0) lit.push('call');

  const scene: SceneName = o.justEvolved ? 'evolve' : pet.sick ? 'sick' : eating ? 'eat' : asleep ? 'sleep' : pet.poops > 0 ? 'poop' : 'walk';
  return { scene, lit };
}
