import { describe, expect, it } from 'vitest';
import { afterSwitch, applyApi, changedKeys, fpOf, migrate, fmtUntil, markNudged, pinPatch, stuckOf, parseResets, readAuto, readWins, slotStatus, step, LEARN_MS, MIN_GAP_MS, PIN_THRESHOLD, type AutoState, type Input } from './accountAuto';

// 로컬 시각으로 — 22:20 같은 '다시 열리는 시각'을 사람 눈으로 맞춘다
const at = (h: number, m = 0, d = 2, s = 0) => new Date(2026, 9, d, h, m, s).getTime();
const sec = (ms: number) => Math.round(ms / 1000);
/** 상태줄 파일 모양 */
const raw = (five: number, fiveReset: number, week: number, weekReset: number) =>
  JSON.stringify({ rate_limits: { five_hour: { used_percentage: five, resets_at: sec(fiveReset) }, seven_day: { used_percentage: week, resets_at: sec(weekReset) } } });

// 지문(주간 창 시각) — 계정마다 다르고 한 주 동안 그대로. 2026-10-02 실측 값
const WB = at(16, 0, 8); // b = project-b(작은 것, 앞)
const WA = at(11, 0, 3); // a = 계정A(큰 것)
const usage = (five: number, fiveReset: number, week = 10) => raw(five, fiveReset, week, WB);
const usageA = (five: number, fiveReset: number, week = 10) => raw(five, fiveReset, week, WA);

const IDS = ['b', 'a']; // 순서: b 먼저
/** 지문을 이미 아는 상태 */
const base = (p: Partial<AutoState> = {}): AutoState => ({ ...readAuto({ v: 2 }), slots: { b: { fp: WB }, a: { fp: WA } }, ...p });
const input = (p: Partial<Input> = {}): Input => ({ now: at(18, 30), ids: IDS, active: 'b', usage: null, stuck: [], ...p });
/** 한 차례 = 그 시각 상태줄 파일(내용·고친 시각) */
const tick = (s: AutoState, now: number, json: string | null, p: Partial<Input> = {}) => step(s, input({ now, usage: json ? { json, at: now - 1000 } : null, ...p }));

describe('readAuto — 저장된 상태 읽기', () => {
  it('없으면 기본값(자동 켬)', () => {
    expect(readAuto(undefined)).toEqual({ v: null, on: true, pinned: null, switchedAt: null, slots: {}, allOutUntil: null, nudged: {}, learn: null });
  });
  it('모양이 깨졌으면 그 칸만 기본값', () => {
    const s = readAuto({ v: 2, on: false, pinned: 3, slots: { b: { blockedUntil: 'x', fp: 7, five: { used: 50, resetsAt: 9 } } }, nudged: { s1: 5, s2: 'x' }, learn: { fp: 'x' } });
    expect(s.on).toBe(false);
    expect(s.pinned).toBeNull();
    expect(s.slots.b).toEqual({ fp: 7, five: { used: 50, resetsAt: 9 } });
    expect(s.nudged).toEqual({ s1: 5 });
    expect(s.learn).toBeNull();
  });
});

describe('readWins — 상태줄 사용량', () => {
  it('퍼센트·다시 열리는 시각(ms)', () => {
    expect(readWins(usage(40, at(22, 20)), at(18))).toEqual({ five: { used: 40, resetsAt: at(22, 20) }, week: { used: 10, resetsAt: WB } });
  });
  it('이미 지난 창은 버린다 — 옛 창의 퍼센트다', () => {
    expect(readWins(usage(97, at(17)), at(18)).five).toBeUndefined();
  });
  it('깨졌으면 빈 것', () => {
    expect(readWins('{', at(18))).toEqual({});
  });
});

