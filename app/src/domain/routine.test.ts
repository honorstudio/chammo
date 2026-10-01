import { describe, expect, it } from 'vitest';
import { cloudUrl, isCloud, parseRoutines, routineLine, routineState, routineStateLabel, scheduleText, type Routine } from './routine';

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
  it('사이드바 줄 — 로컬은 일정·상태, 클라우드는 일정·메모', () => {
    expect(routineLine(r(), 'ok')).toMatch(/09:00 · (성공|OK)/);
    expect(routineLine(c(), 'cloud')).toBe('매일 07:05 · Sentry 아침 점검');
    expect(routineLine(c({ note: '' }), 'cloud')).toBe('매일 07:05');
  });
  it('목록 읽기에서 kind·url·note 를 그대로 둔다', () => {
    const [x] = parseRoutines(JSON.stringify([c()]));
    expect([x?.kind, x?.url, x?.note]).toEqual(['cloud', url, 'Sentry 아침 점검']);
  });
});
