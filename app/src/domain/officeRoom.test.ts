import { describe, expect, it } from 'vitest';
import { canHangWall, canMoveOrch, freeDeskCell, canMoveZone, canPlaceFloor, canPlaceFurn, expandPrice, interiorCells, LEVELS, MAX_LEVEL, newRoom, officePrice, parseRoom, roomDims, seatCount, seatsOf, wallSlots, zoneSize, type OfficeRoom, type OrchDesk } from './officeRoom';

const size = (id: string): [number, number] => (id === 'floor.big' ? [4, 3] : [3, 2]);
const span = (id: string) => (id === 'wall.wide' ? 3 : 2);
const backRow: OrchDesk[] = [{ id: 'a', x: 2.8, y: 1.1, w: 2.4 }, { id: 'b', x: 0.6, y: 1.1, w: 1.6 }];
const room = (over: Partial<OfficeRoom> = {}): OfficeRoom => ({ ...newRoom(), ...over });

describe('사무실 크기 — 기본 + 확장 3단계', () => {
  it('값은 1,000 → 1,500 → 3,000, 끝이면 없음', () => {
    expect([0, 1, 2].map(expandPrice)).toEqual([1000, 1500, 3000]);
    expect(expandPrice(3)).toBeNull();
    expect(MAX_LEVEL).toBe(3);
  });
  it('사무실 추가는 최대 3개 — 2번째 2,000, 3번째 10,000', () => {
    expect(officePrice(1)).toBe(2000);
    expect(officePrice(2)).toBe(10000);
    expect(officePrice(3)).toBeNull();
  });
  it('칸 수·직원 자리 — 제안값 그대로', () => {
    expect(LEVELS.map((_, lv) => [...roomDims(lv), seatCount(lv)])).toEqual([[8, 7, 4], [10, 8, 6], [12, 10, 12], [14, 13, 20]]);
  });
  it('인테리어 칸·벽 칸은 넓힐수록 는다', () => {
    const inter = LEVELS.map((_, lv) => interiorCells(lv));
    const wall = LEVELS.map((_, lv) => wallSlots(lv));
    expect(inter).toEqual([...inter].sort((a, b) => a - b));
    expect(wall).toEqual([...wall].sort((a, b) => a - b));
    expect(inter[0]).toBeGreaterThan(0);
  });
  it('직원 책상 묶음은 방 안에 들어간다(모든 단계)', () => {
    LEVELS.forEach((_, lv) => {
      const [c, r] = roomDims(lv), [w, h] = zoneSize(lv), z = newRoom().zone;
      expect(z[0] + w).toBeLessThanOrEqual(c);
      expect(z[1] + h).toBeLessThanOrEqual(r);
    });
  });
});

describe('seatsOf — 직원 자리', () => {
  it('묶음 왼쪽 위에서 3칸·2칸 간격으로, 단계 자리 수만큼', () => {
    const s = seatsOf(room());
    expect(s).toHaveLength(4);
    expect(s[0]).toEqual([1, 3]);
    expect(s[1]).toEqual([4, 3]);
    expect(s[2]).toEqual([1, 5]);
  });
  it('묶음을 옮기면 자리도 같이', () => {
    expect(seatsOf(room({ zone: [2, 3] }))[0]).toEqual([2, 3]);
  });
});

describe('가구 — 바닥 한 칸', () => {
  it('빈 칸엔 놓고, 직원 자리·참모 책상·고정 소품·다른 가구 위엔 못 놓는다', () => {
    const r = room({ furn: { 'furn.a': [7, 4] } });
    expect(canPlaceFurn(r, [], 'furn.b', [6, 5])).toBe(true);
    expect(canPlaceFurn(r, [], 'furn.b', [1, 3])).toBe(false); // 직원 자리
    expect(canPlaceFurn(r, backRow, 'furn.b', [3, 1])).toBe(false); // 참모 책상
    expect(canPlaceFurn(r, [], 'furn.b', [6, 0])).toBe(false); // 책장
    expect(canPlaceFurn(r, [], 'furn.b', [7, 4])).toBe(false); // 다른 가구
  });
  it('자기 자리로는 다시 놓을 수 있고, 방 밖은 안 된다', () => {
    const r = room({ furn: { 'furn.a': [7, 4] } });
    expect(canPlaceFurn(r, [], 'furn.a', [7, 4])).toBe(true);
    expect(canPlaceFurn(r, [], 'furn.a', [8, 4])).toBe(false);
    expect(canPlaceFurn(r, [], 'furn.a', [0, -1])).toBe(false);
  });
  it('직원 자리 옆 통로 칸엔 놓을 수 있다(한 자리 2×2칸 + 옆 1칸)', () => {
    expect(canPlaceFurn(room(), [], 'furn.a', [3, 3])).toBe(true);
  });
  it('바닥 장식 위엔 놓을 수 있다', () => {
    expect(canPlaceFurn(room({ floor: [{ id: 'floor.x', x: 6, y: 4 }] }), [], 'furn.a', [6, 5])).toBe(true);
  });
});