describe('step — 2026-10-02 실측 재현: 두 계정 값이 번갈아 찍혀도 잘못 넘기지 않는다', () => {
  // 새 판이 뜬 직후(지문 모름), 지금 계정 = project-b(b). 상태줄엔 세션마다 쥔 토큰에 따라 두 계정 값이 섞여 찍힌다
  const D = usageA(3, at(23, 30), 97); // 계정A 값
  const T = usage(37, at(22, 20), 5); // project-b 값

  it('옛 판 기록(근거 없는 막힘)은 한 번 지운다', () => {
    const old = readAuto({ on: true, slots: { b: { week: { used: 97, resetsAt: WA }, blockedUntil: WA, why: 'week' }, a: { blockedUntil: WA } }, allOutUntil: WA });
    const p = tick(old, at(19), null);
    expect(p.state.v).toBe(2);
    expect(p.state.slots.b).toEqual({});
    expect(p.state.slots.a).toBeUndefined();
    expect(p.allOut).toBeNull();
    expect(p.switchTo).toBeNull();
  });

  it('계정A 값(주간 97%)이 찍혀도 project-b 를 막지 않고, 번갈아 찍히는 동안은 지문을 배우지 않는다', () => {
    let s = readAuto({ v: 2 });
    for (const [t, json] of [[at(18, 54, 2, 27), D], [at(18, 54, 2, 40), D], [at(18, 55, 2, 14), T], [at(18, 55, 2, 35), D], [at(18, 56, 2, 10), T], [at(18, 56, 2, 50), D]] as const) {
      const p = tick(s, t, json);
      expect(p.switchTo).toBeNull();
      expect(p.allOut).toBeNull();
      s = p.state;
    }
    expect(s.slots.b?.fp).toBeUndefined();
    expect(s.slots.b?.blockedUntil).toBeUndefined();
  });

  it('지금 계정 값만 2분 넘게·세 번 넘게 찍히면 그때 지문을 배운다(그 뒤 남의 값은 버린다)', () => {
    let s = readAuto({ v: 2 });
    s = tick(s, at(18, 56), T).state;
    s = tick(s, at(18, 57), T).state;
    expect(s.slots.b?.fp).toBeUndefined(); // 아직 2분이 안 됐다
    s = tick(s, at(18, 58, 2, 30), T).state;
    expect(s.slots.b?.fp).toBe(WB);
    expect(s.slots.b?.week?.used).toBe(5);
    const p = tick(s, at(18, 59), D);
    expect(p.switchTo).toBeNull();
    expect(p.state.slots.b?.week?.used).toBe(5);
    expect(p.state.slots.a).toBeUndefined();
  });

  it('같은 파일을 여러 번 읽는 건 한 번으로 친다(멈춰 있는 옛 값으로 배우지 않게)', () => {
    let s = readAuto({ v: 2 });
    for (const t of [at(18, 56), at(18, 57), at(18, 58), at(18, 59)]) s = step(s, input({ now: t, usage: { json: D, at: at(18, 55) } })).state;
    expect(s.slots.b?.fp).toBeUndefined();
  });
});

describe('step — 지문으로 주인 가리기', () => {
  it('남의 칸 값은 그 칸 기록만 바꾸고 넘기지 않는다(늦게 넘어온 세션)', () => {
    const p = tick(base(), at(18, 54), usageA(3, at(23, 30), 97));
    expect(p.switchTo).toBeNull();
    expect(p.state.slots.a?.week?.used).toBe(97);
    expect(p.state.slots.b?.week).toBeUndefined();
  });

  it('번갈아 찍혀도 오락가락 없다', () => {
    let s = base();
    for (let i = 0; i < 6; i++) {
      const p = tick(s, at(19, i), i % 2 ? usageA(3, at(23, 30), 97) : usage(40 + i, at(22, 20), 5));
      expect(p.switchTo).toBeNull();
      s = p.state;
    }
    expect(s.slots.b?.five?.used).toBe(44);
  });

  it('어느 칸 지문도 아니고 지금 칸 지문도 이미 있으면 버린다', () => {
    const p = tick(base(), at(19), raw(99, at(22), 99, at(9, 0, 5)));
    expect(p.state.slots).toEqual(base().slots);
  });

  it('지금 칸 지문이 이미 있으면 모르는 값이 오래·여러 번 보여도 다시 배우지 않는다(칸에 없는 계정의 세션)', () => {
    let s = base();
    for (const t of [at(19), at(19, 2), at(19, 4), at(19, 6)]) s = tick(s, t, raw(99, at(22), 99, at(9, 0, 5))).state;
    expect(s.slots.b?.fp).toBe(WB);
    expect(s.slots.b?.week).toBeUndefined();
    expect(s.slots.b?.blockedUntil).toBeUndefined();
  });

  it('두 칸 지문이 같으면 5시간 창 시각으로 가리고, 그래도 모르면 버린다', () => {
    const s = base({ slots: { b: { fp: WB, five: { used: 10, resetsAt: at(22, 20) } }, a: { fp: WB, five: { used: 10, resetsAt: at(23, 30) } } } });
    expect(tick(s, at(19), usage(50, at(23, 30))).state.slots.a?.five?.used).toBe(50);
    const q = tick(s, at(19), usage(50, at(21)));
    expect(q.state.slots.a?.five?.used).toBe(10);
    expect(q.state.slots.b?.five?.used).toBe(10);
  });

  it('주간 창이 지나면(새 주) 지금 칸 지문을 새로 배운다', () => {
    const next = at(16, 0, 15);
    let s = base();
    for (const t of [at(16, 5, 8), at(16, 6, 8), at(16, 8, 8)]) s = step(s, input({ now: t, usage: { json: raw(1, at(21, 0, 8), 1, next), at: t } })).state;
    expect(s.slots.b?.fp).toBe(next);
  });

  it('막힘의 근거 지문이 지금 지문과 다르면 그 막힘은 무효', () => {
    const s = base({ slots: { b: { fp: WB, blockedUntil: WA, why: 'week', blockFp: WA }, a: { fp: WA } } });
    const p = tick(s, at(19), null);
    expect(p.state.slots.b?.blockedUntil).toBeUndefined();
    expect(p.switchTo).toBeNull();
  });
});

