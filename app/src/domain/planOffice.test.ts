import { describe, expect, it } from 'vitest';
import { arrival, catWalk, colorFor, defaultSeats, planOffice, poolOrchs, speciesFor, wallAt, type OrchIn, type Seat } from './office';
import { LEVELS, newRoom, roomDims, seatCount, type OfficeRoom } from './officeRoom';

const seat = (id: string, project = id): Seat => ({ id, label: id, project, status: 'working', startedAt: 0 });
const orch = (name: string, o: Partial<OrchIn> = {}): OrchIn => ({ ...seat(`o-${name}`, 'hq'), label: name, name, ...o });
const room = (o: Partial<OfficeRoom> = {}): OfficeRoom => ({ ...newRoom(), ...o });
const plan = (x: Partial<Parameters<typeof planOffice>[0]> = {}) => planOffice({ room: room(), index: 0, orchs: [], workers: [], ...x });

describe('planOffice — 사무실 한 칸을 그릴 재료로', () => {
  it('방 크기는 단계대로, 왼쪽 벽에 문이 있다', () => {
    LEVELS.forEach((_, lv) => {
      const r = plan({ room: room({ lv }) });
      expect([r.cols, r.rows]).toEqual(roomDims(lv));
      expect(r.door).toBe(true);
    });
  });

  it('첫 참모가 반장(뒷줄 가운데 큰 책상), 둘째·셋째는 옆자리', () => {
    const r = plan({ orchs: [orch('a'), orch('b'), orch('c')] });
    const [a, b, c] = ['o-a', 'o-b', 'o-c'].map((id) => r.desks.find((d) => d.id === id)!);
    expect(a).toMatchObject({ boss: true, gx: 2.8, gy: 1.1, w: 2.4 });
    expect(b).toMatchObject({ gx: 0.6, gy: 1.1, w: 1.6 });
    expect(c).toMatchObject({ gx: 5.6, gy: 1.1, w: 1.6 });
    expect(b!.boss).toBeUndefined();
  });

  it('꺼진 참모 자리는 빈 책상 + 이름표', () => {
    const r = plan({ orchs: [orch('a', { off: true })] });
    expect(r.desks.find((d) => d.id === 'o-a')).toMatchObject({ empty: true, off: true, label: 'a' });
  });

  it('고른 캐릭터로 앉고, 안 골랐으면 그 이름의 랜덤', () => {
    const r = plan({ orchs: [orch('a', { spr: 'a_bunny' }), orch('b')] });
    expect(r.desks.find((d) => d.id === 'o-a')!.spr).toBe('a_bunny');
    expect(r.desks.find((d) => d.id === 'o-b')!.spr).toBe(speciesFor('b'));
  });

  it('색은 캐릭터마다 — 같은 캐릭터면 같은 색', () => {
    const r = plan({ orchs: [orch('a', { spr: 'fire_cG' }), orch('b', { spr: 'fire_cG' })] });
    const [a, b] = r.desks;
    expect(a!.color).toBe(colorFor('fire_cG'));
    expect(b!.color).toBe(a!.color);
  });

  it('넷째 참모부터는 직원 자리에 앉는다', () => {
    const r = plan({ orchs: ['a', 'b', 'c', 'd'].map((n) => orch(n)) });
    const d = r.desks.find((x) => x.id === 'o-d')!;
    expect(d.gy).toBeGreaterThanOrEqual(3);
    expect(d.spr).toBe(speciesFor('d'));
  });

  it('자리를 정한 참모는 그 사무실 그 자리에만', () => {
    const seats = { a: { office: 1, x: 6.2, y: 3.1 } };
    const one = plan({ orchs: [orch('a'), orch('b')], seats, index: 1 });
    expect(one.desks.find((d) => d.id === 'o-a')).toMatchObject({ gx: 6.2, gy: 3.1, boss: true, w: 2.4 });
    expect(one.desks.some((d) => d.id === 'o-b')).toBe(false);
    const zero = plan({ orchs: [orch('a'), orch('b')], seats, index: 0 });
    expect(zero.desks.some((d) => d.id === 'o-a')).toBe(false);
    expect(zero.desks.find((d) => d.id === 'o-b')).toMatchObject({ gx: 0.6 });
  });

  it('뒷줄 기본 자리는 누가 정해 앉은 자리를 피한다', () => {
    const seats = { a: { office: 0, x: 2.8, y: 1.1, w: 2.4 }, b: { office: 0, x: 0.6, y: 1.1 } };
    const r = plan({ orchs: [orch('a'), orch('b'), orch('c'), orch('d')], seats });
    expect(r.desks.find((d) => d.id === 'o-c')).toMatchObject({ gx: 5.6, gy: 1.1 });
    expect(r.desks.find((d) => d.id === 'o-d')!.gy).toBeGreaterThanOrEqual(3); // 뒷줄이 찼다
    expect(poolOrchs([orch('a'), orch('b'), orch('c'), orch('d')], seats).map((o) => o.name)).toEqual(['d']);
    expect(defaultSeats([orch('a')], {}).get('a')).toEqual({ x: 2.8, y: 1.1, w: 2.4 });
  });

  it('책상 폭은 정한 자리에 적힌 대로 — 반장이 바뀌어도 책상이 커지지 않는다', () => {
    const r = plan({ orchs: [orch('b'), orch('a')], seats: { b: { office: 0, x: 0.6, y: 1.1, w: 1.6 }, a: { office: 0, x: 2.8, y: 1.1, w: 2.4 } } });
    expect(r.desks.find((d) => d.id === 'o-b')).toMatchObject({ boss: true, w: 1.6 });
    expect(r.desks.find((d) => d.id === 'o-a')).toMatchObject({ w: 2.4 });
  });

  it('직원 자리는 늘 책상이 있고, 비면 빈 책상', () => {
    const r = plan({ workers: [seat('w1')] });
    const seats = r.desks.filter((d) => !d.boss && d.gy >= 3);
    expect(seats).toHaveLength(seatCount(0));
    expect(seats.filter((d) => d.empty)).toHaveLength(seatCount(0) - 1);
    expect(seats[0]).toMatchObject({ gx: 1.2, gy: 3, w: 1.6 });
  });

  it('자리표대로 앉는다 — null 은 빈 책상', () => {
    const r = plan({ workers: [seat('w1'), seat('w2')], slots: [null, 'w2', 'w1'] });
    const at = (x: number, y: number) => r.desks.find((d) => d.gx === x && d.gy === y)!;
    expect(at(1.2, 3).empty).toBe(true);
    expect(at(4.2, 3).id).toBe('w2');
    expect(at(1.2, 5).id).toBe('w1');
  });

  it('자리가 모자라면 남은 직원은 문 앞에 서고 몇 명 모자란지 알려 준다', () => {
    const r = plan({ workers: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map((w) => seat(w)) });
    const standing = r.desks.filter((d) => d.stand);
    expect(standing.map((d) => d.id)).toEqual(['w5', 'w6']);
    expect(r.short).toBe(2);
    expect(standing[0]!.gx).toBe(0.5);
    expect(standing[1]!.gy).toBeLessThan(standing[0]!.gy);
  });

  it('자리가 많이 모자라면 문 앞엔 둘만 서고 나머지는 +N 으로 접힌다 — 겹겹이 쌓이지 않게(11-09 사용자)', () => {
    const r = plan({ workers: Array.from({ length: 10 }, (_, i) => seat(`w${String(i + 1).padStart(2, '0')}`)) });
    const standing = r.desks.filter((d) => d.stand);
    expect(standing).toHaveLength(6); // 현황판엔 다 남는다
    const shown = standing.filter((d) => !d.tuck);
    expect(shown.map((d) => d.id)).toEqual(['w05', 'w06']);
    expect(shown[1]!.more).toBe(4);
    expect(shown[0]!.more).toBeUndefined();
    expect(Math.abs(shown[0]!.gy - shown[1]!.gy)).toBeGreaterThanOrEqual(1); // 서로 안 겹치게 한 칸 이상
    expect(r.short).toBe(6);
    expect(r.used).toBe(10);
  });

  it('빈 자리가 생기면 서 있던 직원이 앉는다', () => {
    const r = plan({ workers: ['w2', 'w3', 'w4', 'w5'].map((w) => seat(w)), slots: ['gone', 'w2', 'w3', 'w4', 'w5'] });
    expect(r.desks.filter((d) => d.stand)).toEqual([]);
    expect(r.short).toBe(0);
    expect(r.desks.find((d) => d.id === 'w5')).toMatchObject({ gx: 1.2, gy: 3 });
  });

  it('가구·바닥 장식·벽 장식이 방에 실린다', () => {
    const r = plan({ room: room({ furn: { 'furn.a': [7, 3] }, floor: [{ id: 'floor.x', x: 2, y: 3 }], wall: [{ id: 'wall.y', side: 'R', at: 6 }] }) });
    expect(r.furniture).toEqual([{ id: 'furn.a', gx: 7, gy: 3 }]);
    expect(r.floor).toEqual([{ id: 'floor.x', x: 2, y: 3 }]);
    expect(r.wall).toEqual([{ id: 'wall.y', side: 'R', at: 6 }]);
  });

  it('고양이는 넓힌 방에서도 방 안을 걷는다', () => {
    const r = plan({ room: room({ lv: 3 }) });
    for (let t = 0; t < 30_000; t += 1000) {
      const { at } = catWalk(r, t);
      expect(at[0]).toBeGreaterThanOrEqual(0);
      expect(at[0]).toBeLessThanOrEqual(r.cols);
      expect(at[1]).toBeLessThanOrEqual(r.rows);
    }
  });
});

