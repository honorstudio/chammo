import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { accountError, addState, allOut, moved, popRows, slotText, slotUsageText, topLabel, usageOf, weekText, type AccountsView } from './accounts';

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
    expect(b).toEqual({ id: 'a2', name: '작은 것', on: true, pinned: true, five: 40, week: 90, note: '5시간 22:20 · 주간 목 16:00 초기화 · 3분 전', title: 'b@x.com · Max 5x' });
    expect(a).toEqual({ id: 'a1', name: '큰 것', on: false, pinned: false, five: null, week: null, note: '주간 소진 ~10/08 16:00', title: 'a@x.com · Max 20x' });
  });

  it('값이 없으면 null(— 로 그린다), 칸이 없으면 빈 목록', () => {
    expect(popRows(view(), now)[0]).toMatchObject({ five: null, week: null, note: '' });
    expect(popRows(null, now)).toEqual([]);
  });
});

describe('weekText — 주간 리셋 시각은 요일 시:분', () => {
  it('한국어·영어', () => {
    expect(weekText(new Date(2026, 9, 8, 16, 0).getTime())).toBe('목 16:00');
    setLang('en');
    expect(weekText(new Date(2026, 9, 8, 16, 0).getTime())).toBe('Thu 16:00');
  });
});