describe('step — 넘기기', () => {
  it('95% 이상이면 그 칸을 다시 열리는 시각까지 막고 다음 칸으로', () => {
    const p = tick(base(), at(18, 30), usage(95, at(22, 20)));
    expect(p.switchTo).toBe('a');
    expect(p.why).toBe('five');
    expect(p.state.slots.b?.blockedUntil).toBe(at(22, 20));
    expect(p.state.slots.b?.blockFp).toBe(WB);
  });

  it('94% 면 그대로', () => {
    const p = tick(base(), at(18, 30), usage(94, at(22, 20)));
    expect(p.switchTo).toBeNull();
    expect(p.state.slots.b?.five?.used).toBe(94);
  });

  it('주간 95% 면 주간 시각까지', () => {
    const p = tick(base(), at(18, 30), usage(30, at(22, 20), 96));
    expect(p.why).toBe('week');
    expect(p.state.slots.b?.blockedUntil).toBe(WB);
  });

  it('지문을 모르면 95% 여도 막지 않는다(모르는 값으로는 절대 안 막는다)', () => {
    const p = tick(readAuto({ v: 2 }), at(18, 30), usage(99, at(22, 20), 99));
    expect(p.switchTo).toBeNull();
    expect(p.state.slots.b?.blockedUntil).toBeUndefined();
  });

  it('기록상 꽉 찬 칸으로는 넘기지 않는다 — 다 소진(오늘 계정A 주간 98%)', () => {
    let s = tick(base(), at(18, 54), usageA(3, at(23, 30), 98)).state;
    const p = tick(s, at(21, 50), usage(96, at(22, 20), 5));
    expect(p.switchTo).toBeNull();
    expect(p.allOut).toEqual({ until: at(22, 20), notify: true });
    s = p.state;
    expect(tick(s, at(21, 51), usage(97, at(22, 20), 5)).allOut).toEqual({ until: at(22, 20), notify: false });
  });
});

describe('step — 돌아오기', () => {
  const afterB = () => afterSwitch(tick(base(), at(18, 30), usage(96, at(22, 20))).state, at(18, 30));

  it('앞 순서 칸이 다시 열리면 그쪽으로(옛 높은 값은 지난 창이라 버린다)', () => {
    const p = tick(afterB(), at(22, 21), usageA(40, at(23, 30)), { active: 'a' });
    expect(p.switchTo).toBe('b');
    expect(p.why).toBe('back');
    expect(p.state.slots.b?.blockedUntil).toBeUndefined();
    expect(p.state.slots.b?.five).toBeUndefined();
  });

  it('열리기 전엔 안 돌아간다', () => {
    expect(tick(afterB(), at(22, 19), null, { active: 'a' }).switchTo).toBeNull();
  });

  it('막힘 시각이 지나도 그 칸 기록이 아직 95% 이상이고 창이 안 끝났으면 계속 막아 둔다', () => {
    const s = base({ switchedAt: at(18, 30), slots: { b: { fp: WB, blockedUntil: at(19, 30), why: 'limit', blockFp: WB, five: { used: 96, resetsAt: at(22, 20) } }, a: { fp: WA } } });
    const p = tick(s, at(19, 31), null, { active: 'a' });
    expect(p.switchTo).toBeNull();
    expect(p.state.slots.b?.blockedUntil).toBe(at(22, 20));
    expect(p.state.slots.b?.why).toBe('five');
  });

  it('오락가락 막기 — 바꾼 지 얼마 안 됐으면 돌아가지 않는다', () => {
    const s = afterSwitch(base(), at(18, 30));
    expect(tick(s, at(18, 30) + MIN_GAP_MS - 1000, null, { active: 'a' }).switchTo).toBeNull();
    expect(tick(s, at(18, 30) + MIN_GAP_MS + 1000, null, { active: 'a' }).switchTo).toBe('b');
  });

  it('돌아간 뒤 늦게 넘어온 세션이 앞 계정의 높은 옛 값을 그려도 — 지난 창이면 버린다', () => {
    const back = afterSwitch(tick(afterB(), at(22, 21), null, { active: 'a' }).state, at(22, 21));
    const p = tick(back, at(22, 22), usage(96, at(22, 20)));
    expect(p.switchTo).toBeNull();
    expect(p.state.slots.b?.five).toBeUndefined();
  });
});

