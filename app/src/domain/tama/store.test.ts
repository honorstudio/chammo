import { describe, expect, it } from 'vitest';
import { hatch } from './pet';
import { addWork, archive, EMPTY_FILE, fuse, parseTamaFile, pickEgg, restart, retrieve, step, workMinutes } from './store';

const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m).getTime();

describe('addWork — 세션이 일한 시간을 10분 칸으로 모은다 (파일이 폴링마다 불어나지 않게)', () => {
  it('같은 10분 칸이면 더하고, 다음 칸이면 새로', () => {
    let f = addWork(EMPTY_FILE, at(28, 10, 1), 0.5);
    f = addWork(f, at(28, 10, 7), 0.25);
    f = addWork(f, at(28, 10, 12), 1);
    expect(f.work).toEqual([{ t: at(28, 10, 0), minutes: 0.75 }, { t: at(28, 10, 10), minutes: 1 }]);
  });

  it('0분은 안 적는다', () => {
    expect(addWork(EMPTY_FILE, at(28, 10), 0).work).toEqual([]);
  });

  it('30일 지난 칸은 버린다', () => {
    const f = addWork({ ...EMPTY_FILE, work: [{ t: at(1, 10), minutes: 5 }] }, at(28 + 5, 10), 1);
    expect(f.work).toHaveLength(1);
  });
});

describe('step — 기록을 먹여 펫을 지금으로', () => {
  it('펫이 없으면 그대로', () => {
    expect(step(EMPTY_FILE, [], at(28, 10))).toEqual(EMPTY_FILE);
  });

  it('진화하면서 본 모습을 도감에 남긴다', () => {
    const f = pickEgg(EMPTY_FILE, 'wave', at(28, 9), 0.4);
    const g = step(f, [], at(28, 10, 30));
    expect(g.pet?.slot).toBe('i2');
    expect(g.dex).toEqual(['wave.egg', 'wave.i1', 'wave.i2']);
  });

  it('쌓아 둔 세션 작업 시간도 훈련으로 먹인다', () => {
    const f = { ...pickEgg(EMPTY_FILE, 'fire', at(28, 9), 0.4), work: [{ t: at(28, 10, 10), minutes: 40 }] };
    expect(step(f, [], at(28, 11)).pet?.c.training).toBe(1);
  });

  it('채워지는 중인 작업 칸은 닫힐 때까지 기다린다 — 중간에 먹여서 뒤 분이 사라지지 않게', () => {
    let f = pickEgg(EMPTY_FILE, 'fire', at(28, 9), 0.4);
    f = step(addWork(f, at(28, 10, 1), 20), [], at(28, 10, 5));
    f = step(addWork(f, at(28, 10, 8), 20), [], at(28, 10, 9));
    expect(step(f, [], at(28, 10, 30)).pet?.c.training).toBe(1);
  });
});

describe('pickEgg · parseTamaFile', () => {
  it('알을 고르면 새 펫, 도감에 알', () => {
    const f = pickEgg(EMPTY_FILE, 'leaf', at(28, 9), 0.1);
    expect(f.pet).toEqual(hatch('leaf', at(28, 9), 0.1));
    expect(f.dex).toEqual(['leaf.egg']);
  });

  it('죽은 펫은 무덤으로 보내고 새 알', () => {
    const dead = { ...hatch('fire', at(1, 9), 0.1), slot: 'cD' as const, dead: { at: at(10, 5), slot: 'cD' as const } };
    const f = pickEgg({ ...EMPTY_FILE, pet: dead }, 'star', at(28, 9), 0.9);
    expect(f.graves).toEqual([{ egg: 'fire', slot: 'cD', bornAt: at(1, 9), diedAt: at(10, 5) }]);
    expect(f.pet?.egg).toBe('star');
  });

  it('예전 파일(숨은 진화 숫자·streak 없음)도 0 으로 채워 읽는다', () => {
    const old = { ...hatch('fire', at(28, 9), 0.1) } as Record<string, unknown>;
    delete old.streak;
    old.c = { mistakes: 2 };
    const f = parseTamaFile(JSON.stringify({ pet: old }));
    expect(f.pet?.streak).toBe(0);
    expect(f.pet?.c.friPr).toBe(0);
    expect(f.pet?.c.mistakes).toBe(2);
  });

  it('빈 파일·깨진 파일은 빈 상태로', () => {
    expect(parseTamaFile('')).toEqual(EMPTY_FILE);
    expect(parseTamaFile('{깨짐')).toEqual(EMPTY_FILE);
    expect(parseTamaFile(JSON.stringify({ pet: null }))).toEqual(EMPTY_FILE);
  });
});

describe('workMinutes — 폴링 한 번 사이에 세션들이 일한 분', () => {
  it('일하는 세션 수 × 지난 시간', () => {
    expect(workMinutes(2, 3000)).toBe(0.1);
  });

  it('맥이 잠들었다 깨서 간격이 길면 10초까지만 (잠든 동안 일한 걸로 치지 않게)', () => {
    expect(workMinutes(1, 3_600_000)).toBeCloseTo(10 / 60);
  });
});

