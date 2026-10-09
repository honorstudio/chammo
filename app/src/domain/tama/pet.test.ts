import { describe, expect, it } from 'vitest';
import { advance, fullness, hatch, type TamaEvent } from './pet';

// 2026-09-28 = 월요일. 로컬 시간
// 날짜 숫자는 9월 기준으로 쓰고 5주(35일) 뒤로 옮긴다 — 같은 요일, 2026 추석 주(9/24~26)를 피해 공휴일 없는 10/26~11/6 에서
const at = (d: number, h: number, m = 0) => new Date(2026, 8, d + 35, h, m).getTime();
const H = 3_600_000;
const commit = (t: number, lines = 20, hasTest = false): TamaEvent => ({ t, type: 'commit', lines, hasTest });

describe('advance — 시간표대로 진화 (5분·1시간·6시간·1일·3일·7일)', () => {
  const born = at(28, 10);
  const p0 = hatch('fire', born, 0.3);

  it('알 → 5분 뒤 유년기 I → 1시간 뒤 유년기 II → 6시간 뒤 성장기', () => {
    expect(advance(p0, [], born + 4 * 60_000).slot).toBe('egg');
    expect(advance(p0, [], born + 5 * 60_000).slot).toBe('i1');
    expect(advance(p0, [], born + H).slot).toBe('i2');
    expect(advance(p0, [commit(born + 2 * H), commit(born + 5 * H)], born + 6 * H).slot).toBe('r1');
  });

  it('조금씩 나눠서 advance 해도 한 번에 한 것과 같다', () => {
    const evs = [commit(born + 2 * H), commit(born + 5 * H)];
    const once = advance(p0, evs, born + 7 * H);
    const step = advance(advance(advance(p0, evs, born + 3 * H), evs, born + 6 * H), evs, born + 7 * H);
    expect(step).toEqual(once);
  });

  it('진화하면 그 단계 기록(counters)은 0 부터 다시', () => {
    const p = advance(p0, [commit(born + 2 * H), commit(born + 3 * H)], born + 6 * H);
    expect(p.c.commits).toBe(0);
    expect(p.life.commits).toBe(2);
  });
});

describe('돌봄 실수 — 깨어 있는 평일 기준', () => {
  it('12시간 굶기면 실수 1 (월 9시 부화, 밥 없음 → 21시)', () => {
    const p = hatch('fire', at(28, 9), 0.3);
    expect(advance(p, [], at(28, 20, 59)).c.mistakes).toBe(0);
    expect(advance(p, [], at(28, 21)).c.mistakes).toBe(1);
  });

  it('밤에 자는 동안은 배가 안 고프다 — 저녁 8시에 먹고 다음 날 10시면 실수 0', () => {
    const p = hatch('fire', at(28, 19), 0.3);
    expect(advance(p, [commit(at(28, 20))], at(29, 10)).c.mistakes).toBe(0);
  });

  it('+300줄 커밋 = 똥. 작은 커밋 3개로 치운다', () => {
    const p = hatch('fire', at(28, 9), 0.3);
    const dirty = advance(p, [commit(at(28, 10), 400)], at(28, 11));
    expect(dirty.poops).toBe(1);
    const clean = advance(dirty, [commit(at(28, 11, 10)), commit(at(28, 11, 20)), commit(at(28, 11, 30))], at(28, 12));
    expect(clean.poops).toBe(0);
  });

  it('똥을 6시간 방치하면 실수 1', () => {
    const p = hatch('fire', at(28, 9), 0.3);
    const evs = [commit(at(28, 16, 30), 400), commit(at(28, 20))];
    expect(advance(p, evs, at(28, 22, 29)).c.mistakes).toBe(0);
    expect(advance(p, evs, at(28, 22, 30)).c.mistakes).toBe(1);
  });
});

describe('진화 변수 — 과식·훈련·배틀', () => {
  it('한 시간에 커밋 10개 = 과식 1. 같은 시간에 20개여도 1', () => {
    const p = hatch('fire', at(28, 9), 0.3);
    const ten = Array.from({ length: 10 }, (_, i) => commit(at(28, 10, i * 5)));
    const twenty = Array.from({ length: 20 }, (_, i) => commit(at(28, 10, i * 2)));
    expect(advance(p, ten, at(28, 11)).c.overfeed).toBe(1);
    expect(advance(p, twenty, at(28, 11)).c.overfeed).toBe(1);
  });

  it('과식 기준은 내 평소 — 지난주 바쁜 시간이 시간당 30개였으면 10개로는 과식 아님', () => {
    // 21~25일(지난주) 20시간 동안 시간당 30개 — 알 고르기 전 기록이라 먹이로는 안 들어가고 기준에만 쓰인다
    const history = Array.from({ length: 20 }, (_, h) =>
      Array.from({ length: 30 }, (_, i) => commit(new Date(2026, 8, 21 + 35 + (h % 5), 10 + Math.floor(h / 5), i).getTime()))).flat();
    const p = hatch('fire', at(28, 9), 0.3);
    const ten = Array.from({ length: 10 }, (_, i) => commit(at(28, 10, i * 5)));
    const thirty = Array.from({ length: 30 }, (_, i) => commit(at(28, 10, i * 2)));
    expect(advance(p, [...history, ...ten], at(28, 11)).c.overfeed).toBe(0);
    expect(advance(p, [...history, ...thirty], at(28, 11)).c.overfeed).toBe(1);
  });

  it('세션이 일한 30분 = 훈련 1 (남은 분은 이어서 센다)', () => {
    const p = hatch('fire', at(28, 9), 0.3);
    const evs: TamaEvent[] = [{ t: at(28, 10), type: 'work', minutes: 45 }, { t: at(28, 11), type: 'work', minutes: 20 }];
    expect(advance(p, evs, at(28, 12)).c.training).toBe(2);
  });

  it('성숙기에서 CI 15번 중 12번 통과하면 3일째에 완전체', () => {
    let p = hatch('fire', at(28, 9), 0.3);
    const feed = [at(28, 10), at(28, 14), at(29, 10), at(29, 14), at(30, 10), at(30, 14)].map((t) => commit(t));
    p = advance(p, feed, at(29, 9, 30));
    expect(p.slot).toBe('cD');
    const ci: TamaEvent[] = Array.from({ length: 15 }, (_, i) => ({ t: at(30, 10) + i * 60_000, type: 'ci', pass: i < 12 }));
    expect(advance(p, [...feed, ...ci], at(31, 9, 30)).slot).toBe('p1');
  });
});