describe('step — 손으로 고른 칸', () => {
  it('고정이면 앞 순서가 열려 있어도 안 돌아간다', () => {
    expect(tick(base({ pinned: 'a' }), at(18, 30), null, { active: 'a' }).switchTo).toBeNull();
  });
  it('고정한 칸이 소진되면 자동으로 넘기고 고정을 푼다', () => {
    const s = base({ pinned: 'a', slots: { b: { fp: WB, blockedUntil: at(23), blockFp: WB }, a: { fp: WA }, c: {} } });
    const p = tick(s, at(18, 30), usageA(PIN_THRESHOLD, at(22, 20)), { active: 'a', ids: ['b', 'a', 'c'] });
    expect(p.switchTo).toBe('c');
    expect(p.state.pinned).toBeNull();
    expect(p.unpinned).toBe(true);
  });
  it('고정한 칸이 지금 로그인이 아니면(밖에서 바꿈) 고정을 푼다', () => {
    expect(tick(base({ pinned: 'a' }), at(18, 30), null).state.pinned).toBeNull();
  });
});

describe('step — 고정한 칸은 95% 문턱이 아니라 진짜 다 찰 때까지(2026-10-06 프로젝트B 주간 95%)', () => {
  // b = 손으로 고른 프로젝트B(주간 95%·앞 순서 아님), a = 여유 있는 계정
  const pinB = (p: Partial<AutoState> = {}) => base({ pinned: 'b', switchedAt: at(17), slots: { b: { fp: WB }, a: { fp: WA, week: { used: 68, resetsAt: WA } } }, ...p });

  it('고정 + 주간 95~98% → 안 넘어가고 고정도 그대로', () => {
    for (const used of [95, 97, PIN_THRESHOLD - 1]) {
      const p = tick(pinB(), at(18, 30), usage(10, at(22, 20), used));
      expect(p.switchTo).toBeNull();
      expect(p.state.pinned).toBe('b');
      expect(p.state.slots.b?.blockedUntil).toBeUndefined();
      expect(p.unpinned).toBeUndefined();
    }
  });

  it('고정 + 5시간 창 95% 도 마찬가지', () => {
    const p = tick(pinB(), at(18, 30), usage(96, at(22, 20), 10));
    expect(p.switchTo).toBeNull();
  });

  it('고정 + 주간 99% → 넘기고 고정을 풀고 알린다(unpinned)', () => {
    const p = tick(pinB(), at(18, 30), usage(10, at(22, 20), PIN_THRESHOLD));
    expect(p.switchTo).toBe('a');
    expect(p.why).toBe('week');
    expect(p.state.pinned).toBeNull();
    expect(p.unpinned).toBe(true);
    expect(p.state.slots.b?.blockedUntil).toBe(WB);
  });

  it('고정 + 한도 오류로 세션이 멈춤(429) → 95% 아래여도 넘기고 고정 풀림·계속해', () => {
    const p = tick(pinB(), at(18, 30), usage(10, at(22, 20), 60), { stuck: [{ session: 's1', ts: at(18, 20), resetsAt: at(22, 20) }] });
    expect(p.switchTo).toBe('a');
    expect(p.why).toBe('limit');
    expect(p.state.pinned).toBeNull();
    expect(p.unpinned).toBe(true);
    expect(p.nudge).toEqual(['s1']);
  });

  it('고정한 뒤(switchedAt 이전)에 난 한도 오류는 이 계정 탓이 아니다', () => {
    const p = tick(pinB(), at(18, 30), usage(10, at(22, 20), 96), { stuck: [{ session: 's1', ts: at(16, 50) }] });
    expect(p.switchTo).toBeNull();
    expect(p.state.pinned).toBe('b');
  });

  it('고정 안 함 + 95% → 예전처럼 넘어간다(unpinned 아님)', () => {
    const p = tick(pinB({ pinned: null }), at(18, 30), usage(10, at(22, 20), 95));
    expect(p.switchTo).toBe('a');
    expect(p.unpinned).toBeUndefined();
  });

  it('고정한 칸에 옛 95% 막힘 기록이 남아 있어도(자동 켜져 있을 때 막힌 채 손으로 고름) 풀어서 쓴다', () => {
    const s = pinB({ slots: { b: { fp: WB, week: { used: 96, resetsAt: WB }, blockedUntil: WB, why: 'week', blockFp: WB }, a: { fp: WA } } });
    const p = tick(s, at(18, 30), null);
    expect(p.switchTo).toBeNull();
    expect(p.state.pinned).toBe('b');
    expect(p.state.slots.b?.blockedUntil).toBeUndefined();
  });

  it('고정한 칸의 한도 오류 막힘(limit)·로그인 막힘은 풀지 않는다', () => {
    const s = pinB({ slots: { b: { fp: WB, blockedUntil: at(22), why: 'limit', blockFp: WB }, a: { fp: WA } } });
    expect(tick(s, at(18, 30), null).switchTo).toBe('a');
  });

  it('MIN_GAP — 고정 아니면 돌아오기는 바꾼 뒤 간격을 지킨다(고정이 안 풀어 준다)', () => {
    const s = base({ switchedAt: at(18, 30), slots: { b: { fp: WB }, a: { fp: WA } } });
    expect(tick(s, at(18, 30) + MIN_GAP_MS - 1000, null, { active: 'a' }).switchTo).toBeNull();
    expect(tick(s, at(18, 30) + MIN_GAP_MS + 1000, null, { active: 'a' }).switchTo).toBe('b');
  });

  it('다른 칸(쉬는 칸)은 고정과 상관없이 95% 면 못 쓴다 — 넘길 곳으로 안 고른다', () => {
    const s = pinB({ slots: { b: { fp: WB }, a: { fp: WA, week: { used: 96, resetsAt: WA } } } });
    const p = tick(s, at(18, 30), usage(10, at(22, 20), PIN_THRESHOLD));
    expect(p.switchTo).toBeNull();
    expect(p.allOut).not.toBeNull();
  });
});

