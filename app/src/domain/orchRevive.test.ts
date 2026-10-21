import { describe, expect, it } from 'vitest';
import { emptyRevive, GONE_GRACE, MAX_TRIES, planRevive, reviveCard, TRY_WINDOW, type ReviveMemo } from './orchRevive';

const orch = (id: string, name = `참모-${id}`) => ({ id, sessionId: `${id}-full`, name, cwd: '/hq' });
const A = orch('aaaaaaaa', '참모-2 · 참모 업데이트');
const B = orch('bbbbbbbb', '참모 · 회사 비서');
const base = { daemon: 100, stoppedByApp: () => false, alive: () => false };

/** 폴링 한 번 — 살아 있는 참모 목록을 넣고 다음 기억·할 일을 받는다 */
const poll = (m: ReviveMemo, live: typeof A[], now: number, o: Partial<Parameters<typeof planRevive>[1]> = {}) => planRevive(m, { ...base, live, now, ...o });

describe('planRevive — 참모가 앱이 끄지 않았는데 목록에서 사라지면 같은 대화로 다시 켠다', () => {
  it('처음 보는 목록은 기억만 — 앱을 켰을 때 이미 없는 참모는 재시작 복구(lostTriage) 몫', () => {
    const r = poll(emptyRevive, [], 0);
    expect(r.revive).toEqual([]);
  });

  it('살아 있던 참모가 잠깐(respawn 1~2초) 빠졌다 돌아오면 아무것도 안 한다', () => {
    let m = poll(emptyRevive, [A], 0).memo;
    const r1 = poll(m, [], 3000); m = r1.memo;
    expect(r1.revive).toEqual([]);
    const r2 = poll(m, [A], 6000);
    expect(r2.revive).toEqual([]);
    expect(poll(r2.memo, [A], 6000 + GONE_GRACE * 2).revive).toEqual([]);
  });

  it('재현: 사라진 채 GONE_GRACE 가 지나면 그 참모를 다시 켠다 — 한 번만(다시 켜는 동안 또 안 누른다)', () => {
    let m = poll(emptyRevive, [A, B], 0).memo;
    m = poll(m, [B], 3000).memo;
    const r = poll(m, [B], 3000 + GONE_GRACE);
    expect(r.revive.map((x) => x.id)).toEqual([A.id]);
    expect(poll(r.memo, [B], 3000 + GONE_GRACE + 3000).revive).toEqual([]);
  });

  it('/rename 으로 도우미 칸에 옮겨 간 살아 있는 세션은 사라진 게 아니다 — 켜지도 세지도 카드도 없이 잊는다(0.3.6 리뷰)', () => {
    let m = poll(emptyRevive, [A], 0).memo;
    const alive = (id: string) => id === A.id; // 참모 묶음엔 없지만 agents 목록엔 산다
    let r = poll(m, [], 3000, { alive });
    for (let t = 3000; t < 3000 + TRY_WINDOW; t += 3000) { r = poll(r.memo, [], t, { alive }); expect(r.revive).toEqual([]); expect(r.giveUp).toEqual([]); }
    expect(r.memo.seen[A.id]).toBeUndefined();
    expect(r.memo.tries[A.id]).toBeUndefined();
    m = r.memo;
    // 다시 참모 이름으로 돌아오면 그때부터 다시 본다
    m = poll(m, [A], 700_000).memo;
    expect(m.seen[A.id]).toBeDefined();
  });

  it('멈춤 카드가 열린 참모가 도우미 이름으로 살아 있으면 카드를 닫는다', () => {
    const m: ReviveMemo = { ...emptyRevive, seen: { [A.id]: { s: A, daemon: 100 } }, goneAt: { [A.id]: 0 }, gaveUp: { [A.id]: 5 }, cardAt: { [A.id]: 5 } };
    const r = poll(m, [], 60_000, { alive: (id) => id === A.id });
    expect(r.closed.map((x) => x.id)).toEqual([A.id]);
  });

  it('앱이 끈(끄기 버튼·폰·지우기) 참모는 다시 켜지 않고 잊는다', () => {
    let m = poll(emptyRevive, [A], 0).memo;
    m = poll(m, [], 3000, { stoppedByApp: (id) => id === A.id }).memo;
    const r = poll(m, [], 3000 + GONE_GRACE, { stoppedByApp: (id) => id === A.id });
    expect(r.revive).toEqual([]);
    expect(poll(r.memo, [], 3000 + GONE_GRACE * 5).revive).toEqual([]);
  });

  it('관리 프로그램(daemon)이 다시 켜져 꺼진 것은 재시작 복구 몫 — 여기선 손대지 않는다', () => {
    let m = poll(emptyRevive, [A], 0).memo;
    m = poll(m, [], 3000, { daemon: 200 }).memo;
    expect(poll(m, [], 3000 + GONE_GRACE, { daemon: 200 }).revive).toEqual([]);
  });

  it('daemon 시작 시각을 못 읽으면(null) 판단을 미룬다', () => {
    let m = poll(emptyRevive, [A], 0).memo;
    m = poll(m, [], 3000, { daemon: null }).memo;
    expect(poll(m, [], 3000 + GONE_GRACE, { daemon: null }).revive).toEqual([]);
    expect(poll(m, [], 3000 + GONE_GRACE + 1, { daemon: 100 }).revive.map((x) => x.id)).toEqual([A.id]);
  });

  it('다시 켰는데 안 뜨면 GONE_GRACE 마다가 아니라 RETRY 뒤에 또 — 그리고 TRY_WINDOW 안에 MAX_TRIES 번이면 멈추고 카드 한 번', () => {
    let m = poll(emptyRevive, [A], 0).memo;
    let t = 0;
    const tries: number[] = [];
    let cards = 0;
    for (let i = 0; i < 40; i++) {
      t += 5000;
      const r = poll(m, [], t);
      m = r.memo;
      if (r.revive.length) tries.push(t);
      cards += r.giveUp.length;
    }
    expect(tries.length).toBe(MAX_TRIES);
    expect(cards).toBe(1);
  });

  it('연달아 죽는 경우: 살아났다 죽기를 되풀이해도 10분 3번이면 멈춘다', () => {
    let m = poll(emptyRevive, [A], 0).memo;
    let t = 0;
    let tries = 0;
    let cards = 0;
    for (let round = 0; round < 6; round++) {
      t += 5000; m = poll(m, [], t).memo;
      t += GONE_GRACE; const r = poll(m, [], t); m = r.memo; tries += r.revive.length; cards += r.giveUp.length;
      t += 5000; m = poll(m, [A], t).memo; // 다시 뜸
    }
    expect(t).toBeLessThan(TRY_WINDOW);
    expect(tries).toBe(MAX_TRIES);
    expect(cards).toBe(1);
  });

  it('멈춘 뒤 10분이 지나면 다시 켜 볼 수 있다(옛 시도는 창 밖)', () => {
    let m = poll(emptyRevive, [A], 0).memo;
    let t = 0;
    for (let i = 0; i < 40; i++) { t += 5000; m = poll(m, [], t).memo; }
    t += TRY_WINDOW;
    const r = poll(m, [], t);
    expect(r.revive.map((x) => x.id)).toEqual([A.id]);
  });

  it('하나가 멈춰도 다른 참모는 따로 센다', () => {
    let m = poll(emptyRevive, [A, B], 0).memo;
    m = poll(m, [B], 3000).memo;
    const r = poll(m, [], 3000 + GONE_GRACE);
    expect(r.revive.map((x) => x.id)).toEqual([A.id]);
  });
});