describe('보관함 — 넣어 둔 동안은 시간이 멈춘다 (최대 3마리)', () => {
  const live = () => step(pickEgg(EMPTY_FILE, 'fire', at(28, 9), 0.4), [], at(28, 10, 30));

  it('넣으면 지금 펫이 비고 보관함에 들어간다', () => {
    const f = archive(live(), at(28, 11));
    expect(f?.pet).toBeNull();
    expect(f?.box).toHaveLength(1);
    expect(f?.box[0]?.slot).toBe('i2');
  });

  it('꺼내면 넣어 둔 시간만큼 밀려서 — 진화도 굶주림도 그동안 안 흐른다', () => {
    const boxed = archive(live(), at(28, 11))!;
    const back = retrieve(boxed, 0, at(30, 11))!;
    expect(back.box).toHaveLength(0);
    expect(back.pet?.bornAt).toBe(at(28, 9) + (at(30, 11) - at(28, 11)));
    // 넣기 전: 알 고른 지 2시간(유년기 II). 꺼낸 뒤 1시간 더 → 3시간째, 성장기(6시간) 전
    expect(step(back, [], at(30, 12)).pet?.slot).toBe('i2');
    expect(step(back, [], at(30, 12)).pet?.c.mistakes).toBe(0);
  });

  it('넣어 둔 동안의 커밋은 먹이로 안 들어간다', () => {
    const back = retrieve(archive(live(), at(28, 11))!, 0, at(30, 11))!;
    const fed = step(back, [{ t: at(29, 10), type: 'commit', lines: 10, hasTest: false }], at(30, 12));
    expect(fed.pet?.life.commits).toBe(0);
  });

  it('키우던 게 있으면 자리를 바꾼다', () => {
    const boxed = archive(live(), at(28, 11))!;
    const two = pickEgg(boxed, 'leaf', at(28, 12), 0.2);
    const swapped = retrieve(two, 0, at(28, 13))!;
    expect(swapped.pet?.egg).toBe('fire');
    expect(swapped.box.map((p) => p.egg)).toEqual(['leaf']);
  });

  it('3마리 꽉 차면 못 넣는다 (null), 죽은 펫은 못 넣는다', () => {
    let f = live();
    for (let i = 0; i < 3; i++) f = pickEgg(archive(f, at(28, 11))!, 'star', at(28, 11), 0.5);
    expect(f.box).toHaveLength(3);
    expect(archive(f, at(28, 12))).toBeNull();
    const dead = { ...live(), pet: { ...live().pet!, dead: { at: 1, slot: 'i2' as const } } };
    expect(archive(dead, at(28, 12))).toBeNull();
  });
});

describe('처음부터 · rev', () => {
  it('처음부터: 키우던 펫은 무덤(떠나보냄)으로, 알 고르기 화면으로', () => {
    const f = restart(step(pickEgg(EMPTY_FILE, 'wave', at(28, 9), 0.4), [], at(28, 10, 30)), at(28, 11));
    expect(f.pet).toBeNull();
    expect(f.graves).toEqual([{ egg: 'wave', slot: 'i2', bornAt: at(28, 9), diedAt: at(28, 11), left: true }]);
  });

  it('사람이 바꾼 것(알 고르기·넣기·꺼내기·처음부터)은 rev 를 올린다 — 메인 창 1분 계산이 덮어쓰지 않게', () => {
    const a = pickEgg(EMPTY_FILE, 'fire', at(28, 9), 0.4);
    const b = archive(a, at(28, 10))!;
    const c = retrieve(b, 0, at(28, 11))!;
    const d = restart(c, at(28, 12));
    expect([a.rev, b.rev, c.rev, d.rev]).toEqual([1, 2, 3, 4]);
    expect(step(d, [], at(28, 13)).rev).toBe(4);
  });
});

describe('fuse — 보관함 한 마리 + 키우는 애 = 합체 궁극체', () => {
  const grown = (egg: 'fire' | 'wave' | 'leaf', slot: 'p1' | 'p2') => ({ ...hatch(egg, at(20, 9), 0.4), slot });
  const withBox = (pet: ReturnType<typeof grown>, boxed: ReturnType<typeof grown>) => ({ ...EMPTY_FILE, pet, box: [{ ...boxed, boxedAt: at(27, 9) }], rev: 5 });

  it('짝이 맞으면 합체: 보관함에서 빠지고, 키우던 애가 합체 궁극체로 (도감·rev)', () => {
    const f = fuse(withBox(grown('fire', 'p1'), grown('wave', 'p1')), 0, at(28, 10))!;
    expect(f.pet?.slot).toBe('jA');
    expect(f.pet?.egg).toBe('fire');
    expect(f.box).toEqual([]);
    expect(f.dex).toContain('fire.jA');
    expect(f.rev).toBe(6);
  });

  it('짝이 안 맞으면 null', () => {
    expect(fuse(withBox(grown('fire', 'p2'), grown('wave', 'p1')), 0, at(28, 10))).toBeNull();
    expect(fuse(withBox(grown('fire', 'p1'), grown('leaf', 'p1')), 0, at(28, 10))).toBeNull();
    expect(fuse({ ...EMPTY_FILE, pet: grown('fire', 'p1') }, 0, at(28, 10))).toBeNull();
  });
});
