// 뽑기 풀 — 꾸밈 팩(상시): 모자·창밖·펑 대신·칭호·반장 액션·펫 친구. 그림은 ui/gacha/packs/pals.ts
import type { Item } from '../gacha';
import { fx, hat, move, pal, title, view } from './names';

export const PALS: Item[] = [
  { id: 'hat.cap', kind: 'hat', rarity: '흔함', name: hat('야구모자', 'Baseball Cap') },
  { id: 'hat.party', kind: 'hat', rarity: '흔함', name: hat('파티 고깔', 'Party Hat') },
  { id: 'hat.sprout', kind: 'hat', rarity: '흔함', name: hat('머리 위 새싹', 'Head Sprout') },
  { id: 'hat.flower', kind: 'hat', rarity: '보통', name: hat('꽃 화관', 'Flower Crown') },
  { id: 'hat.detective', kind: 'hat', rarity: '보통', name: hat('탐정 모자', 'Detective Hat') },
  { id: 'hat.chef', kind: 'hat', rarity: '희귀', name: hat('요리사 모자', 'Chef Hat') },
  { id: 'hat.pirate', kind: 'hat', rarity: '희귀', name: hat('해적 모자', 'Pirate Hat') },
  { id: 'hat.space', kind: 'hat', rarity: '전설', name: hat('우주 헬멧', 'Space Helmet') },

  { id: 'window.sea', kind: 'window', rarity: '흔함', name: view('바닷가 파도', 'Seaside Waves') },
  { id: 'window.plane', kind: 'window', rarity: '흔함', name: view('비행기 구름', 'Contrail') },
  { id: 'window.sunflower', kind: 'window', rarity: '흔함', name: view('해바라기 밭', 'Sunflower Field') },
  { id: 'window.balloon', kind: 'window', rarity: '보통', name: view('열기구', 'Hot Air Balloon') },
  { id: 'window.peak', kind: 'window', rarity: '보통', name: view('눈 덮인 산', 'Snowy Peaks') },
  { id: 'window.whale', kind: 'window', rarity: '희귀', name: view('하늘 고래', 'Sky Whale') },
  { id: 'window.storm', kind: 'window', rarity: '희귀', name: view('번개 폭풍', 'Thunderstorm') },
  { id: 'window.galaxy', kind: 'window', rarity: '전설', name: view('은하수', 'Milky Way') },

  { id: 'fx.stardust', kind: 'fx', rarity: '흔함', name: fx('별가루', 'Stardust') },
  { id: 'fx.bubble', kind: 'fx', rarity: '흔함', name: fx('비눗방울', 'Soap Bubbles') },
  { id: 'fx.coin', kind: 'fx', rarity: '보통', name: fx('동전 폭발', 'Coin Burst') },
  { id: 'fx.leaf', kind: 'fx', rarity: '보통', name: fx('나뭇잎', 'Leaf Swirl') },
  { id: 'fx.note', kind: 'fx', rarity: '희귀', name: fx('음표', 'Music Notes') },
  { id: 'fx.glitch', kind: 'fx', rarity: '전설', name: fx('픽셀 글리치', 'Pixel Glitch') },

  { id: 'title.tdd', kind: 'title', rarity: '흔함', name: title('테스트 먼저', 'Test First') },
  { id: 'title.rollback', kind: 'title', rarity: '흔함', name: title('롤백 장인', 'Rollback Pro') },
  { id: 'title.inbox', kind: 'title', rarity: '흔함', name: title('인박스 제로', 'Inbox Zero') },
  { id: 'title.hotfix', kind: 'title', rarity: '보통', name: title('핫픽스 소방관', 'Hotfix Firefighter') },
  { id: 'title.refactor', kind: 'title', rarity: '보통', name: title('리팩토링 요정', 'Refactor Fairy') },
  { id: 'title.poet', kind: 'title', rarity: '희귀', name: title('주석 시인', 'Comment Poet') },
  { id: 'title.offwork', kind: 'title', rarity: '희귀', name: title('야근 면제', 'No Overtime') },
  { id: 'title.friday', kind: 'title', rarity: '전설', name: title('금요배포 생존자', 'Friday Deploy Survivor') },

  { id: 'action.stretch', kind: 'action', rarity: '흔함', name: move('기지개', 'Big Stretch') },
  { id: 'action.doze', kind: 'action', rarity: '흔함', name: move('졸다가 깸', 'Doze and Jolt') },
  { id: 'action.phone', kind: 'action', rarity: '보통', name: move('전화 통화', 'Phone Call') },
  { id: 'action.juggle', kind: 'action', rarity: '희귀', name: move('저글링', 'Juggling') },
  { id: 'action.highfive', kind: 'action', rarity: '전설', name: move('하이파이브', 'High Five') },

  { id: 'friend.dog', kind: 'friend', rarity: '흔함', name: pal('강아지', 'Puppy') },
  { id: 'friend.hamster', kind: 'friend', rarity: '흔함', name: pal('햄스터', 'Hamster') },
  { id: 'friend.turtle', kind: 'friend', rarity: '보통', name: pal('거북이', 'Turtle') },
  { id: 'friend.parrot', kind: 'friend', rarity: '희귀', name: pal('앵무새', 'Parrot') },
  { id: 'friend.robovac', kind: 'friend', rarity: '전설', name: pal('로봇 청소기', 'Robot Vacuum') },
];
