import { describe, expect, it } from 'vitest';
import { kidsToday, kidsTodayLine } from './kidsToday';

const day = new Date(2026, 10, 18).getTime();
const at = (h: number, m = 0) => day + (h * 60 + m) * 60_000;
const row = (ts: number, who: string, text: string) => ({ ts, who, text });

describe("보호자 '오늘 만든 것' 카드(계획서 H — 작품·고친 과정·쓴 시간)", () => {
  it('오늘 만들기·고치기 줄을 작품마다 차례대로 모은다 — 최근 작품이 먼저, 어제 것은 뺀다', () => {
    const rows = [
      row(day - 3_600_000, 'app', '만들기 old: 어제 그림'),
      row(at(9), 'kid', '공룡 만들어 줘'),
      row(at(9, 1), 'app', '만들기 dino: 공룡이 점프하는 게임'),
      row(at(9, 5), 'app', '고치기 dino: 두 마리로'),
      row(at(9, 8), 'app', '만들기 cloud: 구름 애니메이션'),
      row(at(9, 9), 'app', '고치기 dino: 빨간색으로'),
    ];
    const works = [{ name: 'dino', title: '공룡 점프', mtime: at(9, 9) }, { name: 'cloud', title: '구름', mtime: at(9, 8) }, { name: 'old', title: '어제 것', mtime: day - 3_600_000 }];
    const t = kidsToday(rows, works, { usedMs: 12 * 60_000, limitMs: 20 * 60_000 }, day)!;
    expect(t.works.map((w) => w.name)).toEqual(['dino', 'cloud']);
    expect(t.works[0]).toEqual({ name: 'dino', title: '공룡 점프', steps: ['공룡이 점프하는 게임', '두 마리로', '빨간색으로'] });
    expect(t.usedMin).toBe(12);
    expect(t.talks).toBe(1);
  });

  it('줄은 짧게 — 한 단계 24자, 작품마다 단계 6개까지(앞 하나 + 뒤 다섯)', () => {
    const rows = Array.from({ length: 9 }, (_, i) => row(at(10, i), 'app', `${i ? '고치기' : '만들기'} a: ${i}번째 ${'아주 긴 말'.repeat(i === 1 ? 10 : 1)}`));
    const t = kidsToday(rows, [{ name: 'a', title: 'A', mtime: at(10, 9) }], undefined, day)!;
    expect(t.works[0]!.steps.length).toBe(6);
    expect(t.works[0]!.steps[0]).toBe('0번째 아주 긴 말');
    expect(t.works[0]!.steps.every((s) => [...s].length <= 24)).toBe(true);
  });

  it('오늘 한 게 없으면 카드 없음, 말만 했으면 시간·말 수만', () => {
    expect(kidsToday([row(day - 1, 'kid', '어제 말')], [], undefined, day)).toBeNull();
    const t = kidsToday([row(at(8), 'kid', '안녕'), row(at(8, 1), 'assistant', '안녕!')], [], { usedMs: 3 * 60_000, limitMs: 20 * 60_000 }, day)!;
    expect(t.works).toEqual([]);
    expect(t.talks).toBe(1);
  });

  it('접힌 한 줄 — 아이 이름 · 쓴 시간 · 가장 최근 작품의 고친 과정', () => {
    const t = { works: [{ name: 'dino', title: '공룡 점프', steps: ['공룡 점프 게임', '두 마리로', '빨간색'] }, { name: 'c', title: '구름', steps: [] }], usedMin: 12, limitMin: 20, talks: 4 };
    expect(kidsTodayLine(t, '서아')).toBe('오늘 서아 · 12/20분 · 공룡 점프: 공룡 점프 게임 → 두 마리로 → 빨간색 외 1');
    expect(kidsTodayLine({ works: [], usedMin: 3, limitMin: 20, talks: 2 }, '')).toBe('오늘 아이 · 3/20분 · 말 2번');
  });
});
