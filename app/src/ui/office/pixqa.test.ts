import { describe, expect, it } from 'vitest';
import { CATALOG } from '../../domain/gacha';
import { planOffice } from '../../domain/office';
import { newRoom } from '../../domain/officeRoom';
import { drawHat, drawItem } from '../gacha/icons';
import { brush, drawRoom, pet, roomSize } from './draw';
import { FakeCtx, holes } from './pixqa';
import { SKINS, SKIN_NAMES } from './skins';

// 도트 구멍 = 칠한 화소에 둘러싸인 작은 투명 덩어리(2026-10-21 사용자 '도트에 구멍'). 큰 덩어리(일부러 뚫은 창·고리)는 pixqa.holes 가 뺀다
const asB = (c: FakeCtx) => brush(c as unknown as CanvasRenderingContext2D);

describe('도트 구멍 검사', () => {
  it('뽑기 아이템 아이콘에 구멍이 없다', () => {
    for (const c of CATALOG) {
      const cv = new FakeCtx(32, 28, 4, 4);
      drawItem(asB(cv), c.id);
      expect(holes(cv), c.id).toEqual([]);
    }
  });
  it('반장이 쓴 모자와 머리 사이에 틈이 없다', () => {
    for (const hat of CATALOG.filter((c) => c.kind === 'hat')) {
      const cv = new FakeCtx(24, 26, 4, 8);
      pet(asB(cv), SKINS.wood!, 'bear', 0, 0, '#ffd9a8');
      drawHat(asB(cv), hat.id, 0, 0);
      expect(holes(cv), hat.id).toEqual([]);
    }
  });
  it('스킨마다 방 전체(가구 전부 놓고)에 구멍이 없다 — 날씨(거품 등)는 빼고', () => {
    const seats = ['a', 'b', 'c', 'd', 'e'].map((p, i) => ({ id: p, label: p, project: `proj-${p}`, status: (['working', 'done', 'asks', 'idle', 'working'] as const)[i]!, startedAt: i }));
    const furn = CATALOG.filter((c) => c.kind === 'furn' && !c.id.startsWith('furn.a_')).map((c) => c.id); // 컬러 도트 가구는 아이콘 시험이 본다(그대로 찍는다)
    // 큰 방 뒤쪽 둘레에 가구 전부 — 시험 칸을 넉넉히(가구 도트는 방 크기와 상관없다)
    const shape = { ...newRoom(), lv: 3, zone: [1, 3] as [number, number], furn: Object.fromEntries(furn.map((id, k): [string, [number, number]] => [id, [(k % 8) + 6, (k >> 3) % 13]])) };
    const room = planOffice({ room: shape, index: 0, orchs: [{ id: 'boss', name: 'boss', label: 'boss', project: 'boss', status: 'working', startedAt: 0, spr: 'bear' }], workers: seats });
    const { W, H } = roomSize(room);
    for (const [name] of SKIN_NAMES) {
      const cv = new FakeCtx(W, H);
      drawRoom(cv as unknown as CanvasRenderingContext2D, room, { ...SKINS[name]!, weather: undefined }, 3, { deco: { desk: 'desk.duck', hat: 'hat.crown' } });
      expect(holes(cv, 12), name).toEqual([]);
    }
  });
  it('기본 8칸 방에서도 — 장식이 벽 밖·허공에 칠해지지 않는다', () => {
    const room = planOffice({ room: newRoom(), index: 0, orchs: [{ id: 'boss', name: 'boss', label: 'boss', project: 'boss', status: 'working', startedAt: 0, spr: 'bear' }], workers: [{ id: 'a', label: 'a', project: 'proj-a', status: 'working', startedAt: 1 }] });
    const { W, H, ox, oy } = roomSize(room);
    const bad: string[] = [];
    for (const [name] of SKIN_NAMES) {
      if (!SKINS[name]!.scene) continue;
      const cv = new FakeCtx(W, H);
      drawRoom(cv as unknown as CanvasRenderingContext2D, room, { ...SKINS[name]!, weather: undefined }, 3);
      if (holes(cv, 12).length) bad.push(`${name} 구멍`);
      // 방(벽 위 끝 ~ 바닥 아래 끝) 바깥 오른쪽 칸에 칠한 화소가 없어야 — 오른쪽 벽 끝은 x = ox + cols*12
      const right = Math.round(ox + room.cols * 12) + 2;
      let stray = 0;
      for (let y = 0; y < H; y++) for (let x = right; x < W; x++) if (cv.alpha(x, y) > 0.5) stray++;
      if (stray) bad.push(`${name} 오른쪽 방 밖 ${stray}`);
      void oy;
    }
    expect(bad).toEqual([]);
  });
  it('다들 괜찮은 서버실 — 벽 밑 불길이 책상·사람 높이로 안 솟는다(11-09 사용자 "불꽃이 책상과 사람을 덮어")', () => {
    const room = planOffice({ room: { ...newRoom(), lv: 2 }, index: 0, orchs: [], workers: [] });
    const { W, H, ox, oy } = roomSize(room);
    const base = SKINS.serverfire!;
    const draw = (scene: string[]) => { const cv = new FakeCtx(W, H); drawRoom(cv as unknown as CanvasRenderingContext2D, { ...room, desks: [] }, { ...base, weather: undefined, scene }, 3); return cv; };
    const a = draw(['mm-racks']), b = draw(['mm-racks', 'mm-fire']);
    const tall: number[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (a.px[i] === b.px[i] && a.px[i + 1] === b.px[i + 1] && a.px[i + 2] === b.px[i + 2]) continue;
      const z = oy + (ox - x) / 2 - y; // 왼 벽 위 높이(바닥 0)
      if (z > 6 && z < 26) tall.push(Math.round(z)); // 바닥 불씨(≤6)와 사람 머리 위 랙 꼭대기 불(≥26, 앉은 캐릭터 키 25)만
    }
    expect(tall).toEqual([]);
  });
});

