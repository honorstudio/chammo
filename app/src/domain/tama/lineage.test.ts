import { describe, expect, it } from 'vitest';
import { advance, hatch, type TamaEvent } from './pet';
import { earnQuirk, heirOf, isFinal, QUIRK_MAX } from './lineage';
import { autoRetire, EMPTY_FILE, parseTamaFile, pickEgg, retire, step } from './store';
import { ZERO } from './tree';

// 공휴일 없는 주(2026-11-02 월요일)
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const H = 3_600_000;

describe('isFinal — 더 갈 데 없는 끝 모습', () => {
  it('궁극체·합체 궁극체·반전 완전체는 끝, 완전체 p1 은 아직', () => {
    expect(['m1', 'm2', 'jA', 'jB', 'p3'].every((s) => isFinal(s as never))).toBe(true);
    expect(isFinal('p1')).toBe(false);
  });
});

describe('earnQuirk — 버릇은 그 대가 어떻게 컸나로 정해진다', () => {
  it('테스트 든 커밋이 절반 넘으면 테스트 좋아함', () => {
    expect(earnQuirk({ ...ZERO, commits: 20, testCommits: 12, mistakes: 1 }, [])).toBe('tester');
  });

  it('이미 물려받은 버릇은 피하고 다음으로 맞는 걸 준다', () => {
    const c = { ...ZERO, commits: 20, testCommits: 12, prMerges: 12 };
    expect(earnQuirk(c, ['tester'])).toBe('merger');
  });

  it('맞는 게 전부 이미 있으면 그중 첫 번째', () => {
    expect(earnQuirk({ ...ZERO, commits: 20, testCommits: 12, mistakes: 3 }, ['tester'])).toBe('tester');
  });

  it('아무것도 안 맞으면 순둥이', () => {
    expect(earnQuirk({ ...ZERO, mistakes: 3 }, [])).toBe('mellow');
  });
});

describe('heirOf — 다음 알이 물려받는 버릇(최근 셋)', () => {
  it('물려받은 것 + 새로 얻은 것, 겹치면 한 번, 오래된 것부터 빠진다', () => {
    expect(heirOf(['tester'], 'merger')).toEqual(['tester', 'merger']);
    expect(heirOf(['tester', 'merger'], 'tester')).toEqual(['merger', 'tester']);
    expect(heirOf(['a', 'b', 'c'] as never, 'night')).toHaveLength(QUIRK_MAX);
    expect(heirOf(['tidy', 'merger', 'tester'], 'night')).toEqual(['merger', 'tester', 'night']);
  });
});

describe('버릇 효과 — 먹이 계산에 조금씩', () => {
  const born = at(2, 10);
  const commit = (t: number): TamaEvent => ({ t, type: 'commit', lines: 20, hasTest: true });
  it('테스트 좋아함: 테스트 든 커밋 한 번에 배 2칸', () => {
    const plain = advance(hatch('fire', born, 0.3), [commit(born + H)], born + H);
    const tester = advance({ ...hatch('fire', born, 0.3), quirks: ['tester'] }, [commit(born + H)], born + H);
    expect(plain.fedFull).toBe(1);
    expect(tester.fedFull).toBe(2);
  });

  it('머지 배부름: PR 머지가 3칸', () => {
    const p = advance({ ...hatch('fire', born, 0.3), quirks: ['merger'] }, [{ t: born + H, type: 'pr' }], born + H);
    expect(p.fedFull).toBe(3);
  });

  it('순둥이: 배고픔 실수가 12시간이 아니라 14시간마다', () => {
    const p = { ...hatch('fire', at(2, 9), 0.3), quirks: ['mellow' as const] };
    expect(advance(p, [], at(2, 21)).c.mistakes).toBe(0);
    expect(advance(p, [], at(2, 23)).c.mistakes).toBe(1);
  });

  it('밤 10시~새벽 2시 먹이는 밤 기록에 센다(새벽형 버릇 재료)', () => {
    const p = advance(hatch('fire', born, 0.3), [{ t: at(2, 23), type: 'task' }, { t: at(3, 1), type: 'talk' }, { t: at(3, 13), type: 'task' }], at(3, 14));
    expect(p.life.nightFeeds).toBe(2);
  });
});

describe('은퇴 — 끝 모습이 되면 혈통에 남고 다음 알이 버릇을 물려받는다', () => {
  const top = { ...hatch('fire', at(2, 9), 0.3), slot: 'm1' as const, life: { ...ZERO, commits: 30, testCommits: 20 }, quirks: [] as never[] };

  it('끝 모습이 아니면 은퇴 못 함', () => {
    expect(retire({ ...EMPTY_FILE, pet: hatch('fire', at(2, 9), 0.3) }, at(9, 10))).toBeNull();
  });

  it('은퇴하면 펫은 비고, 혈통에 한 줄, 물려줄 버릇이 생긴다', () => {
    const f = retire({ ...EMPTY_FILE, pet: top, rev: 4 }, at(9, 10))!;
    expect(f.pet).toBeNull();
    expect(f.lineage).toEqual([{ egg: 'fire', slot: 'm1', bornAt: at(2, 9), retiredAt: at(9, 10), quirk: 'tester', inherited: [] }]);
    expect(f.heir).toEqual(['tester']);
    expect(f.rev).toBe(5);
  });

  it('다음 알은 물려받은 버릇을 갖고 태어난다 — 죽어도 혈통은 이어진다', () => {
    const f = pickEgg(retire({ ...EMPTY_FILE, pet: top }, at(9, 10))!, 'wave', at(9, 11), 0.5);
    expect(f.pet?.quirks).toEqual(['tester']);
    const dead = { ...f.pet!, dead: { at: at(20, 5), slot: 'cD' as const } };
    expect(pickEgg({ ...f, pet: dead }, 'leaf', at(20, 9), 0.5).pet?.quirks).toEqual(['tester']);
  });

  it('끝 모습이 된 지 하루면 저절로 은퇴(rev 는 그대로 — 1분 계산이 버려지지 않게)', () => {
    const f = { ...EMPTY_FILE, pet: { ...top, peakAt: at(9, 10) }, rev: 2 };
    expect(autoRetire(f, at(10, 9))).toBe(f);
    const g = autoRetire(f, at(10, 10));
    expect(g.pet).toBeNull();
    expect(g.lineage?.[0]?.retiredAt).toBe(at(10, 10));
    expect(g.rev).toBe(2);
  });

  it('step 은 끝 모습에 닿은 시각(peakAt)을 적는다', () => {
    const f = { ...EMPTY_FILE, pet: { ...top, lastActive: at(9, 8), updatedAt: at(9, 9) } };
    expect(step(f, [], at(9, 10)).pet?.peakAt).toBe(at(9, 10));
  });

  it('옛 파일엔 버릇·혈통이 없다 — 빈 값으로 읽는다', () => {
    const f = parseTamaFile(JSON.stringify({ pet: hatch('fire', at(2, 9), 0.3) }));
    expect(f.pet?.quirks).toEqual([]);
    expect(f.lineage ?? []).toEqual([]);
  });
});