describe('step — 한도 문구로 멈춘 세션', () => {
  it('바꾼 뒤에 난 한도 오류 = 지금 계정 소진 → 넘기고 그 세션에 계속해', () => {
    const p = tick(base({ switchedAt: at(17) }), at(18, 30), null, { stuck: [{ session: 's1', ts: at(18, 20), resetsAt: at(22, 20) }] });
    expect(p.switchTo).toBe('a');
    expect(p.why).toBe('limit');
    expect(p.state.slots.b?.blockedUntil).toBe(at(22, 20));
    expect(p.nudge).toEqual(['s1']);
  });

  it('지문을 몰라도 한도 오류는 소진 신호다(사람이 본 문구)', () => {
    const p = tick(readAuto({ v: 2 }), at(18, 30), null, { stuck: [{ session: 's1', ts: at(18, 20) }] });
    expect(p.switchTo).toBe('a');
    expect(p.state.slots.b?.blockedUntil).toBe(at(19, 30)); // 시각을 모르면 1시간 뒤
  });

  it('바꾸기 전에 옛 계정에서 난 오류면 소진 아님 — 계속해만', () => {
    const p = tick(base({ switchedAt: at(18, 25) }), at(18, 30), null, { stuck: [{ session: 's1', ts: at(18, 20) }] });
    expect(p.switchTo).toBeNull();
    expect(p.nudge).toEqual(['s1']);
  });

  it('계속해는 세션마다 한 번 — 이미 깨운 오류면 다시 안 보낸다', () => {
    const s = markNudged(base({ switchedAt: at(18, 25) }), ['s1'], at(18, 26));
    expect(tick(s, at(18, 30), null, { stuck: [{ session: 's1', ts: at(18, 20) }] }).nudge).toEqual([]);
  });

  it('다 소진이면 계속해를 안 보낸다', () => {
    const s = base({ switchedAt: at(17), slots: { b: { fp: WB }, a: { fp: WA, blockedUntil: at(23), blockFp: WA } } });
    const p = tick(s, at(18, 30), null, { stuck: [{ session: 's1', ts: at(18, 20), resetsAt: at(22, 20) }] });
    expect(p.allOut?.until).toBe(at(22, 20));
    expect(p.nudge).toEqual([]);
  });
});

describe('step — 다 소진 뒤 다시 열렸을 때', () => {
  const stuck = [{ session: 's1', ts: at(18, 20), resetsAt: at(22, 20) }];
  const allOut = () => tick(base({ switchedAt: at(17) }), at(18, 30), null, { ids: ['b'], stuck }).state;

  it('열리기 전엔 계속해를 안 보낸다', () => {
    expect(tick(allOut(), at(22, 0), null, { ids: ['b'], stuck }).nudge).toEqual([]);
  });
  it('열린 뒤엔 그 전에 난 오류로 다시 막지 않고, 멈춘 세션을 깨운다', () => {
    const p = tick(allOut(), at(22, 21), null, { ids: ['b'], stuck });
    expect(p.state.slots.b?.blockedUntil).toBeUndefined();
    expect(p.allOut).toBeNull();
    expect(p.nudge).toEqual(['s1']);
  });
  it('전에 깨운 세션이어도 다시 열린 뒤엔 한 번 더', () => {
    const s = markNudged(allOut(), ['s1'], at(18, 0));
    expect(tick(s, at(22, 21), null, { ids: ['b'], stuck }).nudge).toEqual(['s1']);
  });
  it('깨운 뒤 지금 계정에서 또 멈추면 다시 안 보낸다', () => {
    const s = markNudged(base({ switchedAt: at(18) }), ['s1'], at(18, 1));
    const p = tick(s, at(18, 30), null, { stuck: [{ session: 's1', ts: at(18, 10), resetsAt: at(22, 20) }] });
    expect(p.switchTo).toBe('a');
    expect(p.nudge).toEqual([]);
  });
});

