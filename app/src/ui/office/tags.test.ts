import { describe, expect, it } from 'vitest';
import type { Spot } from './draw';
import { allTags, fewTags, MORE_W, tagBox } from './tags';
import { planOffice, type OrchIn, type Seat } from '../../domain/office';
import { newRoom } from '../../domain/officeRoom';
import { drawRoom, roomSize } from './draw';
import { FakeCtx } from './pixqa';
import { SKINS } from './skins';

const spot = (o: Partial<Spot> & { id: string }): Spot => ({ label: o.id, x: 100, y: 100, hx: 100, hy: 90, st: 'sleep', ...o });
const overlap = (a: { left: number; top: number; w: number; h: number }, b: typeof a) =>
  a.left < b.left + b.w && b.left < a.left + a.w && a.top < b.top + b.h && b.top < a.top + a.h;

describe('fewTags — 폰 방은 이름표를 다 달지 않는다', () => {
  it('사람 필요·물어봄·지금 고른 것만 이름표, 나머지(일하는 중·쉼)는 캐릭터만', () => {
    const spots = [
      spot({ id: 'h', human: '로그인', x: 50, y: 20 }),
      spot({ id: 'a', st: 'asks', x: 200, y: 20 }),
      spot({ id: 'w', st: 'working', x: 50, y: 120 }),
      spot({ id: 'i', x: 200, y: 120 }),
      spot({ id: 'p', x: 300, y: 200 }),
    ];
    expect(fewTags(spots, 'p', 1, 400).map((t) => t.id).sort()).toEqual(['a', 'h', 'p']);
    expect(fewTags(spots, null, 1, 400).map((t) => t.id).sort()).toEqual(['a', 'h']);
  });

  it('남는 이름표끼리 겹치면 위아래로 비켜 놓는다 — 결과는 서로 안 겹친다', () => {
    const spots = [
      spot({ id: 'long-schedule-planner', st: 'asks', x: 120, y: 100 }),
      spot({ id: 'photo-book', st: 'asks', x: 140, y: 104 }),
    ];
    const t = fewTags(spots, null, 1, 400);
    expect(t).toHaveLength(2);
    expect(t.every((x) => x.more === 0)).toBe(true);
    expect(overlap(t[0]!, t[1]!)).toBe(false);
  });

  it('비킬 자리가 없으면 하나만 남기고 +N — 사람 필요가 이긴다', () => {
    const spots = [
      spot({ id: 'a1', st: 'asks', x: 100, y: 100 }),
      spot({ id: 'h', human: '', x: 102, y: 100 }),
      spot({ id: 'a2', st: 'asks', x: 98, y: 100 }),
      spot({ id: 'a3', st: 'asks', x: 101, y: 102 }),
      spot({ id: 'a4', st: 'asks', x: 99, y: 99 }),
      spot({ id: 'a5', st: 'asks', x: 100, y: 101 }),
      spot({ id: 'a6', st: 'asks', x: 100, y: 100 }),
    ];
    const t = fewTags(spots, null, 1, 400);
    // 제자리·아래 두 칸·위 두 칸, 다섯 자리가 차면 나머지는 접힌다
    expect(t).toHaveLength(5);
    expect(t[0]!.id).toBe('h');
    expect(t.reduce((n, x) => n + x.more, 0)).toBe(2);
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) expect(overlap(t[i]!, t[j]!)).toBe(false);
  });

  it('이웃 둘 사이에 끼면 두 칸 밀어서라도 단다(시험 17개 — 한 칸만 보면 접혔다)', () => {
    const spots = [
      spot({ id: 'calc-app', human: '', x: 204, y: 154 }),
      spot({ id: 'mail-sum', st: 'asks', x: 170, y: 171 }),
      spot({ id: 'orchestrator', st: 'asks', x: 136, y: 188 }),
    ];
    const t = fewTags(spots, null, 1, 390);
    expect(t.map((x) => x.id)).toEqual(['calc-app', 'mail-sum', 'orchestrator']);
    expect(t.every((x) => x.more === 0)).toBe(true);
  });

  it('고른 캐릭터 이름표는 접히지 않는다(누른 걸 바로 보여야)', () => {
    const spots = [
      spot({ id: 'h1', human: '', x: 100, y: 100 }),
      spot({ id: 'h2', human: '', x: 100, y: 100 }),
      spot({ id: 'h3', human: '', x: 100, y: 100 }),
      spot({ id: 'h4', human: '', x: 100, y: 100 }),
      spot({ id: 'h5', human: '', x: 100, y: 100 }),
      spot({ id: 'p', x: 100, y: 100 }),
    ];
    expect(fewTags(spots, 'p', 1, 400).map((t) => t.id)).toContain('p');
  });

  it('배율을 곱해 화면 px 로, 방 폭 밖으로 안 나가게 가운데를 당긴다', () => {
    const [t] = fewTags([spot({ id: 'long-schedule-planner', st: 'asks', x: 5, y: 10 })], null, 2, 300);
    expect(t!.top).toBe(20);
    expect(t!.left).toBeGreaterThanOrEqual(0);
    expect(t!.left + t!.w).toBeLessThanOrEqual(300);
    expect(t!.cx).toBe(t!.left + t!.w / 2);
  });
});

