import { describe, expect, it } from 'vitest';
import { EMPTY_GACHA } from './gacha';
import { firstPetAt, moveFromTama, tamaCoins } from './moveTama';
import { EMPTY_FILE, type TamaFile } from './tama/store';
import { ZERO } from './tama/tree';
import type { Pet } from './tama/pet';

const pet = (over: Partial<Pet> & { training?: number; commits?: number } = {}): Pet => ({
  egg: 'fire', slot: 'r1', bornAt: 1000, c: { ...ZERO }, life: { ...ZERO, training: over.training ?? 0, commits: over.commits ?? 0 },
  fedFull: 0, fedCare: 0, hungerMistakes: 0, poops: 0, poopCare: 0, cleanCredit: 0, sick: false, sickCare: 0, medicine: 0, workCarry: 0, streak: 0, recent: [], lastOverfeed: 0, lastActive: 0, dead: null, updatedAt: 2000, ...over,
});
const file = (over: Partial<TamaFile>): TamaFile => ({ ...EMPTY_FILE, ...over });
const MIN = 60_000;

describe('tamaCoins — 일한 30분 = 1코인, 커밋 5개 = 1코인', () => {
  it('펫 평생 기록(훈련 1칸 = 30분) + 그 펫 기간 밖 일한 시간 칸', () => {
    const t = file({ box: [{ ...pet({ bornAt: 100 * MIN, training: 10 }), boxedAt: 200 * MIN }], work: [
      { t: 150 * MIN, minutes: 999 }, // 펫 기간 안 — 평생 기록에 이미 있다
      { t: 300 * MIN, minutes: 60 },
    ] });
    const r = tamaCoins(t, 0, 400 * MIN);
    expect(r.minutes).toBe(10 * 30 + 60);
    expect(r.coins).toBe(12);
  });
  it('키우는 중인 펫은 지금까지가 그 기간', () => {
    const t = file({ pet: pet({ bornAt: 100 * MIN, training: 2 }), work: [{ t: 300 * MIN, minutes: 999 }] });
    expect(tamaCoins(t, 0, 400 * MIN).minutes).toBe(60);
  });
  it('커밋은 나머지를 버린다', () => {
    expect(tamaCoins(file({}), 11887, 0).coins).toBe(2377);
    expect(tamaCoins(file({}), 4, 0).coins).toBe(0);
  });
  it('사용자 실측과 같은 값', () => {
    expect(Math.floor((1657 * 60) / 30) + Math.floor(11887 / 5)).toBe(5691);
  });
});

describe('moveFromTama — 한 번만', () => {
  const dex = ['fire.egg', 'fire.i1', 'fire.r1', 'wave.cG', 'fire.m1', 'leaf.jA'];
  it('알을 뺀 도감이 ★1 캐릭터로, 코인이 더해진다', () => {
    const f = moveFromTama({ ...EMPTY_GACHA, coins: 7 }, file({ dex, work: [{ t: 0, minutes: 90 }] }), 10, 1);
    expect(f.coins).toBe(7 + 3 + 2);
    expect(f.owned['chr.fire_i1']).toBe(1);
    expect(f.owned['chr.bear']).toBe(1); // fire.r1 = 곰
    expect(f.owned['chr.wave_cG']).toBe(1);
    expect(f.owned['chr.fuse_jA']).toBe(1);
    expect(f.owned['chr.fire_egg']).toBeUndefined();
    expect(f.tamaMoved).toMatchObject({ coins: 5, chars: 5 });
  });
  it('이미 옮겼으면 그대로 — 코인이 두 번 안 나간다', () => {
    const once = moveFromTama(EMPTY_GACHA, file({ work: [{ t: 0, minutes: 90 }] }), 0, 1);
    expect(moveFromTama(once, file({ work: [{ t: 0, minutes: 90 }] }), 0, 2)).toBe(once);
  });
  it('이미 가진 캐릭터는 별을 깎거나 더하지 않는다', () => {
    const f = moveFromTama({ ...EMPTY_GACHA, owned: { 'chr.bear': 3 } }, file({ dex: ['fire.r1'] }), 0, 1);
    expect(f.owned['chr.bear']).toBe(3);
  });
  it('다마고치를 안 해 본 새 사용자도 곰 한 마리', () => {
    const f = moveFromTama(EMPTY_GACHA, file({}), 0, 1);
    expect(f.owned['chr.bear']).toBe(1);
    expect(f.coins).toBe(0);
  });
  it('NEW 로 쏟아지지 않는다', () => {
    expect(moveFromTama(EMPTY_GACHA, file({ dex }), 0, 1).fresh).toBeUndefined();
  });
});

describe('firstPetAt — 커밋을 어디서부터 셀까', () => {
  it('보관함·은퇴·무덤·지금 펫 중 가장 이른 때, 없으면 null', () => {
    expect(firstPetAt(file({}))).toBeNull();
    expect(firstPetAt(file({ pet: pet({ bornAt: 500 }), lineage: [{ egg: 'wave', slot: 'm1', bornAt: 300, retiredAt: 400, quirk: 'night', inherited: [] }] }))).toBe(300);
  });
});
