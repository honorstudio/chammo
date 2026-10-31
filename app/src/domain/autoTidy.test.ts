import { describe, expect, it } from 'vitest';
import { pickTidy, TIDY_DONE_MS, TIDY_LOOSE_MS, tidyKey, tidyLight, tidyText, tidyVerdict, type TidyCand } from './autoTidy';
import type { Activity } from './activity';
import type { Session } from './session';
import type { TaskEvent } from './tasks';

const H = 3600_000;
const NOW = Date.parse('2026-10-23T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const s = (id: string, over: Partial<Session> = {}): Session => ({
  id, name: id, cwd: `/dev/${id}`, kind: 'background', state: 'idle', project: id, workspace: null, startedAt: NOW - 30 * H, sessionId: `sid-${id}`, ...over,
});
const act = (at: number, over: Partial<Activity> = {}): Activity => ({ lastAt: iso(at), reply: { ts: iso(at), text: '다 했어', turnEnd: true } as Activity['reply'], ...over });
const send = (task: string, target: string, at: number): TaskEvent => ({ ts: iso(at), type: 'send', task, target, from: 'orch', title: '일' });
const done = (task: string, at: number): TaskEvent => ({ ts: iso(at), type: 'done', task });
const clean = { dirty: false, unmerged: false };
const orch = s('orch', { name: '참모' });

/** 맡긴 일 하나를 3시간 전에 닫고 그 뒤로 조용한 세션 */
const finished = (over: Partial<TidyCand> = {}, events?: TaskEvent[]) => {
  const c: TidyCand = { session: s('shop'), activity: act(NOW - 3 * H), git: clean, ...over };
  return { c, events: events ?? [send('t1', 'shop', NOW - 5 * H), done('t1', NOW - 3 * H)] };
};
const verdict = (c: TidyCand, events: TaskEvent[], extra: { asking?: Set<string> } = {}) => tidyVerdict(c, { events, now: NOW, asking: extra.asking ?? new Set() });

describe('tidyVerdict — 정리할 세션인가', () => {
  it('맡긴 일이 다 끝나고 2시간 조용하면 정리(done)', () => {
    const { c, events } = finished();
    expect(verdict(c, events)?.reason).toBe('done');
  });

  it('다 끝났어도 2시간이 안 지났으면 아직', () => {
    const { c, events } = finished({ activity: act(NOW - TIDY_DONE_MS + 60_000) });
    expect(verdict(c, events)).toBeUndefined();
  });

  it('일 기록(done)이 마지막 움직임이면 그때부터 센다', () => {
    const { c } = finished({ activity: act(NOW - 5 * H) });
    expect(verdict(c, [send('t1', 'shop', NOW - 6 * H), done('t1', NOW - H)])).toBeUndefined();
  });

  it('안 닫힌 일이 있으면 뺀다', () => {
    const { c } = finished();
    expect(verdict(c, [send('t1', 'shop', NOW - 9 * H), done('t1', NOW - 8 * H), send('t2', 'shop', NOW - 7 * H)])).toBeUndefined();
  });

  it('맡긴 기록이 없는 세션은 24시간 넘게 조용해야 정리(quiet)', () => {
    const c: TidyCand = { session: s('loose'), activity: act(NOW - 10 * H), git: clean };
    expect(verdict(c, [])).toBeUndefined();
    const old: TidyCand = { session: s('loose'), activity: act(NOW - TIDY_LOOSE_MS - 60_000), git: clean };
    expect(verdict(old, [])?.reason).toBe('quiet');
  });

  it('task wait 표시가 살아 있으면 빼다 — until 이 지나면 다시 대상', () => {
    const base = [send('t1', 'shop', NOW - 9 * H), done('t1', NOW - 8 * H)];
    const w = (until?: string): TaskEvent => ({ ts: iso(NOW - 7 * H), type: 'wait', task: 't1', note: '심사', ...(until ? { until } : {}) });
    const { c } = finished({ activity: act(NOW - 7 * H) });
    expect(verdict(c, [...base, w()])).toBeUndefined();
    expect(verdict(c, [...base, w(iso(NOW + H))])).toBeUndefined();
    expect(verdict(c, [...base, w(iso(NOW - H))])?.reason).toBe('done');
  });

  it('결정 대기(ask 뒤 answer 없음)·직접 답하기 카드가 걸려 있으면 뺀다', () => {
    const { c, events } = finished();
    expect(verdict(c, [...events, { ts: iso(NOW - 3 * H), type: 'ask', task: 't1', note: '정해 줘' }])).toBeUndefined();
    expect(verdict(c, [...events, { ts: iso(NOW - 3 * H), type: 'ask', task: 't1' }, { ts: iso(NOW - 3 * H), type: 'answer', task: 't1' }])?.reason).toBe('done');
    expect(verdict(c, events, { asking: new Set(['sid-shop']) })).toBeUndefined();
  });

  it('커밋 안 한 변경·main 에 안 들어간 커밋이 있으면 뺀다', () => {
    expect(verdict(finished({ git: { dirty: true, unmerged: false } }).c, finished().events)).toBeUndefined();
    expect(verdict(finished({ git: { dirty: false, unmerged: true } }).c, finished().events)).toBeUndefined();
  });

  it('git 을 아직 안 봤으면(undefined) 판정은 하되 needGit 표시', () => {
    const v = verdict(finished({ git: undefined }).c, finished().events);
    expect(v?.needGit).toBe(true);
  });

  it('선택지 창 멈춤·사람 답 기다림·일하는 중·깨우기 예약은 뺀다', () => {
    const { events } = finished();
    for (const over of [{ waitingFor: 'input needed' }, { awaiting: true }, { state: 'working' as const }, { state: 'blocked' as const }]) {
      expect(verdict(finished({ session: s('shop', over) }).c, events)).toBeUndefined();
    }
    expect(verdict(finished({ activity: { ...act(NOW - 3 * H), wake: true } }).c, events)).toBeUndefined();
  });

  it('사람이 2시간 안에 직접 친 입력이 있으면 뺀다', () => {
    const { events } = finished();
    const a = { ...act(NOW - 3 * H), prompt: { ts: iso(NOW - H), text: '이거 봐 줘' } } as Activity;
    expect(verdict(finished({ activity: a }).c, events)).toBeUndefined();
  });

  it('대화형(터미널) 세션은 뺀다', () => {
    expect(verdict(finished({ session: s('shop', { kind: 'interactive' }) }).c, finished().events)).toBeUndefined();
  });

  it('이름이 같은 옛 세션에 보낸 일은 이 세션 몫이 아니다', () => {
    const c: TidyCand = { session: s('ab12cd34', { name: 'shop', startedAt: NOW - 30 * H }), activity: act(NOW - 25 * H), git: clean };
    // 옛 세션(이 세션이 뜨기 전)에 보낸 안 닫힌 일 — 이름만 같다
    expect(verdict(c, [send('old', 'shop', NOW - 40 * H)])?.reason).toBe('quiet');
  });
});

