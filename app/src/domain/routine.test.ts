import { describe, expect, it } from 'vitest';
import { cloudUrl, groupRoutines, isCloud, parseRoutines, routineItem, routineLine, routineState, routineStateLabel, routineRef, routineStatus, scheduleText, routineSummary, runEventText, type Routine } from './routine';

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

const NOW = new Date(2026, 9, 2, 15, 0); // 2026-10-02 15:00 (금)

describe('예약 — 사이드바 첫째 줄 상태 글자', () => {
  const started = { event: 'start' as const, ts: '2026-10-02T14:48:00' };
  it('도는 중이면 몇 분째인지', () => {
    expect(routineStatus(r({ lastStart: started }), 'running', NOW)).toBe('도는 중 12분');
    expect(routineStatus(r({ lastStart: { event: 'start', ts: '2026-10-02T14:59:50' } }), 'running', NOW)).toBe('도는 중 1분');
    expect(routineStatus(r(), 'running', NOW)).toBe('도는 중');
  });
  it('성공은 끝난 시각 — 오늘이면 시:분, 아니면 월/일', () => {
    expect(routineStatus(r({ last: { event: 'end', ts: '2026-10-02T08:31:10', result: 'ok' } }), 'ok', NOW)).toBe('끝 08:31');
    expect(routineStatus(r({ last: { event: 'end', ts: '2026-09-30T08:31:10', result: 'ok' } }), 'ok', NOW)).toBe('끝 09/30');
  });
  it('나머지는 상태 이름', () => {
    expect(routineStatus(r(), 'failed', NOW)).toBe('실패');
    expect(routineStatus(r(), 'noReport', NOW)).toBe('보고 없음');
    expect(routineStatus(r(), 'paused', NOW)).toBe('꺼 둠');
    expect(routineStatus(r(), 'waiting', NOW)).toBe('첫 실행 전');
    expect(routineStatus(r(), 'done', NOW)).toBe('끝남');
  });
});

describe('예약 — 한 번짜리(날짜)', () => {
  const once = (over: Partial<Routine> = {}) => r({ name: 'ad-revert', schedule: '2026-10-06 09:00, 2026-10-13 09:00', once: true, remaining: 2, next: '2026-10-06T09:00', ...over });
  const ok = { event: 'end' as const, ts: '2026-10-13T09:10:00', result: 'ok' as const };
  const st = { event: 'start' as const, ts: '2026-10-13T09:00:00' };

  it('마지막 날짜까지 끝나면 끝남 — 꺼져 있어도 꺼 둠이 아니다', () => {
    expect(routineState(once({ enabled: false, finished: '2026-10-13T09:10:00', remaining: 0, next: null, lastStart: st, last: ok }), [])).toBe('done');
  });
  it('끝났어도 마지막이 실패면 실패로 남는다', () => {
    expect(routineState(once({ enabled: false, finished: 'x', next: null, lastStart: st, last: { ...ok, result: 'fail' } }), [])).toBe('failed');
  });
  it('둘째 줄 — 다음 날짜 · 한 번 · 남은 횟수(2번 이상일 때)', () => {
    expect(routineLine(once(), NOW)).toBe('10/06 09:00 · 한 번 · 남은 2번');
    expect(routineLine(once({ remaining: 1, next: '2026-10-13T09:00' }), NOW)).toBe('10/13 09:00 · 한 번');
    expect(routineLine(once({ remaining: 0, next: null, finished: 'x' }), NOW)).toBe('10/13 09:00 · 한 번');
    expect(routineLine(once({ schedule: '2027-01-05 09:00', remaining: 1, next: '2027-01-05T09:00' }), NOW)).toBe('2027-01-05 09:00 · 한 번');
  });
  it('일정 글자 — 올해는 월/일, 다른 해는 연도까지', () => {
    expect(scheduleText('2026-10-06 09:00, 2026-10-13 09:00', NOW)).toBe('10/06 09:00, 10/13 09:00');
    expect(scheduleText('2027-01-05 09:00', NOW)).toBe('2027-01-05 09:00');
    expect(scheduleText('10/6 9:00', NOW)).toBe('10/06 09:00');
  });
});

