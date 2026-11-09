// 새 캐릭터·가구·바닥 장식·벽 장식 — 데이터는 생성물(art.gen.ts), 여기선 이름만 묶는다
export { ART_ITEMS, FLOOR_SIZE, WALL_SPAN } from './art.gen';
import { FLOOR_SIZE, WALL_SPAN } from './art.gen';

export const floorSize = (id: string): [number, number] => FLOOR_SIZE[id] ?? [2, 2];
export const wallSpan = (id: string): number => WALL_SPAN[id] ?? 2;