describe('step — 끄거나 모를 때', () => {
  it('자동이 꺼져 있으면 넘기지 않는다(사용량은 적어 둔다)', () => {
    const p = tick(base({ on: false }), at(18, 30), usage(99, at(22, 20)));
    expect(p.switchTo).toBeNull();
    expect(p.state.slots.b?.five?.used).toBe(99);
    expect(p.state.slots.b?.blockedUntil).toBeUndefined();
  });
  it('지금 로그인이 칸에 없으면 아무것도 안 한다', () => {
    const p = tick(base(), at(18, 30), usage(99, at(22, 20)), { active: null });
    expect(p.switchTo).toBeNull();
    expect(p.state.slots.b?.five).toBeUndefined();
  });
  it('목록에서 빠진 칸 기록은 지운다', () => {
    expect(tick(base({ slots: { gone: { blockedUntil: at(23) } } }), at(18, 30), null).state.slots.gone).toBeUndefined();
  });
});

describe('LEARN_MS', () => {
  it('2분', () => expect(LEARN_MS).toBe(2 * 60_000));
});

describe('parseResets — 한도 문구의 시각', () => {
  it('오전·오후·분', () => {
    expect(parseResets("You've hit your weekly limit · resets 11am (Asia/Seoul)", at(18))).toBe(at(11, 0, 3));
    expect(parseResets("You've hit your session limit · resets 3:45pm", at(10))).toBe(at(15, 45));
    expect(parseResets('resets 12am', at(23))).toBe(at(0, 0, 3));
  });
  it('없으면 undefined', () => {
    expect(parseResets('usage limit reached', at(10))).toBeUndefined();
  });
});

describe('slotStatus — 설정 칸 상태', () => {
  it('막힘·5시간·주간·쓸 수 있음', () => {
    expect(slotStatus({ blockedUntil: at(22, 20), why: 'five' }, at(18))).toEqual({ kind: 'five', until: at(22, 20) });
    expect(slotStatus({ blockedUntil: at(16, 0, 8), why: 'week' }, at(18))).toEqual({ kind: 'week', until: at(16, 0, 8) });
    expect(slotStatus({ five: { used: 97, resetsAt: at(22) } }, at(18))).toEqual({ kind: 'five', until: at(22) });
    expect(slotStatus({ blockedUntil: at(17) }, at(18))).toEqual({ kind: 'ok' });
    expect(slotStatus(undefined, at(18))).toEqual({ kind: 'ok' });
  });
  it('고정한 칸은 95~98% 도 쓸 수 있음, 99% 부터 소진', () => {
    const wk = (used: number) => ({ week: { used, resetsAt: at(16, 0, 8) } });
    expect(slotStatus(wk(96), at(18), true)).toEqual({ kind: 'ok' });
    expect(slotStatus(wk(PIN_THRESHOLD), at(18), true)).toEqual({ kind: 'week', until: at(16, 0, 8) });
    expect(slotStatus(wk(96), at(18), false)).toEqual({ kind: 'week', until: at(16, 0, 8) });
  });
});

describe('fmtUntil — 다시 열리는 시각 글', () => {
  it('오늘이면 시:분, 아니면 월/일 시:분', () => {
    expect(fmtUntil(at(22, 20), at(18))).toBe('22:20');
    expect(fmtUntil(at(16, 0, 8), at(18))).toBe('10/08 16:00');
    expect(fmtUntil(at(0, 5, 3), at(23))).toBe('10/03 00:05');
  });
});

describe('pinPatch — 손으로 바꾸거나 새 계정을 보관했을 때', () => {
  it('그 칸 고정 + 바꾼 시각', () => {
    expect(pinPatch('a', at(18))).toEqual({ pinned: 'a', switchedAt: at(18) });
  });
});

describe('changedKeys — 저장할 것만(그새 설정에서 바꾼 키를 옛 값으로 덮지 않게)', () => {
  it('바뀐 윗단 키만, null 은 null 로(지우기)', () => {
    const a = readAuto({ v: 2, on: false, pinned: 'a', slots: {} });
    const b = { ...a, pinned: null, switchedAt: 5 };
    expect(changedKeys(a, b)).toEqual({ pinned: null, switchedAt: 5 });
    expect(changedKeys(a, a)).toEqual({});
  });
});

describe('stuckOf — 한도 오류로 멈춘 세션 고르기', () => {
  const act = (id: string, state: 'working' | 'idle' | 'blocked', limit?: { ts: string; text: string }, kind: 'background' | 'interactive' = 'background') =>
    ({ session: { id, kind, state }, activity: limit ? { limit } : {} }) as unknown as Parameters<typeof stuckOf>[0][number];
  it('백그라운드이고 일하는 중이 아닌 것만, 문구의 시각도', () => {
    const ts = new Date(2026, 9, 2, 10, 0).toISOString();
    const out = stuckOf([
      act('s1', 'idle', { ts, text: "You've hit your session limit · resets 3:45pm" }),
      act('s2', 'working', { ts, text: 'hit your limit' }),
      act('s3', 'idle', { ts, text: 'hit your limit' }, 'interactive'),
      act('s4', 'idle'),
      act('s5', 'blocked', { ts: '깨짐', text: 'x' }),
    ]);
    expect(out).toEqual([{ session: 's1', ts: Date.parse(ts), resetsAt: new Date(2026, 9, 2, 15, 45).getTime() }]);
  });
});

