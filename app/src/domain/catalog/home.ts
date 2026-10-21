// 뽑기 풀 — 집기 팩(상시): 가구·책상 소품·조명. 그림은 ui/gacha/packs/home.ts
import type { Item } from '../gacha';
import { desk, furn, light } from './names';

export const HOME: Item[] = [
  { id: 'furn.beanbag', kind: 'furn', rarity: '흔함', name: furn('빈백', 'Beanbag') },
  { id: 'furn.corkboard', kind: 'furn', rarity: '흔함', name: furn('코르크 게시판', 'Cork Board') },
  { id: 'furn.fridge', kind: 'furn', rarity: '흔함', name: furn('냉장고', 'Fridge') },
  { id: 'furn.monstera', kind: 'furn', rarity: '흔함', name: furn('큰 몬스테라', 'Big Monstera') },
  { id: 'furn.safe', kind: 'furn', rarity: '흔함', name: furn('금고', 'Safe') },
  { id: 'furn.pingpong', kind: 'furn', rarity: '보통', name: furn('탁구대', 'Ping Pong Table') },
  { id: 'furn.espresso', kind: 'furn', rarity: '보통', name: furn('커피 머신', 'Espresso Machine') },
  { id: 'furn.treadmill', kind: 'furn', rarity: '보통', name: furn('러닝머신 책상', 'Treadmill Desk') },
  { id: 'furn.turtletank', kind: 'furn', rarity: '보통', name: furn('거북 어항', 'Turtle Tank') },
  { id: 'furn.printer3d', kind: 'furn', rarity: '희귀', name: furn('3D 프린터', '3D Printer') },
  { id: 'furn.piano', kind: 'furn', rarity: '희귀', name: furn('피아노', 'Upright Piano') },
  { id: 'furn.crttv', kind: 'furn', rarity: '희귀', name: furn('레트로 TV', 'Retro TV') },
  { id: 'furn.serverrack', kind: 'furn', rarity: '전설', name: furn('서버 랙', 'Server Rack') },
  { id: 'furn.nappod', kind: 'furn', rarity: '전설', name: furn('낮잠 캡슐', 'Nap Pod') },

  { id: 'desk.mug', kind: 'desk', rarity: '흔함', name: desk('김 나는 머그컵', 'Steaming Mug') },
  { id: 'desk.postit', kind: 'desk', rarity: '흔함', name: desk('포스트잇 탑', 'Sticky Note Tower') },
  { id: 'desk.fidget', kind: 'desk', rarity: '흔함', name: desk('피젯 큐브', 'Fidget Cube') },
  { id: 'desk.energycan', kind: 'desk', rarity: '흔함', name: desk('에너지 드링크', 'Energy Drink') },
  { id: 'desk.minifan', kind: 'desk', rarity: '보통', name: desk('미니 선풍기', 'Mini Fan') },
  { id: 'desk.hourglass', kind: 'desk', rarity: '보통', name: desk('모래시계', 'Hourglass') },
  { id: 'desk.bonsai', kind: 'desk', rarity: '보통', name: desk('작은 분재', 'Tiny Bonsai') },
  { id: 'desk.keycap', kind: 'desk', rarity: '희귀', name: desk('은하 키캡', 'Galaxy Keycap') },
  { id: 'desk.pocketpet', kind: 'desk', rarity: '전설', name: desk('도트 펫 기계', 'Pocket Pixel Pet') },

  { id: 'light.dusk', kind: 'light', rarity: '흔함', name: light('노을빛', 'Dusk Glow') },
  { id: 'light.moonbeam', kind: 'light', rarity: '흔함', name: light('달빛 창', 'Moonbeam') },
  { id: 'light.flicker', kind: 'light', rarity: '흔함', name: light('형광등', 'Flickering Tubes') },
  { id: 'light.candles', kind: 'light', rarity: '보통', name: light('촛불', 'Candlelight') },
  { id: 'light.fireflies', kind: 'light', rarity: '보통', name: light('반딧불', 'Fireflies') },
  { id: 'light.starceil', kind: 'light', rarity: '희귀', name: light('별빛 천장', 'Starry Ceiling') },
  { id: 'light.laser', kind: 'light', rarity: '희귀', name: light('레이저 쇼', 'Laser Show') },
  { id: 'light.aurora', kind: 'light', rarity: '전설', name: light('오로라 천장', 'Aurora Ceiling') },
];