describe('예약 — 반복 둘째 줄', () => {
  it('일정 · 다음 오늘/내일/날짜', () => {
    expect(routineLine(r({ schedule: 'daily 08:30', next: '2026-10-03T08:30' }), NOW)).toBe('매일 08:30 · 다음 내일 08:30');
    expect(routineLine(r({ schedule: 'daily 16:00', next: '2026-10-02T16:00' }), NOW)).toBe('매일 16:00 · 다음 오늘 16:00');
    expect(routineLine(r({ schedule: 'weekly mon 09:00', next: '2026-10-05T09:00' }), NOW)).toBe('매주 mon 09:00 · 다음 10/05 09:00');
    expect(routineLine(r({ schedule: 'daily 08:30', next: null, enabled: false }), NOW)).toBe('매일 08:30');
  });
});

describe('예약 — 정렬과 끝난 것 접기', () => {
  const item = (name: string, over: Partial<Routine>, sessions: { name: string; state: string }[] = []) => routineItem(r({ name, ...over }), sessions, NOW);
  it('도는 중 → 실패·보고 없음 → 다음 실행 가까운 순, 끝난 한 번짜리는 따로', () => {
    const items = [
      item('later', { next: '2026-10-05T09:00' }),
      item('soon', { next: '2026-10-02T16:00' }),
      item('paused', { enabled: false, next: null }),
      item('broke', { next: '2026-10-09T09:00', lastStart: { event: 'start', ts: '2026-10-02T09:00:00' }, last: { event: 'end', ts: '2026-10-02T09:01:00', result: 'fail' } }),
      item('busy', { next: '2026-10-09T09:00' }, [{ name: 'routine-busy', state: 'working' }]),
      item('gone', { once: true, finished: '2026-10-01T09:10:00', enabled: false, next: null, lastStart: { event: 'start', ts: '2026-10-01T09:00:00' }, last: { event: 'end', ts: '2026-10-01T09:10:00', result: 'ok' } }),
      item('cloudy', { kind: 'cloud', next: null, schedule: '매일 07:05' }),
    ];
    const g = groupRoutines(items);
    expect(g.active.map((x) => x.name)).toEqual(['busy', 'broke', 'soon', 'later', 'cloudy', 'paused']);
    expect(g.done.map((x) => x.name)).toEqual(['gone']);
  });
  it('항목은 상태·첫째 줄·둘째 줄을 함께 준다', () => {
    const x = item('soon', { schedule: 'daily 16:00', next: '2026-10-02T16:00' });
    expect([x.state, x.status, x.line, x.cloud]).toEqual(['waiting', '첫 실행 전', '매일 16:00 · 다음 오늘 16:00', false]);
  });
});

describe('클라우드 루틴(claude.ai) — 목록에만 보이고 여기서 돌리지 않는다', () => {
  const url = 'https://claude.ai/code/routines/trig_01abc';
  const c = (over: Partial<Routine> = {}): Routine =>
    r({ name: 'sentry-morning', kind: 'cloud', schedule: '매일 07:05', url, note: 'Sentry 아침 점검', cwd: '', instructions: '', next: null, ...over });

  it('kind 가 cloud 면 클라우드', () => {
    expect(isCloud(c())).toBe(true);
    expect(isCloud(r())).toBe(false);
    expect(isCloud(r({ kind: 'local' }))).toBe(false);
  });
  it('상태는 늘 클라우드 — 이 맥의 세션 이름이 겹쳐도 도는 중으로 안 본다', () => {
    expect(routineState(c(), [{ name: 'routine-sentry-morning', state: 'working' }])).toBe('cloud');
    expect(routineStateLabel('cloud')).toMatch(/클라우드|Cloud/);
  });
  it('열기 주소는 https 만', () => {
    expect(cloudUrl(c())).toBe(url);
    for (const bad of ['http://claude.ai/x', 'file:///etc/passwd', 'javascript:alert(1)', '', undefined]) expect(cloudUrl(c({ url: bad }))).toBeNull();
    expect(cloudUrl(r({ url }))).toBeNull(); // 로컬 루틴은 열 주소가 없다
  });
  it('사이드바 둘째 줄 — 클라우드는 일정·메모', () => {
    expect(routineLine(c(), NOW)).toBe('매일 07:05 · Sentry 아침 점검');
    expect(routineLine(c({ note: '' }), NOW)).toBe('매일 07:05');
  });
  it('목록 읽기에서 kind·url·note 를 그대로 둔다', () => {
    const [x] = parseRoutines(JSON.stringify([c()]));
    expect([x?.kind, x?.url, x?.note]).toEqual(['cloud', url, 'Sentry 아침 점검']);
  });
});