describe('tagBox — 이름표 크기 어림(11px 글, 좌우 7px)', () => {
  it('한글은 영문보다 넓고, 긴 이름은 더 넓다', () => {
    expect(tagBox('백엔드 담당').w).toBeGreaterThan(tagBox('abcdef').w);
    expect(tagBox('long-schedule-planner').w).toBeGreaterThan(tagBox('notes_app').w);
    expect(tagBox('x').h).toBeGreaterThan(15);
  });
});

describe('allTags — 데스크톱 방은 이름표를 다 달되 서로 안 겹친다(11-09 사용자 "겹치는 것도 문제")', () => {
  const box = (t: { left: number; top: number; w: number; h: number; more: number }) => ({ ...t, w: t.w + (t.more ? MORE_W : 0) });
  // 11-09 화면 그대로 — 참모 7(셋은 뒷줄 제자리)·직원 6, 3단계 방
  const crowd = () => {
    const s = (id: string, status: Seat['status'] = 'working'): Seat => ({ id, label: id, project: id, status, startedAt: 0 });
    const names: [string, string][] = [['모모-2', '홍보 담당'], ['모모-8', '운영 담당'], ['참모-3', '연구 담당'], ['모모-5', '개발 담당'], ['참모', '회사 비서'], ['참모-2', '디자인 담당'], ['모모-7', '회계 담당']];
    const orchs: OrchIn[] = names.map(([name, label], i) => ({ ...s(`o${i}`, i === 6 ? 'asks' : 'done'), label, name }));
    const workers = ['acme-shop', 'pet-diary', 'todo-api', 'pixel-blog', 'cafe-site', 'photo-book'].map((p, i) => s(p, i === 1 ? 'asks' : 'working'));
    const seats = { '모모-2': { office: 0, x: 8.3, y: 1.1, w: 2.4 }, '모모-5': { office: 0, x: 0.6, y: 1.1, w: 1.6 }, '모모-7': { office: 0, x: 5.6, y: 1.1, w: 1.6 } };
    const room = planOffice({ room: { ...newRoom(), lv: 2 }, index: 0, orchs, workers, seats });
    const { W, H } = roomSize(room);
    return { spots: drawRoom(new FakeCtx(W, H) as unknown as CanvasRenderingContext2D, room, SKINS.wood!, 3), W };
  };
  it('붐비는 방(13명): 서로 겹치는 이름표 0, 빠진 사람 없음(+N 에 접힌 수 포함)', () => {
    const { spots, W } = crowd();
    expect(spots).toHaveLength(13);
    for (const scale of [2, 3, 4]) {
      const t = allTags(spots, null, scale, W * scale);
      for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) expect(overlap(box(t[i]!), box(t[j]!)), `${scale}× ${t[i]!.id} / ${t[j]!.id}`).toBe(false);
      expect(t.length + t.reduce((n, x) => n + x.more, 0)).toBe(spots.length);
    }
  });
  it('사람 필요·물어봄이 먼저 자리를 잡고, 옅은(dim) 이름표가 먼저 접힌다', () => {
    const spots = [
      spot({ id: 'dim1', x: 100, y: 100 }), spot({ id: 'mine', st: 'working', x: 100, y: 100 }),
      spot({ id: 'ask', st: 'asks', x: 100, y: 100 }), spot({ id: 'dim2', x: 100, y: 100 }),
      spot({ id: 'dim3', x: 100, y: 100 }), spot({ id: 'dim4', x: 100, y: 100 }), spot({ id: 'dim5', x: 100, y: 100 }),
    ];
    const t = allTags(spots, null, 1, 400, (id) => id.startsWith('dim'));
    expect(t[0]!.id).toBe('ask');
    expect(t.map((x) => x.id)).toContain('mine');
    expect(t.reduce((n, x) => n + x.more, 0)).toBe(2);
  });
});