describe('applyApi — 계정 토큰으로 바로 물은 값(주인이 확실하다)', () => {
  const ok = (who: string, five: number, fiveAt: number, week: number, weekAt: number) => ({ who, status: 'ok', five: { used: five, resetsAt: fiveAt }, week: { used: week, resetsAt: weekAt } });

  it('칸 값은 그 칸에(지금 로그인 값도 Rust 가 칸 id 로 준다) — 지문도 바로 안다(소수 초는 분으로 맞춘다)', () => {
    const s = applyApi(readAuto({ v: 2 }), [ok('b', 46, at(22, 20) - 363, 6, WB - 363), ok('a', 3, at(23, 30), 98, WA)], IDS, at(19));
    expect(s.slots.b).toEqual({ fp: WB, five: { used: 46, resetsAt: at(22, 20) - 363 }, week: { used: 6, resetsAt: WB - 363 }, seenAt: at(19) });
    expect(s.slots.a?.fp).toBe(WA);
    expect(s.slots.a?.week?.used).toBe(98);
  });

  it('실패·만료·토큰 없음은 손대지 않는다(마지막 값 그대로)', () => {
    const s0 = base({ slots: { b: { fp: WB, five: { used: 10, resetsAt: at(22, 20) }, seenAt: at(18) }, a: { fp: WA } } });
    const s = applyApi(s0, [{ who: 'b', status: 'rate' }, { who: 'a', status: 'expired' }], IDS, at(19));
    expect(s.slots).toEqual(s0.slots);
  });

  it('지금 로그인이 칸에 없으면(Rust 가 live 로 준다) 버린다', () => {
    const s = applyApi(base(), [ok('live', 99, at(22), 99, at(9, 0, 5))], IDS, at(19));
    expect(s.slots).toEqual(base().slots);
  });

  it('목록에 없는 칸 값은 버린다', () => {
    expect(applyApi(base(), [ok('zz', 1, at(22), 1, at(9, 0, 5))], IDS, at(19)).slots.zz).toBeUndefined();
  });

  it('주소로 배운 지문이면 상태줄 값도 바로 그 칸 몫(배우기 기다림 없음) — 오늘 같은 경우 꽉 찬 칸으로 안 넘긴다', () => {
    let s = applyApi(readAuto({ v: 2 }), [ok('b', 37, at(22, 20), 5, WB), ok('a', 3, at(23, 30), 98, WA)], IDS, at(18, 54));
    const p = tick(s, at(18, 55), usageA(3, at(23, 30), 97));
    expect(p.switchTo).toBeNull();
    s = p.state;
    expect(s.slots.b?.week?.used).toBe(5);
    expect(tick(s, at(21, 50), usage(96, at(22, 20), 5)).allOut?.until).toBe(at(22, 20));
  });

  it('처음(옛 판) 돌 때 — 옛 기록은 지우되 방금 물은 값은 남는다(옛 판 지우기 → 묻기 → 판단 순서)', () => {
    const old = readAuto({ slots: { b: { blockedUntil: WA, why: 'week' } } });
    const s = applyApi(migrate(old), [ok('b', 37, at(22, 20), 5, WB)], IDS, at(19));
    const p = step(s, input({ now: at(19) }));
    expect(p.state.slots.b?.blockedUntil).toBeUndefined();
    expect(p.state.slots.b?.week?.used).toBe(5);
    expect(p.state.slots.b?.fp).toBe(WB);
  });

  it('지문이 다른 칸 것이면 그 칸 몫 — 키체인이 옛 계정 토큰으로 되쓰여 지금 로그인 값이 남의 것일 때', () => {
    const s = applyApi(base(), [ok('b', 3, at(23, 30), 98, WA)], IDS, at(19));
    expect(s.slots.b?.fp).toBe(WB);
    expect(s.slots.b?.week).toBeUndefined();
    expect(s.slots.a?.week?.used).toBe(98);
  });

  it('fpOf — 분 단위로', () => {
    expect(fpOf(WB - 363)).toBe(WB);
    expect(fpOf(WB + 29_000)).toBe(WB);
  });
});