describe('예약 → 채팅 참조 글 — 참모에게 끌어다 넣기(2026-10-02 사용자 "파일 참조처럼")', () => {
  it('로컬: 이름·일정(사람 말)·폴더·지침서 경로', () =>
    expect(routineRef(r())).toBe('[예약 blog-daily · 매일 09:00 · 폴더 /d · 지침서 /d/ROUTINE.md]'));
  it('한 번짜리는 일정 뒤에 "한 번"', () =>
    expect(routineRef(r({ schedule: '2026-10-06 09:00', once: true }), new Date('2026-10-02T12:00:00'))).toBe('[예약 blog-daily · 10/06 09:00 한 번 · 폴더 /d · 지침서 /d/ROUTINE.md]'));
  it('클라우드: 지침서 대신 주소', () =>
    expect(routineRef(r({ kind: 'cloud', url: 'https://claude.ai/code/routines/x', cwd: '', instructions: '' }))).toBe('[클라우드 예약 blog-daily · 매일 09:00 · https://claude.ai/code/routines/x]'));
  it('목록 줄도 같은 참조 글을 들고 있다(사이드바에서 끌 때)', () =>
    expect(routineItem(r(), []).ref).toBe(routineRef(r())));
});

describe('routineSummary — 폰 예약 판 요약 한 줄(2026-10-03 사용자 "아무것도 안 보이는 건 오늘 할 게 없다는 거야?")', () => {
  const now = new Date(2026, 9, 3, 17, 0);
  const r = (name: string, next: string | null, extra: Partial<Routine> = {}): Routine =>
    ({ name, schedule: '매일 07:30', cwd: '', enabled: true, instructions: '', next, last: null, lastStart: null, runs: [], ...extra }) as Routine;
  it('몇 개 · 다음 실행 가장 가까운 것', () => {
    expect(routineSummary([r('inbox-tidy', '2026-10-04T08:20:00'), r('docs-sync', '2026-10-04T07:30:00')], now)).toBe('예약 2개 · 다음 내일 07:30 docs-sync');
  });
  it('꺼 둔 것·클라우드는 다음 실행에서 빼고, 다음이 없으면 그렇게', () => {
    expect(routineSummary([r('a', '2026-10-04T06:00:00', { enabled: false }), r('b', null)], now)).toBe('예약 2개 · 다음 실행 없음');
    expect(routineSummary([r('c', '2026-10-04T05:00:00', { kind: 'cloud' }), r('d', '2026-10-03T21:00:00')], now)).toBe('예약 2개 · 다음 오늘 21:00 d');
  });
  it('하나도 없으면', () => {
    expect(routineSummary([], now)).toBe('예약 없음');
  });
});

describe('실행 기록 한 줄', () => {
  it('다시 시도 줄은 성공으로 안 보인다', () => {
    const t = runEventText({ event: 'retry', ts: '2026-10-05T05:04:41', reason: 'workspace not trusted — re-wrote trust, retrying once' });
    expect(t).toMatch(/다시 시도|Retried/);
    expect(t).not.toMatch(/성공|OK/);
  });
  it('다시 시도 이유가 갈린다 — 믿음 풀림 / 시작 일시 오류', () => {
    expect(runEventText({ event: 'retry', ts: 't', reason: 'workspace not trusted — re-wrote trust, retrying once' })).toMatch(/믿음|trust/);
    const t = runEventText({ event: 'retry', ts: 't', reason: 'start failed (error: An unknown error occurred (Unexpected)) — waiting 5s, retrying once' });
    expect(t).toMatch(/시작이 실패|failed to start/);
    expect(t).toMatch(/Unexpected/);
    expect(t).not.toMatch(/믿음|trust/);
  });
  it('시작 실패·건너뜀·결과', () => {
    expect(runEventText({ event: 'start', ts: 't', error: 'Workspace not trusted' })).toMatch(/Workspace not trusted/);
    expect(runEventText({ event: 'skip', ts: 't' })).toMatch(/건너뜀|Skipped/);
    expect(runEventText({ event: 'end', ts: 't', result: 'fail', note: 'x' })).toMatch(/실패 — x|Failed — x/);
  });
});
