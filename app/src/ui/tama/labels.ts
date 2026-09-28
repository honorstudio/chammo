// 다마고치 화면 글자 — 위젯·페이지 공용
import { tr } from '../../i18n';
import type { Egg } from '../../domain/tama/tree';

export const STAGES = [tr('알', 'Egg'), tr('유년기 I', 'Baby I'), tr('유년기 II', 'Baby II'), tr('성장기', 'Rookie'), tr('성숙기', 'Champion'), tr('완전체', 'Perfect'), tr('궁극체', 'Ultimate')];
export const EGGS: [Egg, string, string][] = [
  ['fire', tr('불씨알', 'Ember Egg'), tr('커밋', 'Commits')],
  ['wave', tr('물결알', 'Wave Egg'), tr('맡긴 일 끝남', 'Finished tasks')],
  ['leaf', tr('잎사귀알', 'Leaf Egg'), tr('테스트·문서', 'Tests and docs')],
  ['star', tr('별알', 'Star Egg'), tr('랜덤', 'Random')],
];
export const eggName = (e: Egg) => EGGS.find(([x]) => x === e)?.[1] ?? e;
