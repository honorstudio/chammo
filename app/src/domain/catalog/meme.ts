// 뽑기 풀 — 밈 스킨 팩(상시). 그림은 ui/gacha/packs/meme.ts
import type { Item } from '../gacha';
import { skin } from './names';

export const MEME: Item[] = [
  { id: 'skin.coffeeiv', kind: 'skin', rarity: '흔함', name: skin('커피 링거 병동', 'Coffee IV Ward') },
  { id: 'skin.montower', kind: 'skin', rarity: '흔함', name: skin('모니터 탑', 'Monitor Tower') },
  { id: 'skin.loading', kind: 'skin', rarity: '흔함', name: skin('무한 로딩 방', 'Endless Loading Room') },
  { id: 'skin.stacktrace', kind: 'skin', rarity: '흔함', name: skin('스택 트레이스 벽지', 'Stack Trace Wallpaper') },
  { id: 'skin.meetings', kind: 'skin', rarity: '흔함', name: skin('회의만 하는 회의실', 'Meetings About Meetings') },
  { id: 'skin.rubberduck', kind: 'skin', rarity: '흔함', name: skin('고무 오리 상담소', 'Rubber Duck Counseling') },
  { id: 'skin.keyshotgun', kind: 'skin', rarity: '흔함', name: skin('키보드 샷건', 'Keyboard Smash') },
  { id: 'skin.mondayblues', kind: 'skin', rarity: '흔함', name: skin('월요병 방', 'Monday Blues Room') },
  { id: 'skin.deadzombie', kind: 'skin', rarity: '보통', name: skin('마감 좀비 사무실', 'Deadline Zombie Office') },
  { id: 'skin.cameraoff', kind: 'skin', rarity: '보통', name: skin('카메라 끈 화상회의', 'Cameras-Off Call') },
  { id: 'skin.worksonmine', kind: 'skin', rarity: '보통', name: skin('내 컴에선 되는데', 'Works on My Machine') },
  { id: 'skin.nightstore', kind: 'skin', rarity: '보통', name: skin('야근 편의점', 'Late-Night Corner Store') },
  { id: 'skin.bugjungle', kind: 'skin', rarity: '보통', name: skin('버그 사냥 정글', 'Bug Hunt Jungle') },
  { id: 'skin.tabspace', kind: 'skin', rarity: '보통', name: skin('탭 대 스페이스 전쟁', 'Tabs vs Spaces War') },
  { id: 'skin.legacy', kind: 'skin', rarity: '보통', name: skin('레거시 코드 발굴장', 'Legacy Code Dig Site') },
  { id: 'skin.ghost404', kind: 'skin', rarity: '희귀', name: skin('404 유령 방', '404 Ghost Room') },
  { id: 'skin.friday', kind: 'skin', rarity: '희귀', name: skin('금요일 배포 경보', 'Friday Deploy Alarm') },
  { id: 'skin.mergewar', kind: 'skin', rarity: '희귀', name: skin('머지 충돌 전쟁터', 'Merge Conflict Battlefield') },
  { id: 'skin.inbox999', kind: 'skin', rarity: '희귀', name: skin('메일함 999+ 눈사태', 'Inbox 999+ Avalanche') },
  { id: 'skin.salarydesert', kind: 'skin', rarity: '희귀', name: skin('연봉 협상 사막', 'Salary Talk Desert') },
  { id: 'skin.serverfire', kind: 'skin', rarity: '전설', name: skin('다들 괜찮은 서버실', 'Totally Fine Server Room') },
  { id: 'skin.notibomb', kind: 'skin', rarity: '전설', name: skin('알림 폭탄', 'Notification Bomb') },
];
