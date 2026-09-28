import { describe, expect, it, vi } from 'vitest';
import { BADGES, earnedBadges, unlockBadges } from './badges';
import { hatch, type TamaEvent } from './pet';
import { EMPTY_FILE, type TamaFile } from './store';

const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m).getTime();
const commit = (t: number, lines = 20, hasTest = false): TamaEvent => ({ t, type: 'commit', lines, hasTest });
const file = (o: Partial<TamaFile> = {}): TamaFile => ({ ...EMPTY_FILE, ...o });

describe('earnedBadges — 지금 채운 업적', () => {
  it('도감으로 따는 것: 첫 부화·첫 완전체·첫 궁극체·숨은 진화·합체', () => {
    expect(earnedBadges(file({ dex: ['fire.egg', 'fire.i1'] }), [], at(28, 10))).toEqual(['hatch']);
    const got = earnedBadges(file({ dex: ['fire.i1', 'fire.p2', 'wave.m1', 'leaf.cX', 'fire.jA'] }), [], at(28, 10));
    expect(got).toEqual(expect.arrayContaining(['hatch', 'perfect', 'ultimate', 'hidden', 'fused']));
  });

  it('도감 절반(37)·완성(74)', () => {
    const half = Array.from({ length: 37 }, (_, i) => `x.s${i}`);
    expect(earnedBadges(file({ dex: half }), [], 0)).toContain('dexHalf');
    expect(earnedBadges(file({ dex: half }), [], 0)).not.toContain('dexFull');
  });

  it('작은 커밋의 날 — 하루(새벽 5시 기준) 커밋 10개 이상, 300줄 넘는 게 하나도 없음', () => {
    const ten = Array.from({ length: 10 }, (_, i) => commit(at(28, 10, i)));
    expect(earnedBadges(file(), ten, at(28, 20))).toContain('smallDay');
    expect(earnedBadges(file(), [...ten, commit(at(28, 15), 400)], at(28, 20))).not.toContain('smallDay');
    expect(earnedBadges(file(), ten.slice(1), at(28, 20))).not.toContain('smallDay');
  });

  it('테스트 반 — 하루 커밋 10개 이상 중 절반 넘게 테스트 포함', () => {
    const day = Array.from({ length: 10 }, (_, i) => commit(at(28, 10, i), 20, i < 5));
    expect(earnedBadges(file(), day, at(28, 20))).toContain('testHalf');
    expect(earnedBadges(file(), day.map((e, i) => (i === 0 ? { ...e, hasTest: false } : e)), at(28, 20))).not.toContain('testHalf');
  });

  it('CI 연속 20 초록 · 시킨 일 50개 끝 (평생 기록)', () => {
    const p = { ...hatch('fire', at(28, 9), 0.3) };
    p.life = { ...p.life, bestStreak: 20, tasksDone: 50 };
    expect(earnedBadges(file({ pet: p }), [], at(28, 10))).toEqual(expect.arrayContaining(['ciStreak', 'delegator']));
  });

  it('7일 연속 커밋 (주말 포함 달력 날짜)', () => {
    const week = Array.from({ length: 7 }, (_, i) => commit(new Date(2026, 8, 21 + i, 12).getTime()));
    expect(earnedBadges(file(), week, at(28, 20))).toContain('week');
    expect(earnedBadges(file(), week.filter((_, i) => i !== 3), at(28, 20))).not.toContain('week');
  });

  it('무덤 없이 궁극체', () => {
    expect(earnedBadges(file({ dex: ['fire.m1'] }), [], 0)).toContain('noGrave');
    expect(earnedBadges(file({ dex: ['fire.m1'], graves: [{ egg: 'wave', slot: 'r1', bornAt: 0, diedAt: 1 }] }), [], 0)).not.toContain('noGrave');
  });
});

describe('unlockBadges — 한 번 따면 계속, 새로 딴 것만 알린다', () => {
  it('새로 딴 것만 fresh, 딴 시각을 남긴다', () => {
    const a = unlockBadges(file(), ['hatch'], 100);
    expect(a.fresh).toEqual(['hatch']);
    expect(a.file.badges).toEqual({ hatch: 100 });
    const b = unlockBadges(a.file, ['hatch', 'perfect'], 200);
    expect(b.fresh).toEqual(['perfect']);
    expect(b.file.badges).toEqual({ hatch: 100, perfect: 200 });
  });

  it('조건이 빠져도(무덤이 생겨도) 이미 딴 건 안 뺏는다', () => {
    expect(unlockBadges(file({ badges: { noGrave: 5 } }), [], 9).file.badges).toEqual({ noGrave: 5 });
  });

  it('업적 목록은 이름·힌트가 다 있다', () => {
    expect(BADGES.length).toBeGreaterThanOrEqual(12);
    expect(BADGES.every((b) => b.name && b.hint)).toBe(true);
  });
});

describe('업적 글자 — 비서 이름·영어', () => {
  it('기본 비서 이름(참모)이 들어가고 참모 같은 고정 이름은 없다', () => {
    expect(BADGES.find((b) => b.id === 'delegator')?.hint).toBe('참모가 시킨 일 50개가 끝났다');
  });
  it('받침 있는 이름은 "이", 영어면 영어 문장', async () => {
    vi.resetModules();
    const i18n = await import('../../i18n');
    i18n.setAssistant('비서장');
    expect((await import('./badges')).BADGES.find((b) => b.id === 'delegator')?.hint).toBe('비서장이 시킨 일 50개가 끝났다');
    vi.resetModules();
    const en = await import('../../i18n');
    en.setLang('en');
    const b = (await import('./badges')).BADGES;
    expect(b.find((x) => x.id === 'hatch')?.name).toBe('First Hatch');
    expect(b.find((x) => x.id === 'delegator')?.hint).toBe('50 tasks delegated by Chammo are done');
    vi.resetModules();
  });
});