describe('wallAt — 벽 칸 고르기', () => {
  it('뒤 벽·왼 벽을 가른다', () => {
    const r = { cols: 8, rows: 7 }, ox = 96, oy = 50;
    expect(wallAt(r, ox, oy, ox + 6.5 * 12, oy + 6.5 * 6 - 20)).toEqual({ side: 'R', at: 6 });
    expect(wallAt(r, ox, oy, ox - 2.5 * 12, oy + 2.5 * 6 - 20)).toEqual({ side: 'L', at: 2 });
    expect(wallAt(r, ox, oy, ox, oy + 80)).toBeNull();
  });
});

describe('출근 — 문에서 걸어와 앉는다', () => {
  const r = plan({ workers: [seat('w1')] });
  it('처음엔 문 앞, 끝나면 자기 책상 앞', () => {
    const d = r.desks.find((x) => x.id === 'w1')!;
    const a = arrival(r, 'w1', 0)!;
    expect(a.awayId).toBe('w1');
    expect(a.at[0]).toBeLessThan(1);
    expect(a.at[1]).toBeCloseTo(r.rows - 1.55, 1);
    const end = arrival(r, 'w1', 2999)!;
    expect(Math.abs(end.at[0] - (d.gx + d.w / 2))).toBeLessThan(0.5);
    expect(arrival(r, 'w1', 3100)).toBeNull();
  });
  it('서 있는 직원·없는 책상은 걷지 않는다', () => {
    const s = plan({ workers: ['a', 'b', 'c', 'd', 'e'].map((w) => seat(w)) });
    expect(arrival(s, 'e', 0)).toBeNull();
    expect(arrival(s, 'nobody', 0)).toBeNull();
  });
});