describe('pickTidy — 누구에게 한 번만', () => {
  const pick = (cands: TidyCand[], seen = new Set<string>(), to: Session | null = orch, events = finished().events) =>
    pickTidy(cands, { events, now: NOW, asking: new Set(), seen, toOf: () => to ?? undefined });

  it('맡긴 참모에게 하나 고른다', () => {
    const p = pick([finished().c]);
    expect(p?.cand.session.id).toBe('shop');
    expect(p?.to.id).toBe('orch');
  });

  it('같은 조용한 구간엔 한 번만 — 새로 움직이면 다시', () => {
    const { c, events } = finished();
    const v = verdict(c, events)!;
    expect(pick([c], new Set([tidyKey(c.session, v.since)]))).toBeUndefined();
    expect(pick([c], new Set([tidyKey(c.session, v.since - 1000)]))?.cand.session.id).toBe('shop');
  });

  it('참모가 일하는 중이거나 확인창이면 쌓아 둔다(이번엔 안 고름)', () => {
    expect(pick([finished().c], new Set(), { ...orch, state: 'working' })).toBeUndefined();
    expect(pick([finished().c], new Set(), { ...orch, state: 'blocked' })).toBeUndefined();
    expect(pick([finished().c], new Set(), null)).toBeUndefined();
  });

  it('git 을 아직 안 본 후보는 고르지 않는다', () => {
    expect(pick([finished({ git: undefined }).c])).toBeUndefined();
  });
});

describe('tidyText — 참모 입력칸 한 줄', () => {
  it('이름·번호·이유·할 일이 한 줄로', () => {
    const t = tidyText(s('shop', { id: 'ab12cd34' }), 'done');
    expect(t).toBe('[앱] 정리할 세션: shop(ab12cd34) — 맡긴 일 다 끝남·2시간 조용. starter·roadmap 갱신시키고 끄고, 끝난 워크트리는 정리');
    expect(tidyText(s('x', { workspace: 'feat-a' }), 'quiet')).toContain('하루 넘게 조용');
    expect(tidyText(s('x', { workspace: 'feat-a' }), 'quiet')).toContain('워크트리 feat-a');
    expect(t).not.toContain('\n');
  });
  it('어디까지 했나(대화 끝·git)를 이유 뒤에 붙인다', () => {
    const t = tidyText(s('shop', { id: 'ab12cd34' }), 'done', false, ' · git main@ab12cd3');
    expect(t).toBe('[앱] 정리할 세션: shop(ab12cd34) — 맡긴 일 다 끝남·2시간 조용 · git main@ab12cd3. starter·roadmap 갱신시키고 끄고, 끝난 워크트리는 정리');
  });
  // 0.4.1 2차 검증: 도우미·예약 세션은 starter 가 없다 — 갱신 시키면 HQ 에 docs/starter.md 를 만들 수 있다
  it('도우미·예약 세션이면 갱신 없이 바로 끄기', () => {
    const t = tidyText(s('sns-post', { id: 'ab12cd34' }), 'done', true);
    expect(t).toBe('[앱] 정리할 세션: sns-post(ab12cd34) — 맡긴 일 다 끝남·2시간 조용. 도우미·예약 세션이라 starter·roadmap 갱신 없이 바로 끄기');
    expect(tidyText(s('routine-daily'), 'quiet', true)).toContain('하루 넘게 조용. 도우미·예약 세션이라');
    expect(t).not.toContain('갱신시키고');
  });
  it('도우미(HQ 안 세션)나 예약(routine-<이름>)만 가볍게 — 프로젝트 세션은 아니다', () => {
    const helper = s('sns-post', { cwd: '/hq' });
    expect(tidyLight(helper, [helper])).toBe(true);
    expect(tidyLight(s('routine-daily'), [])).toBe(true);
    expect(tidyLight(s('shop'), [helper])).toBe(false);
    expect(tidyLight(s('my-routine-app'), [])).toBe(false);
  });
});
