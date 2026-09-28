import { describe, expect, it } from 'vitest';
import { parseRoutines, routineState, scheduleText, type Routine } from './routine';

const r = (over: Partial<Routine> = {}): Routine => ({
  name: 'blog-daily', schedule: 'daily 09:00', cwd: '/d', enabled: true, instructions: '/d/ROUTINE.md', next: '2026-09-29T09:00',
  last: null, lastStart: null, runs: [], ...over,
});

describe('루틴 상태 — 사이드바 표시', () => {
  it('세션이 돌고 있으면 도는 중', () => expect(routineState(r(), [{ name: 'routine-blog-daily', state: 'working' }])).toBe('running'));
  it('꺼 두면 일시정지', () => expect(routineState(r({ enabled: false }), [])).toBe('paused'));
  it('마지막 결과가 실패면 실패(시작 뒤의 보고일 때)', () =>
    expect(routineState(r({ lastStart: { event: 'start', ts: '2026-09-28T09:00:00' }, last: { event: 'end', ts: '2026-09-28T09:10:00', result: 'fail', note: 'x' } }), [])).toBe('failed'));
  it('새로 시작했는데 아직 보고 전이고 세션도 없으면 보고 없음', () =>
    expect(routineState(r({ lastStart: { event: 'start', ts: '2026-09-28T10:00:00' }, last: { event: 'end', ts: '2026-09-28T09:10:00', result: 'ok' } }), [])).toBe('noReport'));
  it('성공', () => expect(routineState(r({ lastStart: { event: 'start', ts: '2026-09-28T09:00:00' }, last: { event: 'end', ts: '2026-09-28T09:05:00', result: 'ok' } }), [])).toBe('ok'));
  it('한 번도 안 돌았으면 대기', () => expect(routineState(r(), [])).toBe('waiting'));
});

describe('목록 읽기와 일정 글자', () => {
  it('깨진 글자면 빈 목록', () => expect(parseRoutines('nope')).toEqual([]));
  it('배열만 받는다', () => expect(parseRoutines(JSON.stringify([r()]))[0]?.name).toBe('blog-daily'));
  it('일정을 사람 말로', () => {
    expect(scheduleText('daily 09:00')).toMatch(/09:00/);
    expect(scheduleText('every 2h')).toMatch(/2/);
  });
});