describe('숨은 진화 숫자 세기', () => {
  const p = hatch('fire', at(28, 9), 0.3);

  it('금요일 18시 이후 PR 머지만 friPr', () => {
    const evs: TamaEvent[] = [{ t: new Date(2026, 9, 2, 17, 59).getTime(), type: 'pr' }, { t: new Date(2026, 9, 2, 18, 0).getTime(), type: 'pr' }, { t: new Date(2026, 9, 2, 23, 0).getTime(), type: 'pr' }];
    const q = advance(hatch('fire', new Date(2026, 9, 2, 9).getTime(), 0.3), evs, new Date(2026, 9, 2, 23, 30).getTime()); // 10/2 금
    expect(q.c.friPr).toBe(2);
  });

  it('새벽 1~5시에 끝난 시킨 일만 dawnTasks', () => {
    const evs: TamaEvent[] = [at(29, 0), at(29, 1), at(29, 4), at(29, 5)].map((t) => ({ t, type: 'task' }));
    expect(advance(p, evs, at(29, 6)).c.dawnTasks).toBe(2);
  });

  it('CI 연속 통과 중 가장 긴 것 — 실패하면 다시 0부터', () => {
    const run = [true, true, true, false, true, true].map((pass, i) => ({ t: at(28, 10) + i * 60_000, type: 'ci' as const, pass }));
    const q = advance(p, run, at(28, 11));
    expect(q.c.bestStreak).toBe(3);
    expect(q.streak).toBe(2);
  });

  it('보름달 밤의 활동은 moon', () => {
    const full = Date.UTC(2024, 9, 17, 11, 26); // 한국 20:26 보름
    const q = advance(hatch('star', full - 3_600_000, 0.3), [commit(full)], full + 60_000);
    expect(q.c.moon).toBe(1);
  });
});

describe('아픔·죽음 — 평일 기준 (주말·공휴일 제외)', () => {
  const born = at(23, 10); // 수
  const alive = [commit(at(23, 11))];

  it('2일 무활동이면 아프고, 커밋 3개가 약 — 수요일 활동 → 목·금이 지난 토요일 새벽', () => {
    const p = hatch('fire', born, 0.3);
    expect(advance(p, alive, at(26, 4)).sick).toBe(false);
    const sick = advance(p, alive, at(26, 5));
    expect(sick.sick).toBe(true);
    const cured = advance(sick, [commit(at(26, 10)), commit(at(26, 11)), commit(at(26, 12))], at(26, 13));
    expect(cured.sick).toBe(false);
  });

  it('4일 무활동이면 죽는다 — 수요일 활동 → 목·금·(토·일 빼고)·월·화가 지난 수요일 새벽', () => {
    const p = hatch('fire', born, 0.3);
    expect(advance(p, alive, at(29, 12)).dead).toBeNull();
    const dead = advance(p, alive, at(30, 5));
    expect(dead.dead).not.toBeNull();
    expect(dead.dead?.slot).toBe(dead.slot);
  });

  it('죽은 뒤로는 아무것도 바뀌지 않는다', () => {
    const dead = advance(hatch('fire', born, 0.3), alive, at(30, 5));
    expect(advance(dead, [commit(at(30, 10))], at(30, 12))).toEqual({ ...dead, updatedAt: at(30, 12) });
  });
});

describe('fullness — 배고픔 게이지 0~4', () => {
  it('커밋 1개 = +1, PR 머지 = +2, 깨어 있는 3시간마다 −1', () => {
    const p = hatch('fire', at(28, 9), 0.3);
    const fed = advance(p, [commit(at(28, 10)), commit(at(28, 10, 5)), { t: at(28, 10, 10), type: 'pr' }], at(28, 10, 30));
    expect(fullness(fed)).toBe(4);
    expect(fullness(advance(fed, [], at(28, 13, 10)))).toBe(3);
    expect(fullness(advance(fed, [], at(29, 22)))).toBe(0);
  });
});
