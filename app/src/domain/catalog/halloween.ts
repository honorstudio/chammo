// 할로윈 한정(EVENTS.halloween2026 — 11/15 23:59 까지만 뽑기에 나온다). 그림은 ui/gacha/packs/halloween
// 등급: 흔함 12 · 보통 10 · 희귀 5 · 전설 3 — 기간 중 어느 등급을 굴려도 할로윈이 나오게 네 등급 다
import type { Item } from '../gacha';
import { desk, furn, fx, hat, light, skin, title, view } from './names';

const H = 'halloween2026' as const;

export const HALLOWEEN: Item[] = [
  { id: 'skin.pumpkinpatch', kind: 'skin', rarity: '흔함', name: skin('호박밭', 'Pumpkin Patch'), limited: H },
  { id: 'skin.graveyard', kind: 'skin', rarity: '흔함', name: skin('달밤 묘지', 'Moonlit Graveyard'), limited: H },
  { id: 'skin.candycorn', kind: 'skin', rarity: '흔함', name: skin('사탕 옥수수', 'Candy Corn'), limited: H },
  { id: 'skin.blackcat', kind: 'skin', rarity: '흔함', name: skin('검은 고양이 골목', 'Black Cat Alley'), limited: H },
  { id: 'skin.cobweb', kind: 'skin', rarity: '흔함', name: skin('거미줄 다락', 'Cobweb Attic'), limited: H },
  { id: 'skin.witchhut', kind: 'skin', rarity: '보통', name: skin('마녀의 오두막', "Witch's Hut"), limited: H },
  { id: 'skin.potionlab', kind: 'skin', rarity: '보통', name: skin('물약 실험실', 'Potion Lab'), limited: H },
  { id: 'skin.mummytomb', kind: 'skin', rarity: '보통', name: skin('미라 무덤', 'Mummy Tomb'), limited: H },
  { id: 'skin.ghostship', kind: 'skin', rarity: '보통', name: skin('유령선', 'Ghost Ship'), limited: H },
  { id: 'skin.lanternsquare', kind: 'skin', rarity: '희귀', name: skin('잭오랜턴 광장', "Jack-o'-Lantern Square"), limited: H },
  { id: 'skin.hauntedmanor', kind: 'skin', rarity: '희귀', name: skin('유령 저택', 'Haunted Manor'), limited: H },
  { id: 'skin.skeletonball', kind: 'skin', rarity: '희귀', name: skin('해골 무도회', 'Skeleton Ball'), limited: H },
  { id: 'skin.vampirecastle', kind: 'skin', rarity: '전설', name: skin('흡혈귀 성', 'Vampire Castle'), limited: H },
  { id: 'skin.bloodmoon', kind: 'skin', rarity: '전설', name: skin('핏빛 달밤', 'Blood Moon Night'), limited: H },
  { id: 'hat.horns', kind: 'hat', rarity: '흔함', name: hat('작은 뿔', 'Little Horns'), limited: H },
  { id: 'hat.batband', kind: 'hat', rarity: '흔함', name: hat('박쥐 머리띠', 'Bat Headband'), limited: H },
  { id: 'hat.witch', kind: 'hat', rarity: '보통', name: hat('마녀 모자', 'Witch Hat'), limited: H },
  { id: 'hat.pumpkinhead', kind: 'hat', rarity: '희귀', name: hat('호박 머리', 'Pumpkin Head'), limited: H },
  { id: 'furn.pumpkins', kind: 'furn', rarity: '흔함', name: furn('호박 더미', 'Pumpkin Pile'), limited: H },
  { id: 'furn.cauldron', kind: 'furn', rarity: '보통', name: furn('마녀 솥', "Witch's Cauldron"), limited: H },
  { id: 'furn.coffin', kind: 'furn', rarity: '전설', name: furn('흡혈귀 관', 'Vampire Coffin'), limited: H },
  { id: 'window.batswarm', kind: 'window', rarity: '흔함', name: view('박쥐 떼', 'Bat Swarm'), limited: H },
  { id: 'window.bloodmoon', kind: 'window', rarity: '보통', name: view('핏빛 보름달', 'Blood Moon'), limited: H },
  { id: 'light.floatcandles', kind: 'light', rarity: '흔함', name: light('떠다니는 촛불', 'Floating Candles'), limited: H },
  { id: 'light.jacklights', kind: 'light', rarity: '보통', name: light('호박 등', 'Pumpkin Lights'), limited: H },
  { id: 'fx.bats', kind: 'fx', rarity: '보통', name: fx('박쥐', 'Bats'), limited: H },
  { id: 'fx.ghosts', kind: 'fx', rarity: '희귀', name: fx('유령', 'Ghosts'), limited: H },
  { id: 'title.pumpkinboss', kind: 'title', rarity: '흔함', name: title('호박 대장', 'Pumpkin Boss'), limited: H },
  { id: 'title.candybug', kind: 'title', rarity: '보통', name: title('사탕 아니면 버그', 'Treat or Bug'), limited: H },
  { id: 'desk.candybowl', kind: 'desk', rarity: '흔함', name: desk('사탕 바구니', 'Candy Pail'), limited: H },
];
