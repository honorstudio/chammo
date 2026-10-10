import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { accountError, addState, allOut, moved, popHead, popRows, slotText, slotUsageText, topLabel, usageOf, weekText, type AccountsView } from './accounts';

const view = (p: Partial<AccountsView> = {}): AccountsView => ({
  accounts: [
    { id: 'a2', name: '작은 것', email: 'b@x.com', plan: 'Max 5x' },
    { id: 'a1', name: '큰 것', email: 'a@x.com', plan: 'Max 20x' },
  ],
  active: 'a2',
  liveEmail: 'b@x.com',
  livePlan: 'Max 5x',
  ...p,
});

afterEach(() => setLang('ko'));

describe('moved — 순서 바꾸기', () => {
  it('위로·아래로 한 칸', () => {
    expect(moved(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moved(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  });
  it('끝에서 더 못 가면 그대로', () => {
    expect(moved(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moved(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});

describe('addState — 계정 추가 중 새 로그인이 들어왔나', () => {
  it('시작할 때 이메일 그대로면 기다리는 중', () => {
    expect(addState(view(), 'b@x.com')).toBe('waiting');
  });
  it('다른 이메일이고 칸에 없으면 보관할 차례', () => {
    expect(addState(view({ active: null, liveEmail: 'c@x.com' }), 'b@x.com')).toBe('newLogin');
  });
  it('다른 이메일인데 이미 칸에 있는 계정', () => {
    expect(addState(view({ active: 'a1', liveEmail: 'a@x.com' }), 'b@x.com')).toBe('known');
  });
  it('처음부터 로그인이 없었으면 로그인이 생기는 순간', () => {
    expect(addState(view({ active: null, liveEmail: null }), null)).toBe('waiting');
    expect(addState(view({ active: null, liveEmail: 'c@x.com' }), null)).toBe('newLogin');
  });
});

describe('topLabel — 위쪽 막대 계정 이름', () => {
  it('칸이 없으면 안 보인다', () => {
    expect(topLabel(view({ accounts: [] }))).toBeNull();
    expect(topLabel(null)).toBeNull();
  });
  it('지금 계정 칸 이름과 이메일·요금제', () => {
    expect(topLabel(view())).toEqual({ name: '작은 것', title: '지금 계정: 작은 것 · b@x.com · Max 5x', known: true });
  });
  it('칸에 없는 로그인이면 이메일 앞부분', () => {
    expect(topLabel(view({ active: null, liveEmail: 'c@x.com', livePlan: null }))).toEqual({ name: 'c', title: '칸에 없는 로그인: c@x.com — 설정 > 계정에서 보관할 수 있어요', known: false });
  });
});

describe('accountError — 오류 이름을 글로', () => {
  it('아는 이름', () => {
    expect(accountError('locked')).toContain('키체인');
    expect(accountError('noSlot')).toContain('보관');
    expect(accountError('moved')).toContain('다른 곳');
    expect(accountError('noBackup')).toContain('백업'); // 되돌리기(accounts_restore) — 칸 없음(noSlot)과 다른 글
    expect(accountError('denied')).toContain('항상 허용');
    setLang('en');
    expect(accountError('notLoggedIn')).toContain('signed in');
  });
  it('모르는 것은 원문을 붙인다', () => {
    expect(accountError('io:디스크 가득')).toContain('디스크 가득');
  });
});

describe('allOut — 다 소진이면 풀리는 때(칩엔 \'다 소진\'만, 시각은 마우스 올림·팝오버)', () => {
  const now = new Date(2026, 9, 2, 18, 0).getTime();
  const until = new Date(2026, 9, 2, 22, 20).getTime();
  it('자동 전환이 다 소진을 알았을 때만', () => {
    expect(allOut(view({ auto: { allOutUntil: until } }), now)).toBe('다 소진 · 22:20 풀림');
    expect(allOut(view({ auto: { on: false, allOutUntil: until } }), now)).toBeNull();
    expect(allOut(view({ auto: { allOutUntil: now - 1 } }), now)).toBeNull();
    expect(allOut(view(), now)).toBeNull();
    expect(allOut(null, now)).toBeNull();
  });
});

describe('slotText — 설정 칸 상태 글', () => {
  const now = new Date(2026, 9, 2, 18, 0).getTime();
  it('쓸 수 있음·5시간·주간·한도 문구', () => {
    expect(slotText({ kind: 'ok' }, now)).toBe('쓸 수 있음');
    expect(slotText({ kind: 'five', until: new Date(2026, 9, 2, 22, 20).getTime() }, now)).toBe('5시간 소진 ~22:20');
    expect(slotText({ kind: 'week', until: new Date(2026, 9, 8, 16, 0).getTime() }, now)).toBe('주간 소진 ~10/08 16:00');
    expect(slotText({ kind: 'limit', until: new Date(2026, 9, 2, 19, 0).getTime() }, now)).toBe('한도 걸림 ~19:00');
  });
  it('로그인 풀림은 시각 없이 — 다시 로그인해야 풀린다', () => {
    expect(slotText({ kind: 'auth', until: now + 30 * 86_400_000 }, now)).toBe('로그인 필요');
  });
});

describe('usageOf — 위 막대 사용량(지금 칸 기록 = 계정 토큰으로 물은 값·지문이 맞는 상태줄 값)', () => {
  const now = new Date(2026, 9, 2, 19, 0).getTime();
  const reset = new Date(2026, 9, 2, 22, 20).getTime();
  it('지금 칸 기록이 있으면 남은 %·남은 초·몇 초 전 값인지', () => {
    const v = view({ auto: { v: 2, slots: { a2: { five: { used: 46, resetsAt: reset }, week: { used: 6, resetsAt: reset + 86_400_000 }, seenAt: now - 90_000 } } } });
    expect(usageOf(v, now)).toEqual({ usage: { five: { left: 54, resetIn: 12_000 }, week: { left: 94, resetIn: 98_400 } }, age: 90_000 });
  });
  it('기록이 없거나 지금 칸을 모르면 null(상태줄 값을 쓴다)', () => {
    expect(usageOf(view(), now)).toBeNull();
    expect(usageOf(view({ active: null }), now)).toBeNull();
    expect(usageOf(null, now)).toBeNull();
  });
});

describe('slotUsageText — 설정 칸 사용량 글', () => {
  const now = new Date(2026, 9, 2, 19, 0).getTime();
  it('5시간·주간 쓴 % 와 몇 분 전', () => {
    expect(slotUsageText({ five: { used: 46.4, resetsAt: now + 1 }, week: { used: 6, resetsAt: now + 1 }, seenAt: now - 3 * 60_000 }, now)).toBe('5시간 46% · 주간 6% 씀 (3분 전)');
    expect(slotUsageText({ five: { used: 46, resetsAt: now + 1 }, seenAt: now - 20_000 }, now)).toBe('5시간 46% 씀 (방금)');
    expect(slotUsageText({}, now)).toBeNull();
  });
});

describe('popRows — 계정 칩 팝오버 줄(글자 적게: 이름·5시간·주간·버튼, 나머지는 작은 한 줄·마우스 올림)', () => {
  const now = new Date(2026, 9, 2, 19, 0).getTime(); // 금요일
  const fiveAt = new Date(2026, 9, 2, 22, 20).getTime();
  const weekAt = new Date(2026, 9, 8, 16, 0).getTime(); // 목요일
  const auto = { v: 2, pinned: 'a2', slots: { a2: { five: { used: 60.4, resetsAt: fiveAt }, week: { used: 10, resetsAt: weekAt }, seenAt: now - 3 * 60_000 }, a1: { blockedUntil: weekAt, why: 'week' } } };

  it('지금 계정·고정·남은 %(위 막대와 같은 기준)·리셋 시각(5시간 시:분, 주간 요일 시:분)·몇 분 전', () => {
    const [b, a] = popRows(view({ auto }), now);
    expect(b).toEqual({ id: 'a2', name: '작은 것', on: true, pinned: true, pinHint: true, five: 40, week: 90, left: 40, stop: null, note: '5시간 22:20 · 주간 목 16:00 초기화 · 3분 전', title: 'b@x.com · Max 5x', tip: '5시간 40% 남음 · 22:20 초기화\n주간 90% 남음 · 목 16:00 초기화\n3분 전 · b@x.com · Max 5x' });
    expect(a).toEqual({ id: 'a1', name: '큰 것', on: false, pinned: false, pinHint: false, five: null, week: null, left: null, stop: '~10/08 16:00', note: '주간 소진 ~10/08 16:00', title: 'a@x.com · Max 20x', tip: '주간 소진 ~10/08 16:00\na@x.com · Max 20x' });
  });

  it('고정 표시 — 자동 전환이 켜져 있을 때만 "다 쓰면 넘어감"(pinHint)', () => {
    expect(popRows(view({ auto: { ...auto, on: false } }), now)[0]).toMatchObject({ pinned: true, pinHint: false });
  });

  it('값이 없으면 null(— 로 그린다), 칸이 없으면 빈 목록', () => {
    expect(popRows(view(), now)[0]).toMatchObject({ five: null, week: null, note: '' });
    expect(popRows(null, now)).toEqual([]);
  });
});

describe('popHead — 팝오버 머리: 지금 계정의 다가오는 초기화 + 다 쓰면 어디로', () => {
  const now = new Date(2026, 9, 2, 19, 0).getTime(); // 금요일
  const fiveAt = new Date(2026, 9, 2, 22, 20).getTime();
  const weekAt = new Date(2026, 9, 8, 16, 0).getTime(); // 목요일
  const a2 = { five: { used: 60, resetsAt: fiveAt }, week: { used: 10, resetsAt: weekAt }, seenAt: now };
  const a1 = { five: { used: 20, resetsAt: fiveAt + 3_600_000 }, week: { used: 50, resetsAt: weekAt }, seenAt: now };

  it('줄 숫자는 5시간·주간 중 적은 쪽(left) — 먼저 막히는 한도', () => {
    const [b, a] = popRows(view({ auto: { v: 2, slots: { a2, a1 } } }), now);
    expect([b!.left, a!.left]).toEqual([40, 50]);
  });

  it('가장 가까운 초기화 + 자동 전환이 켜져 있으면 넘어갈 계정(순서상 쓸 수 있는 첫 칸)', () => {
    expect(popHead(view({ auto: { v: 2, on: true, slots: { a2, a1 } } }), now)).toEqual({ next: '22:20에 5시간 초기화', after: '다 쓰면 큰 것으로', warn: false });
  });

  it('주간이 먼저면 요일 시각, 자동 전환이 꺼져 있으면 넘어갈 곳은 안 적는다', () => {
    const early = { ...a2, five: undefined };
    expect(popHead(view({ auto: { v: 2, on: false, slots: { a2: early, a1 } } }), now)).toEqual({ next: '목 16:00에 주간 초기화', after: null, warn: false });
  });

  it('넘어갈 칸이 다 막혔으면 그렇다고, 지금 칸이 막혔으면 그 상태를 경고로', () => {
    const blocked = { blockedUntil: weekAt, why: 'week' as const };
    expect(popHead(view({ auto: { v: 2, on: true, slots: { a2, a1: blocked } } }), now).after).toBe('다 쓰면 넘어갈 계정 없음');
    expect(popHead(view({ auto: { v: 2, on: false, slots: { a2: blocked, a1 } } }), now)).toEqual({ next: '주간 소진 ~10/08 16:00', after: null, warn: true });
  });

  it('다 소진이면 풀리는 때를 경고로, 사용량을 모르면 초기화 줄은 비고, 칸이 없으면 빈 머리', () => {
    expect(popHead(view({ auto: { v: 2, on: true, allOutUntil: fiveAt, slots: { a2, a1 } } }), now)).toMatchObject({ next: '다 소진 · 22:20 풀림', warn: true });
    expect(popHead(view(), now)).toEqual({ next: null, after: '다 쓰면 큰 것으로', warn: false }); // 자동 전환은 기본 켜짐 — 사용량을 몰라도 넘어갈 곳은 안다
    expect(popHead(null, now)).toEqual({ next: null, after: null, warn: false });
  });

  it('영어', () => {
    setLang('en');
    expect(popHead(view({ auto: { v: 2, on: true, slots: { a2, a1 } } }), now)).toEqual({ next: '5h resets at 22:20', after: 'Then 큰 것', warn: false });
  });
});

describe('weekText — 주간 리셋 시각은 요일 시:분', () => {
  it('한국어·영어', () => {
    expect(weekText(new Date(2026, 9, 8, 16, 0).getTime())).toBe('목 16:00');
    setLang('en');
    expect(weekText(new Date(2026, 9, 8, 16, 0).getTime())).toBe('Thu 16:00');
  });
});
