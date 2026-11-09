// 뽑기 풀 — 지금 있는 다마고치 도트 70종(알 뺌). 해금해 둔 건 domain/moveTama 가 옮긴다. 새 캐릭터는 catalog/art
import { tr } from '../../i18n';
import { nameOf, type Egg, type Slot } from '../tama/tree';
import type { Item, Rarity } from '../gacha';

const EGGS: Egg[] = ['fire', 'wave', 'leaf', 'star'];
const SLOTS: Slot[] = ['i1', 'i2', 'r1', 'r2', 'cG', 'cD', 'cA', 'cT', 'cM', 'cS', 'cN', 'cX', 'p1', 'p2', 'p3', 'm1', 'm2'];
/** 단계로 등급 — 유년기·성장기 흔함, 성숙기 보통, 완전체 희귀, 궁극체 전설 */
const rarityOf = (s: Slot): Rarity => (s[0] === 'c' ? '보통' : s[0] === 'p' ? '희귀' : s[0] === 'm' || s[0] === 'j' ? '전설' : '흔함');

/** 계열·자리 → 도트 이름. 망치곰만 표정 변형이 있는 bear(옛 ui/tama/lcd 와 같은 규칙) */
export const spriteOf = (egg: Egg, slot: Slot): string => (egg === 'fire' && slot === 'r1' ? 'bear' : slot === 'jA' || slot === 'jB' ? `fuse_${slot}` : `${egg}_${slot}`);

export const chrName = (k: string, e: string) => tr(`캐릭터 — ${k}`, `Character — ${e}`);
const item = (egg: Egg, slot: Slot): Item => ({ id: `chr.${spriteOf(egg, slot)}`, kind: 'chr', rarity: rarityOf(slot), name: tr(`캐릭터 — ${nameOf(egg, slot)}`, `Character — ${nameOf(egg, slot)}`) });

export const TAMA_CHARS: Item[] = [...EGGS.flatMap((e) => SLOTS.map((s) => item(e, s))), item('fire', 'jA'), item('leaf', 'jB')];

/** 도감 칸 '계열.자리' → 캐릭터 id. 알은 캐릭터가 아니다(null) */
export function chrIdOf(dex: string): string | null {
  const [egg, slot] = dex.split('.') as [Egg, Slot];
  if (!slot || slot === 'egg') return null;
  return `chr.${spriteOf(egg, slot)}`;
}
/** 캐릭터 id → 도트 이름 */
export const sprOfChr = (id: string) => id.replace(/^chr\./, '');