describe('멈춘 참모가 다시 뜨면(사람이 홈에서 켬) 카드를 닫는다', () => {
  it('giveUp 뒤 살아난 참모는 closed 로 한 번', () => {
    let m = poll(emptyRevive, [A], 0).memo;
    let t = 0;
    for (let i = 0; i < 40; i++) { t += 5000; m = poll(m, [], t).memo; }
    const back = poll(m, [A], t + 1000);
    expect(back.closed.map((x) => x.id)).toEqual([A.id]);
    expect(poll(back.memo, [A], t + 2000).closed).toEqual([]);
  });
});

describe('reviveCard — 멈췄을 때 결정 대기함 카드(작업 기록 send + ask)', () => {
  it('참모 이름과 횟수, 사람이 할 일 한 줄', () => {
    const [send, ask] = reviveCard(A, '2026-10-21T00:00:00.000Z', 'r1');
    expect(send).toMatchObject({ type: 'send', task: 'r1', target: A.name });
    expect(ask).toMatchObject({ type: 'ask', task: 'r1' });
    expect(String(ask.note)).toContain('참모 업데이트');
    expect(String(ask.note)).toContain(String(MAX_TRIES));
    expect(String(reviveCard(orch('cccccccc', '참모'), 't', 'r2')[1].note)).not.toContain('참모 참모');
  });
});