describe('바닥 장식 — 새 층', () => {
  it('책상·가구 아래에 깔 수 있다', () => {
    const r = room({ furn: { 'furn.a': [6, 4] } });
    expect(canPlaceFloor(r, 'floor.x', [1, 3], size)).toBe(true); // 직원 자리 아래
    expect(canPlaceFloor(r, 'floor.x', [5, 4], size)).toBe(true); // 가구 아래
  });
  it('바닥 장식끼리는 한 칸도 못 겹친다', () => {
    const r = room({ floor: [{ id: 'floor.x', x: 1, y: 1 }] });
    expect(canPlaceFloor(r, 'floor.y', [3, 2], size)).toBe(false); // 3×2 끝에 걸침
    expect(canPlaceFloor(r, 'floor.y', [4, 1], size)).toBe(true); // 맞닿기만
    expect(canPlaceFloor(r, 'floor.x', [2, 1], size)).toBe(true); // 자기 옮기기는 자기와 안 겹침
  });
  it('방 밖으로 나가면 안 된다', () => {
    expect(canPlaceFloor(room(), 'floor.big', [5, 0], size)).toBe(false);
    expect(canPlaceFloor(room(), 'floor.x', [5, 5], size)).toBe(true);
    expect(canPlaceFloor(room(), 'floor.x', [6, 6], size)).toBe(false);
  });
});

describe('벽 장식 — 바닥 칸을 안 먹는다', () => {
  it('벽 칸에 걸리고 가구 자리를 막지 않는다', () => {
    const r = room({ wall: [{ id: 'wall.a', side: 'L', at: 0 }] });
    expect(canPlaceFurn(r, [], 'furn.a', [6, 5])).toBe(true);
    expect(canHangWall(r, 'wall.b', 'R', 5, span)).toBe(true);
  });
  it('벽 장식끼리·창문·시계·문 자리는 못 건다', () => {
    const r = room({ wall: [{ id: 'wall.a', side: 'L', at: 0 }] });
    expect(canHangWall(r, 'wall.b', 'L', 1, span)).toBe(false); // 2칸짜리끼리 겹침
    expect(canHangWall(r, 'wall.b', 'R', 2, span)).toBe(false); // 창문
    const [, rows] = roomDims(0);
    expect(canHangWall(r, 'wall.b', 'L', rows - 2, span)).toBe(false); // 문
  });
  it('벽 끝을 넘어가면 안 된다', () => {
    const [cols] = roomDims(0);
    expect(canHangWall(room(), 'wall.wide', 'R', cols - 2, span)).toBe(false);
    expect(canHangWall(room(), 'wall.a', 'R', cols - 2, span)).toBe(true);
  });
});

describe('직원 묶음·참모 책상 옮기기', () => {
  it('묶음은 방 안, 가구·참모 책상과 안 겹칠 때만(바닥 장식은 상관없음)', () => {
    expect(canMoveZone(room(), [], [2, 3])).toBe(true);
    expect(canMoveZone(room(), [], [4, 3])).toBe(false); // 방 밖으로
    expect(canMoveZone(room({ furn: { 'furn.a': [5, 3] } }), [], [2, 3])).toBe(false);
    expect(canMoveZone(room({ floor: [{ id: 'floor.x', x: 2, y: 3 }] }), [], [2, 3])).toBe(true);
    expect(canMoveZone(room(), [{ id: 'a', x: 2.2, y: 3, w: 1.6 }], [2, 3])).toBe(false);
  });
  it('참모 책상은 빈 칸에만, 자기 자리는 빼고 본다', () => {
    expect(canMoveOrch(room(), backRow, 'a', [3, 1], 2.4)).toBe(true); // 자기 자리 근처
    expect(canMoveOrch(room(), backRow, 'a', [0, 1], 2.4)).toBe(false); // b 와 겹침
    expect(canMoveOrch(room(), [], 'a', [1, 3], 1.6)).toBe(false); // 직원 자리
    expect(canMoveOrch(room(), [], 'a', [6, 5], 1.6)).toBe(true);
    expect(canMoveOrch(room(), [], 'a', [7, 5], 1.6)).toBe(false); // 방 밖으로
  });
});

describe('parseRoom — 파일에서 읽기', () => {
  it('모양이 틀린 칸은 버리고 기본값으로', () => {
    expect(parseRoom(null)).toEqual(newRoom());
    expect(parseRoom({ lv: 9, zone: 'x', furn: { a: [1, 'b'], b: [2, 3] }, floor: [{ id: 'floor.x', x: 1, y: 1 }, { id: 3 }], wall: [{ id: 'wall.a', side: 'Q', at: 1 }, { id: 'wall.b', side: 'R', at: 5 }], skin: 'mint' }))
      .toEqual({ lv: 3, zone: newRoom().zone, furn: { b: [2, 3] }, floor: [{ id: 'floor.x', x: 1, y: 1 }], wall: [{ id: 'wall.b', side: 'R', at: 5 }], skin: 'mint' });
  });
});

describe('freeDeskCell — 다른 사무실로 옮길 자리', () => {
  it('빈 방이면 뒤쪽 첫 칸, 꽉 차면 null', () => {
    const c = freeDeskCell(room(), [], 'o', 1.6)!;
    expect(canMoveOrch(room(), [], 'o', c, 1.6)).toBe(true);
    const full: Record<string, [number, number]> = {};
    for (let x = 0; x < 8; x++) for (let y = 0; y < 7; y++) full[`f${x}-${y}`] = [x, y];
    expect(freeDeskCell(room({ furn: full }), [], 'o', 1.6)).toBeNull();
  });
});