describe('로그인 풀림 — 지금 칸 로그인이 죽으면 그 칸을 막고 다음 칸으로(2026-10-06)', () => {
  const authStuck = (ts: number) => [{ session: 's1', ts, auth: true as const }];

  it('바꾼 뒤에 난 로그인 오류 = 지금 칸 로그인 풀림 → 그 칸을 로그인 필요로 막고 넘긴다. 계속해는 안 보낸다(로그인 쪽이 키체인이 바뀐 걸 보고 이어서)', () => {
    const p = tick(base({ switchedAt: at(17) }), at(18, 30), null, { stuck: authStuck(at(18, 20)) });
    expect(p.switchTo).toBe('a');
    expect(p.why).toBe('auth');
    expect(p.state.slots.b?.why).toBe('auth');
    expect(p.state.slots.b?.blockedUntil).toBeGreaterThan(at(18, 30, 9)); // 시각으로는 안 풀린다
    expect(p.nudge).toEqual([]);
    expect(slotStatus(p.state.slots.b, at(19)).kind).toBe('auth');
  });

  it('지금 로그인 토큰으로 물은 사용량이 401 이어도 같은 신호 — 멈춘 세션이 없어도', () => {
    const s = applyApi(base({ switchedAt: at(17) }), [{ who: 'b', status: 'auth' }], IDS, at(18, 29));
    expect(s.slots.b?.authAt).toBe(at(18, 29));
    const p = tick(s, at(18, 30), null);
    expect(p.switchTo).toBe('a');
    expect(p.why).toBe('auth');
  });

  it('바꾸기 전 옛 칸에서 난 로그인 오류는 지금 칸 탓이 아니다', () => {
    const p = tick(base({ switchedAt: at(18, 25) }), at(18, 30), null, { stuck: authStuck(at(18, 20)) });
    expect(p.switchTo).toBeNull();
    expect(p.nudge).toEqual([]);
  });

  it('그 칸 토큰으로 물은 값이 다시 ok 면 풀린다(다시 로그인해 보관함)', () => {
    const blocked = tick(base({ switchedAt: at(17) }), at(18, 30), null, { stuck: authStuck(at(18, 20)) }).state;
    const s = applyApi(blocked, [{ who: 'b', status: 'ok', five: { used: 5, resetsAt: at(22) }, week: { used: 5, resetsAt: WB } }], IDS, at(19));
    expect(s.slots.b?.blockedUntil).toBeUndefined();
    expect(s.slots.b?.why).toBeUndefined();
    expect(s.slots.b?.authAt).toBeUndefined();
    expect(s.slots.b?.openedAt).toBe(at(19)); // 그 전에 난 오류로 다시 막지 않게
  });

  it('다른 이유(한도)로 막힌 칸은 사용량 ok 로 안 풀린다', () => {
    const s0 = base({ slots: { b: { fp: WB, blockedUntil: at(22, 20), why: 'five', blockFp: WB }, a: { fp: WA } } });
    const s = applyApi(s0, [{ who: 'b', status: 'ok', five: { used: 96, resetsAt: at(22, 20) }, week: { used: 5, resetsAt: WB } }], IDS, at(19));
    expect(s.slots.b?.blockedUntil).toBe(at(22, 20));
  });

  it('모든 칸이 로그인 필요면 다 찼어 알림은 안 낸다(로그인 카드 몫) — 넘기지도 않는다', () => {
    const s = base({ switchedAt: at(17), slots: { b: { fp: WB }, a: { fp: WA, blockedUntil: at(18, 0, 30), why: 'auth' } } });
    const p = tick(s, at(18, 30), null, { stuck: authStuck(at(18, 20)) });
    expect(p.switchTo).toBeNull();
    expect(p.allOut).toBeNull();
  });

  it('하나는 한도·하나는 로그인이면 다 찼어 시각은 한도 칸 것', () => {
    const s = base({ switchedAt: at(17), slots: { b: { fp: WB }, a: { fp: WA, blockedUntil: at(23), blockFp: WA, why: 'five' } } });
    const p = tick(s, at(18, 30), null, { stuck: authStuck(at(18, 20)) });
    expect(p.allOut?.until).toBe(at(23));
  });

  it('쉬는 칸의 보관 토큰이 401 이면 그 칸도 로그인 필요 — 그리로 넘기지 않는다', () => {
    const s = applyApi(base({ switchedAt: at(17) }), [{ who: 'a', status: 'auth' }], IDS, at(18, 29));
    const p = tick(s, at(18, 30), null, { stuck: authStuck(at(18, 20)) });
    expect(p.state.slots.a?.why).toBe('auth');
    expect(p.switchTo).toBeNull();
    expect(p.allOut).toBeNull();
  });

  it('readAuto 가 why auth·authAt 을 읽는다', () => {
    expect(readAuto({ v: 2, slots: { b: { why: 'auth', authAt: 5, blockedUntil: 9 } } }).slots.b).toEqual({ why: 'auth', authAt: 5, blockedUntil: 9 });
  });

  it('stuckOf — 로그인 오류로 멈춘 백그라운드 세션도 auth 표시로', () => {
    const acts = [{ session: { id: 's1', kind: 'background' as const, state: 'idle' as const }, activity: { auth: { ts: '2026-10-06T00:30:22Z', text: 'Login expired · Please run /login' } } }];
    expect(stuckOf(acts)).toEqual([{ session: 's1', ts: Date.parse('2026-10-06T00:30:22Z'), auth: true }]);
    // 갱신 겹침은 칸 탓이 아니다
    expect(stuckOf([{ ...acts[0]!, activity: { auth: { ...acts[0]!.activity.auth, retry: true as const } } }])).toEqual([]);
  });
});
