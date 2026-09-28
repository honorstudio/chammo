import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../../i18n';
import { evolve, fuseTarget, nameOf, stageOf, ZERO, type Counters } from './tree';

const c = (o: Partial<Counters>): Counters => ({ ...ZERO, ...o });

describe('evolve — 디지몬 Ver.1 모양 트리 (1→1→2→7→3→2)', () => {
  it('알 → 유년기 I → 유년기 II 는 조건 없이', () => {
    expect(evolve('fire', 'egg', ZERO)).toBe('i1');
    expect(evolve('fire', 'i1', c({ mistakes: 9 }))).toBe('i2');
  });

  it('성장기: 돌봄 실수 0~2 면 r1, 3 이상이면 r2', () => {
    expect(evolve('fire', 'i2', c({ mistakes: 2 }))).toBe('r1');
    expect(evolve('fire', 'i2', c({ mistakes: 3 }))).toBe('r2');
  });

  it('r1 → 성숙기: 실수·훈련·과식 조합', () => {
    expect(evolve('fire', 'r1', c({ mistakes: 0, training: 16 }))).toBe('cG');
    expect(evolve('fire', 'r1', c({ mistakes: 2, training: 15 }))).toBe('cD');
    expect(evolve('fire', 'r1', c({ mistakes: 3, training: 5, overfeed: 3 }))).toBe('cT');
    expect(evolve('fire', 'r1', c({ mistakes: 3, training: 16, overfeed: 3 }))).toBe('cM');
    expect(evolve('fire', 'r1', c({ mistakes: 3, training: 4, overfeed: 3 }))).toBe('cN');
    expect(evolve('fire', 'r1', c({ mistakes: 5, training: 20, overfeed: 0 }))).toBe('cN');
  });

  it('r2 → 성숙기: 데블몬·메라몬 자리는 r1 에서도 r2 에서도 온다', () => {
    expect(evolve('fire', 'r2', c({ mistakes: 1, training: 16 }))).toBe('cD');
    expect(evolve('fire', 'r2', c({ mistakes: 1, training: 3 }))).toBe('cM');
    expect(evolve('fire', 'r2', c({ mistakes: 4, training: 8, overfeed: 2 }))).toBe('cA');
    expect(evolve('fire', 'r2', c({ mistakes: 4, training: 15, overfeed: 3 }))).toBe('cS');
    expect(evolve('fire', 'r2', c({ mistakes: 4, training: 20 }))).toBe('cN');
  });

  it('완전체: CI 15번 중 12번 통과해야, 성숙기 셋이 하나로 모인다', () => {
    const ok = c({ battles: 15, wins: 12 });
    expect(['cG', 'cD', 'cA'].map((s) => evolve('fire', s as never, ok))).toEqual(['p1', 'p1', 'p1']);
    expect(['cT', 'cM', 'cS'].map((s) => evolve('fire', s as never, ok))).toEqual(['p2', 'p2', 'p2']);
    expect(evolve('fire', 'cN', ok)).toBe('p3');
  });

  it('완전체 조건을 못 채우면 그대로 (null = 다음에 다시 본다)', () => {
    expect(evolve('fire', 'cG', c({ battles: 14, wins: 14 }))).toBeNull();
    expect(evolve('fire', 'cG', c({ battles: 20, wins: 11 }))).toBeNull();
  });

  it('궁극체: 실수 0~2 + 계열별 조건. 반전 완전체(p3)와 궁극체는 끝', () => {
    expect(evolve('fire', 'p1', c({ prMerges: 5 }))).toBe('m1');
    expect(evolve('fire', 'p2', c({ prMerges: 5 }))).toBe('m2');
    expect(evolve('fire', 'p1', c({ prMerges: 5, mistakes: 3 }))).toBeNull();
    expect(evolve('fire', 'p1', c({ prMerges: 4 }))).toBeNull();
    expect(evolve('wave', 'p1', c({ tasksDone: 10 }))).toBe('m1');
    expect(evolve('leaf', 'p1', c({ commits: 10, testCommits: 5 }))).toBe('m1');
    expect(evolve('leaf', 'p1', c({ commits: 10, testCommits: 4 }))).toBeNull();
    expect(evolve('leaf', 'p1', ZERO)).toBeNull();
    expect(evolve('star', 'p1', c({ luck: 0.3 }))).toBe('m1');
    expect(evolve('star', 'p1', c({ luck: 0.7 }))).toBeNull();
    expect(evolve('fire', 'p3', c({ prMerges: 99 }))).toBeNull();
    expect(evolve('fire', 'm1', ZERO)).toBeNull();
  });
});

