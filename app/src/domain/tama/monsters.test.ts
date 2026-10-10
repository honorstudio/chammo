import { describe, expect, it } from 'vitest';
import { coinsOf, EMPTY_MONSTERS, slayEvents, watch, type Monsters, type Watch } from './monsters';
import type { TamaEvent } from './pet';

const H = 3_600_000, MIN = 60_000, D = 24 * H;
const T0 = new Date(2026, 10, 2, 10).getTime();
const ci = (h: number, pass: boolean, repo = 'acme-shop'): TamaEvent => ({ t: T0 + h * H, type: 'ci', pass, label: repo });
const none: Watch = { ci: null, stuck: null, alive: null, prs: null };

describe('빨간 슬라임 — 한 저장소 CI 가 두 번 넘게 연속 빨강', () => {
  it('한 번 빨강은 안 나오고, 두 번 연속이면 Lv.2 로 나온다', () => {
    expect(watch(EMPTY_MONSTERS, { ...none, ci: [ci(0, true), ci(1, false)] }, T0 + 2 * H).state.live).toEqual([]);
    const s = watch(EMPTY_MONSTERS, { ...none, ci: [ci(0, true), ci(1, false), ci(2, false)] }, T0 + 3 * H).state;
    expect(s.live).toEqual([{ id: 'ci:acme-shop', kind: 'slime', where: 'acme-shop', since: T0 + H, lv: 2, at: T0 + 3 * H }]);
  });

  it('다른 저장소의 초록은 상관없다 — 그 저장소에 초록이 와야 처치', () => {
    const red = [ci(1, false), ci(2, false)];
    let s = watch(EMPTY_MONSTERS, { ...none, ci: red }, T0 + 3 * H).state;
    s = watch(s, { ...none, ci: [...red, ci(3, true, 'pixel-blog')] }, T0 + 4 * H).state;
    expect(s.live).toHaveLength(1);
    s = watch(s, { ...none, ci: [...red, ci(3, false), ci(5, true)] }, T0 + 6 * H).state;
    expect(s.live).toEqual([]);
    expect(s.log).toEqual([{ id: 'ci:acme-shop', kind: 'slime', where: 'acme-shop', lv: 3, at: T0 + 3 * H, end: T0 + 5 * H }]);
  });

  it('사흘 넘게 새 실행이 없으면 지쳐서 떠난다(보상 없음) — 버려진 저장소가 몬스터로 남지 않게', () => {
    const red = [ci(1, false), ci(2, false)];
    const s = watch(watch(EMPTY_MONSTERS, { ...none, ci: red }, T0 + 3 * H).state, { ...none, ci: red }, T0 + 4 * D).state;
    expect(s.live).toEqual([]);
    expect(s.log[0]).toMatchObject({ kind: 'slime', fled: true });
    expect(slayEvents(s)).toEqual([]);
  });
});

describe('졸음 유령 — 선택지 창에서 30분 넘게 멈춘 세션', () => {
  const stuck = [{ id: 's-1', name: 'todo-api' }];
  it('처음 본 뒤 30분이 지나야 나온다', () => {
    let s = watch(EMPTY_MONSTERS, { ...none, stuck, alive: ['s-1'] }, T0).state;
    expect(s.live[0]).toMatchObject({ kind: 'ghost', since: T0 });
    expect(s.live[0]?.at).toBeUndefined();
    s = watch(s, { ...none, stuck, alive: ['s-1'] }, T0 + 30 * MIN).state;
    expect(s.live[0]).toMatchObject({ lv: 1, at: T0 + 30 * MIN });
  });

  it('30분 안에 풀리면 조용히 사라진다(기록 없음)', () => {
    const s = watch(watch(EMPTY_MONSTERS, { ...none, stuck, alive: ['s-1'] }, T0).state, { ...none, stuck: [], alive: ['s-1'] }, T0 + 10 * MIN).state;
    expect(s).toEqual(EMPTY_MONSTERS);
  });

  it('나온 뒤 세션이 다시 움직이면 처치, 세션이 사라지면 도망', () => {
    const up = watch(watch(EMPTY_MONSTERS, { ...none, stuck, alive: ['s-1'] }, T0).state, { ...none, stuck, alive: ['s-1'] }, T0 + 2 * H).state;
    expect(up.live[0]?.lv).toBe(2);
    const won = watch(up, { ...none, stuck: [], alive: ['s-1'] }, T0 + 3 * H).state;
    expect(won.log[0]).toMatchObject({ kind: 'ghost', where: 'todo-api', end: T0 + 3 * H });
    expect(won.log[0]?.fled).toBeUndefined();
    const gone = watch(up, { ...none, stuck: [], alive: [] }, T0 + 3 * H).state;
    expect(gone.log[0]?.fled).toBe(true);
  });
});

describe('서류 골렘 — 사흘 넘게 열린 PR(초안 빼고)', () => {
  const pr = (days: number, draft = false) => ({ key: 'acme/shop#12', where: 'acme-shop #12', createdAt: T0 - days * D, draft });
  it('사흘 안 된 것·초안은 안 나온다', () => {
    expect(watch(EMPTY_MONSTERS, { ...none, prs: [pr(2), { ...pr(5, true), key: 'x#1' }] }, T0).state.live).toEqual([]);
  });

  it('사흘이면 Lv.1, 닫히면(목록에서 빠지면) 처치', () => {
    const s = watch(EMPTY_MONSTERS, { ...none, prs: [pr(4)] }, T0).state;
    expect(s.live[0]).toMatchObject({ kind: 'golem', where: 'acme-shop #12', lv: 2 });
    expect(watch(s, { ...none, prs: [] }, T0 + H).state.log[0]).toMatchObject({ kind: 'golem', end: T0 + H });
  });

  it('모르는 칸(null)은 건드리지 않는다 — 리뷰를 못 읽은 분에 골렘이 처치되지 않게', () => {
    const s = watch(EMPTY_MONSTERS, { ...none, prs: [pr(4)] }, T0).state;
    expect(watch(s, none, T0 + H).state.live).toHaveLength(1);
  });
});

describe('방치 벌은 약하게 · 처치 보상', () => {
  it('나온 지 6시간이면 간식을 한 번만 훔쳐 먹는다', () => {
    const red = { ...none, ci: [ci(1, false), ci(2, false)] };
    let r = watch(EMPTY_MONSTERS, red, T0 + 3 * H);
    expect(r.stolen).toBe(0);
    r = watch(r.state, red, T0 + 9 * H);
    expect(r.stolen).toBe(1);
    expect(watch(r.state, red, T0 + 20 * H).stolen).toBe(0);
  });

  it('처치 = 코인 사건(레벨 × 5, 15 까지), 도망은 없음', () => {
    const s: Monsters = { live: [], log: [
      { id: 'a', kind: 'slime', where: 'x', lv: 4, at: 1, end: 100 },
      { id: 'b', kind: 'ghost', where: 'y', lv: 1, at: 1, end: 200, fled: true },
    ] };
    expect(slayEvents(s)).toEqual([{ t: 100, type: 'slay', kind: 'slime', lv: 4, label: 'x' }]);
    expect([coinsOf(1), coinsOf(2), coinsOf(9)]).toEqual([5, 10, 15]);
  });
});
