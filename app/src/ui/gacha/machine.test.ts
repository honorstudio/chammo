import { describe, expect, it } from 'vitest';
import type { Brush } from '../office/draw';
import { drawMachine, drawTen, idleKey, newShow, skipShow } from './machine';

const noop = new Proxy({}, { get: () => () => {} }) as Brush;

describe('뽑기 연출 건너뛰기 — 누르면 바로 결과', () => {
  it('한 번 뽑기: 건너뛰면 다음 프레임에 결과 카드', () => {
    let card = 0;
    const s = newShow('one', [{ id: 'skin.mint', rarity: '희귀' }], () => { card++; });
    const now = s.t0 + 100;
    drawMachine(noop, 220, 184, s, now);
    expect(card).toBe(0);
    skipShow(s, now);
    drawMachine(noop, 220, 184, s, now + 16);
    expect(card).toBe(1);
    drawMachine(noop, 220, 184, s, now + 32);
    expect(card).toBe(1); // 카드는 한 번만
  });

  it('10번 뽑기: 건너뛰면 다음 프레임에 결과, 선반의 10개도 다 열린 채', () => {
    let card = 0, rects = 0;
    const items = Array.from({ length: 10 }, (_, i) => ({ id: 'skin.mint', rarity: i === 9 ? '전설' as const : '흔함' as const }));
    const s = newShow('ten', items, () => { card++; });
    const t0 = s.t0;
    skipShow(s, t0 + 50);
    drawTen({ ...noop, rect: () => { rects++; } } as Brush, 300, 120, s, t0 + 66);
    expect(card).toBe(1);
    expect([...s.flags].filter((f) => /^p\d$/.test(f))).toHaveLength(10);
    expect(rects).toBeGreaterThan(0);
  });
});

// 재현(2026-10-04 상점 QA 19): 뽑기 창을 열어만 둬도 매 프레임 기계를 다시 그려 CPU 초당 50ms(사무실만 8ms)
describe('idleKey — 기다리는 기계는 그림이 바뀔 때만 다시 그린다', () => {
  const shot = (now: number) => {
    const out: string[] = [];
    const rec = new Proxy({}, { get: (_, k) => (...a: unknown[]) => { out.push(`${String(k)}${JSON.stringify(a)}`); } }) as Brush;
    drawMachine(rec, 220, 184, null, now);
    return out.join('|');
  };
  it('키가 같으면 그림도 똑같다(시간에 기대는 건 다 키에 들어 있다)', () => {
    const seen = new Map<string, string>();
    for (let now = 0; now < 12_000; now += 7) {
      const k = idleKey(now), img = shot(now);
      if (seen.has(k)) expect(seen.get(k), `now=${now}`).toBe(img);
      else seen.set(k, img);
    }
  }, 60_000); // 그림 1,700장 — 부하 높을 때 기본 5초를 넘겨 헛실패(2026-10-10)
  it('반짝임이 지나가지 않는 동안엔 전등 박자(260ms)에만 바뀐다', () => {
    const keys = new Set<string>();
    for (let now = 1_000; now < 2_000; now += 4) keys.add(idleKey(now)); // 1.0~2.0초 = 반짝임(2.4초마다 앞 0.48초) 밖
    expect(keys.size).toBeLessThanOrEqual(8);
  });
});
