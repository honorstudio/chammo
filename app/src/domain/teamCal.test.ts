import { describe, expect, it } from 'vitest';
import {
  addDays, byDay, calPutOk, cleanDraft, draftOf, monthCells, occurrences, upcoming, weekDays, withDone, ymd,
  type CalData, type CalItem, type CalSnap,
} from './teamCal';

const item = (id: string, data: Partial<CalData>, o: Partial<CalItem> = {}): CalItem => ({
  id, rev: 1, by: 'm1', at: 1, del: false, deletedAt: null, why: '',
  data: { title: id, allDay: true, start: '2026-10-30', end: '2026-10-31', ...data } as CalData,
  ...o,
});
const local = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).toISOString();

describe('팀 캘린더 — 날짜 칸', () => {
  it('10월 2026 월 칸은 일요일 시작 5주(9/27~10/31)', () => {
    const c = monthCells(2026, 9);
    expect(c.length).toBe(35);
    expect(c[0]).toBe('2026-09-27');
    expect(c[34]).toBe('2026-10-31');
  });
  it('6주가 필요한 달은 42칸(2026년 8월 — 1일 토요일, 31일 월요일)', () => {
    const c = monthCells(2026, 7);
    expect(c.length).toBe(42);
    expect(c[0]).toBe('2026-07-26');
  });
  it('주 칸은 그날이 든 일~토', () => {
    expect(weekDays('2026-10-30')).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
  });
  it('날짜 더하기는 달·해를 넘는다', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('팀 캘린더 — 펼치기', () => {
  it('지운 것·못 연 것은 빼고, 하루 종일이 시간 일정보다 먼저', () => {
    const occ = occurrences([
      item('meet', { allDay: false, start: local(2026, 10, 30, 11), end: local(2026, 10, 30, 12) }),
      item('due', {}),
      item('gone', {}, { del: true }),
      item('bad', {}, { why: '열쇠 없음' }),
    ], '2026-10-25', '2026-11-01');
    expect(occ.map((o) => o.id)).toEqual(['due', 'meet']);
    expect(occ[1]!.day).toBe('2026-10-30');
  });

  it('매주 반복 — 범위 안 주마다, 이 날만 빼기·끝나는 날까지', () => {
    const w = item('weekly', { allDay: false, start: local(2026, 10, 5, 11), end: local(2026, 10, 5, 12), repeat: { every: 'week', until: '2026-10-26', skip: ['2026-10-19'] } });
    const days = occurrences([w], '2026-10-01', '2026-11-30').map((o) => o.day);
    expect(days).toEqual(['2026-10-05', '2026-10-12', '2026-10-26']);
    expect(occurrences([w], '2026-10-01', '2026-11-30')[0]!.repeat).toBe(true);
  });

  it('격주·매월 — 매월 31일은 31일이 없는 달을 건너뛴다', () => {
    const b = item('bi', { start: '2026-10-05', end: '2026-10-06', repeat: { every: '2week' } });
    expect(occurrences([b], '2026-10-01', '2026-11-10').map((o) => o.day)).toEqual(['2026-10-05', '2026-10-19', '2026-11-02']);
    const m = item('m', { start: '2026-08-31', end: '2026-09-01', repeat: { every: 'month' } });
    expect(occurrences([m], '2026-08-01', '2027-01-01').map((o) => o.day)).toEqual(['2026-08-31', '2026-10-31', '2026-12-31']);
  });

  it('반복 시간 일정은 같은 시각을 지킨다', () => {
    const w = item('w', { allDay: false, start: local(2026, 10, 5, 11, 30), end: local(2026, 10, 5, 12), repeat: { every: 'week' } });
    const o = occurrences([w], '2026-10-12', '2026-10-13')[0]!;
    expect(new Date(o.startMs).getHours()).toBe(11);
    expect(new Date(o.startMs).getMinutes()).toBe(30);
    expect(o.endMs - o.startMs).toBe(30 * 60_000);
  });

  it('완료 숨기기 — 완료한 일정만 빠진다', () => {
    const done = item('done', { done: { by: 'm1', at: 5 } });
    expect(occurrences([done, item('todo', {})], '2026-10-25', '2026-11-01', { hideDone: true }).map((o) => o.id)).toEqual(['todo']);
    expect(occurrences([done], '2026-10-25', '2026-11-01')[0]!.done).toBe(true);
  });

  it('여러 날 하루 종일 일정은 걸친 날마다 칸에 보인다', () => {
    const trip = item('trip', { start: '2026-10-29', end: '2026-11-01' });
    const m = byDay(occurrences([trip], '2026-10-25', '2026-11-08'), weekDays('2026-10-30'));
    expect(m.get('2026-10-29')?.length).toBe(1);
    expect(m.get('2026-10-31')?.length).toBe(1);
    expect(m.get('2026-10-28')?.length ?? 0).toBe(0);
  });
});

describe('팀 캘린더 — 홈 블록·만들기', () => {
  it('다가오는 일정 — 오늘부터 날짜별로, 개수 상한', () => {
    const items = [item('a', { start: '2026-10-30', end: '2026-10-31' }), item('b', { start: '2026-11-02', end: '2026-11-03' }), item('old', { start: '2026-10-01', end: '2026-10-02' })];
    const u = upcoming(items, '2026-10-30', 14, 6);
    expect(u.map((g) => g.day)).toEqual(['2026-10-30', '2026-11-02']);
    expect(u.flatMap((g) => g.occ.map((o) => o.id))).toEqual(['a', 'b']);
  });

  it('만들기 칸 — 제목 비면 거절, 끝이 시작보다 앞이면 거절, 하루 종일 끝은 다음 날(미포함)로 저장', () => {
    const d = draftOf(null, '2026-11-03');
    expect(d.allDay).toBe(true);
    expect(cleanDraft({ ...d, title: '  ' }).error).toBeTruthy();
    const ok = cleanDraft({ ...d, title: ' 제품 촬영 ' });
    expect(ok.data).toMatchObject({ v: 1, title: '제품 촬영', allDay: true, start: '2026-11-03', end: '2026-11-04' });
    const bad = cleanDraft({ ...d, title: 'x', allDay: false, date: '2026-11-03', from: '15:00', to: '14:00' });
    expect(bad.error).toBeTruthy();
    const t = cleanDraft({ ...d, title: 'x', allDay: false, date: '2026-11-03', from: '14:00', to: '15:30' });
    expect(new Date(t.data!.start).getHours()).toBe(14);
    expect((new Date(t.data!.end).getTime() - new Date(t.data!.start).getTime()) / 60_000).toBe(90);
  });

  it('고치기 칸은 저장된 일정에서 되살리고, 모르는 칸(made·edits·새 판 칸)은 그대로 넘긴다', () => {
    const it0 = item('e', { allDay: false, start: local(2026, 11, 3, 14), end: local(2026, 11, 3, 15), note: '메모', made: { by: 'm1', at: 1 }, edits: [], extra: 7 } as Partial<CalData>);
    const d = draftOf(it0, '');
    expect(d).toMatchObject({ title: 'e', allDay: false, date: '2026-11-03', from: '14:00', to: '15:00', note: '메모' });
    const out = cleanDraft({ ...d, note: '새 메모' }, it0.data);
    expect(out.data).toMatchObject({ note: '새 메모', made: { by: 'm1', at: 1 }, extra: 7 });
  });

  it('ymd 는 이 기기 시간대의 날짜', () => {
    expect(ymd(new Date(2026, 0, 2, 23, 59))).toBe('2026-01-02');
  });
});

describe('팀 캘린더 — 반복 일정엔 완료가 없다(사용자 10-30 결정, 0.4.5 리뷰 5)', () => {
  const rep = item('r', { repeat: { every: 'week' } });
  it('반복 일정엔 완료를 못 건다 — 한 번 완료가 앞으로 전부를 숨기지 않게', () => {
    expect(withDone(rep.data, 'm1', true).done ?? null).toBeNull();
    expect(withDone(item('one', {}).data, 'm1', true).done?.by).toBe('m1');
  });
  it('이미 완료가 든 반복 일정도 숨기지 않고 완료로 안 그린다', () => {
    const old = item('r', { repeat: { every: 'week' }, done: { by: 'm1', at: 5 } });
    const occ = occurrences([old], '2026-10-25', '2026-11-15', { hideDone: true });
    expect(occ.length).toBe(3);
    expect(occ.every((o) => !o.done)).toBe(true);
    expect(upcoming([old], '2026-10-30', 14, 7).length).toBe(2);
  });
  it('반복으로 바꾸면 남아 있던 완료는 뺀다', () => {
    const f = draftOf(item('one', { done: { by: 'm1', at: 5 } }), '2026-10-30');
    expect(cleanDraft({ ...f, repeat: 'week' }, item('one', { done: { by: 'm1', at: 5 } }).data).data?.done).toBeUndefined();
  });
});

describe('팀 캘린더 — 팀을 바꾼 뒤 앞 팀 일정을 새 팀에 안 쓴다(0.4.5 리뷰 4)', () => {
  const snapOf = (team: string, items: CalItem[]): CalSnap => ({ team, rev: 1, ver: 1, items, me: 'm1', cached: false });
  const a = item('ea', {});
  it('지금 팀 기록장에 있는 일정만 고친다', () => {
    expect(calPutOk(snapOf('tA', [a]), 'tA', a)).toBe(true);
    expect(calPutOk(snapOf('tA', [a]), 'tB', a)).toBe(false);
    expect(calPutOk(snapOf('tB', [item('eb', {})]), 'tB', a)).toBe(false);
    expect(calPutOk(null, 'tB', a)).toBe(false);
  });
  it('새 일정은 그 팀 기록장이거나 아직 안 받았을 때', () => {
    expect(calPutOk(snapOf('tB', []), 'tB', null)).toBe(true);
    expect(calPutOk(null, 'tB', null)).toBe(true);
    expect(calPutOk(snapOf('tA', []), 'tB', null)).toBe(false);
  });
});