describe('붐비는 방 — 11-09 사용자 화면(참모 7·직원 6, 3단계 방)', () => {
  const names = ['모모-2', '모모-8', '참모-3', '모모-5', '참모', '참모-2', '모모-7'];
  const seats = { '모모-2': { office: 0, x: 8.3, y: 1.1, w: 2.4 }, '모모-5': { office: 0, x: 0.6, y: 1.1, w: 1.6 }, '모모-7': { office: 0, x: 5.6, y: 1.1, w: 1.6 } };
  const r = plan({ room: room({ lv: 2 }), orchs: names.map((n) => orch(n)), seats, workers: ['a', 'b', 'c', 'd', 'e', 'f'].map((w) => seat(w)) });
  it('자리 수는 직원 자리 기준 — 뒷줄에 제자리가 있는 참모는 세지 않는다(13/12 가 아니라 10/12, 넘침 없음)', () => {
    expect(r.used).toBe(10);
    expect(r.short).toBe(0);
    expect(seatCount(2)).toBe(12);
  });
  it('사람끼리 같은 자리에 겹쳐 앉지 않는다', () => {
    const at = r.desks.filter((d) => !d.empty && !d.tuck).map((d) => [d.gx + d.w / 2, d.gy] as const);
    for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) {
      const [a, b] = [at[i]!, at[j]!];
      expect(Math.abs(a[0] - b[0]) >= 1.5 || Math.abs(a[1] - b[1]) >= 1, `${i}-${j}`).toBe(true);
    }
  });
});