describe('숨은 진화 — 성장기 → 숨은 성숙기(cX), 일반 갈래보다 먼저', () => {
  it('계열마다 숨은 조건: 불씨 금요일 밤 PR 3 · 물결 새벽 시킨 일 4 · 잎사귀 CI 연속 20 · 별 보름달 밤', () => {
    expect(evolve('fire', 'r1', c({ friPr: 3 }))).toBe('cX');
    expect(evolve('fire', 'r2', c({ friPr: 2, mistakes: 5 }))).toBe('cN');
    expect(evolve('wave', 'r2', c({ dawnTasks: 4 }))).toBe('cX');
    expect(evolve('leaf', 'r1', c({ bestStreak: 20 }))).toBe('cX');
    expect(evolve('leaf', 'r1', c({ bestStreak: 19 }))).toBe('cD');
    expect(evolve('star', 'r2', c({ moon: 1 }))).toBe('cX');
    expect(evolve('fire', 'r1', c({ moon: 1, dawnTasks: 9 }))).toBe('cD'); // 다른 계열 조건은 안 먹힌다
  });

  it('숨은 성숙기 → 완전체: 배틀 조건은 같고, 승률 90% 이상이면 p1 아니면 p2', () => {
    expect(evolve('fire', 'cX', c({ battles: 20, wins: 18 }))).toBe('p1');
    expect(evolve('fire', 'cX', c({ battles: 20, wins: 17 }))).toBe('p2');
    expect(evolve('fire', 'cX', c({ battles: 14, wins: 14 }))).toBeNull();
  });
});

describe('합체', () => {
  it('파이프라인(불씨)+오케스트라곤(물결) = 마에스트로드래곤, 그린빌드(잎사귀)+은하고래(별) = 크로노가디언 — 순서 무관', () => {
    expect(fuseTarget({ egg: 'fire', slot: 'p1' }, { egg: 'wave', slot: 'p1' })).toBe('jA');
    expect(fuseTarget({ egg: 'wave', slot: 'p1' }, { egg: 'fire', slot: 'p1' })).toBe('jA');
    expect(fuseTarget({ egg: 'star', slot: 'p1' }, { egg: 'leaf', slot: 'p1' })).toBe('jB');
    expect(fuseTarget({ egg: 'fire', slot: 'p1' }, { egg: 'fire', slot: 'p1' })).toBeNull();
    expect(fuseTarget({ egg: 'fire', slot: 'p2' }, { egg: 'wave', slot: 'p1' })).toBeNull();
  });

  it('이름: 숨은 성숙기·합체 궁극체', () => {
    expect(['fire', 'wave', 'leaf', 'star'].map((e) => nameOf(e as never, 'cX'))).toEqual(['금요일여우', '새벽문어', '초록불사슴', '월식토끼']);
    expect(nameOf('fire', 'jA')).toBe('마에스트로드래곤');
    expect(nameOf('star', 'jB')).toBe('크로노가디언');
    expect(stageOf('cX')).toBe(4);
    expect(stageOf('jA')).toBe(6);
    expect(evolve('fire', 'jA', ZERO)).toBeNull();
  });
});

describe('이름·단계', () => {
  it('계열마다 이름이 다르다', () => {
    expect(nameOf('fire', 'r1')).toBe('망치곰');
    expect(nameOf('wave', 'p1')).toBe('오케스트라곤');
    expect(nameOf('leaf', 'cN')).toBe('곰팡이덩굴');
    expect(nameOf('star', 'm2')).toBe('빅뱅룡');
  });

  it('단계 번호: 알 0 · 유년기 1·2 · 성장기 3 · 성숙기 4 · 완전체 5 · 궁극체 6', () => {
    expect(['egg', 'i1', 'i2', 'r2', 'cS', 'p3', 'm1'].map((s) => stageOf(s as never))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('영어 이름', () => {
  afterEach(() => setLang('ko'));
  it('계열·숨은 진화·합체 모두 영어 이름이 있다', () => {
    setLang('en');
    expect(nameOf('fire', 'egg')).toBe('Ember Egg');
    expect(nameOf('leaf', 'cM')).toBe('Mockingbird');
    expect(nameOf('wave', 'cX')).toBe('Dawn Octopus');
    expect(nameOf('fire', 'jA')).toBe('Maestro Dragon');
    const slots = ['egg', 'i1', 'i2', 'r1', 'r2', 'cG', 'cD', 'cA', 'cT', 'cM', 'cS', 'cN', 'cX', 'p1', 'p2', 'p3', 'm1', 'm2', 'jA', 'jB'] as const;
    for (const e of ['fire', 'wave', 'leaf', 'star'] as const) for (const s of slots) expect(nameOf(e, s), `${e}.${s}`).toMatch(/^[A-Za-z][A-Za-z -]*$/);
  });
  it('한국어가 기본', () => { expect(nameOf('leaf', 'cM')).toBe('모킹새'); });
});
