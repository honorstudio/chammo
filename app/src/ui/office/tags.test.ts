import { describe, expect, it } from 'vitest';
import type { Spot } from './draw';
import { fewTags, tagBox } from './tags';

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
      spot({ id: 'honor-orchestrator', st: 'asks', x: 140, y: 104 }),
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
