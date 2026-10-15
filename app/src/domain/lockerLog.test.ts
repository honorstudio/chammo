import { describe, expect, it } from 'vitest';
import { dayLabel, defaultView, lockerLog, logDays, type LogItem } from './lockerLog';
import type { LkEntry } from './lockerTree';

// 홈·모드 v2 B·C·E(사용자 10/11 "추천대로") — 보관함 뿌리 = 내 폴더 + 주고받은 기록. 프로젝트는 폴더가 아니라 기록
const DIR = '/H/Documents/Chammo/운영';
const projects = [{ name: 'shop-landing', root: '/H/Desktop/dev/shop-landing' }, { name: 'tax-memo', root: '/H/Desktop/dev/tax-memo' }];
const f = (rel: string, o: Partial<LkEntry> = {}): LkEntry => ({ rel, name: rel.split('/').pop()!, dir: false, gone: false, vers: 1, ...o });
const d = (rel: string): LkEntry => ({ rel, name: rel.split('/').pop()!, dir: true, gone: false, vers: 0 });

describe('lockerLog — 주고받은 기록', () => {
  const shown = [
    { path: '/H/Desktop/dev/shop-landing/out/랜딩_B.html', ts: '2026-10-11T05:32:00Z', by: 's-shop' },
    { path: '/H/Desktop/dev/shop-landing/out/랜딩_B.html', ts: '2026-10-11T03:00:00Z', by: 's-shop' },
    { path: '/H/Desktop/dev/tax-memo/docs/메모.md', ts: '2026-10-10T08:00:00Z', by: 'o-1' },
    { path: 'https://example.com/a', ts: '2026-10-11T06:00:00Z', by: 'o-1' },
  ];
  const entries = [d('자료'), f('견적.xlsx', { mtime: Date.parse('2026-10-11T04:50:00Z') }), f('자료/견적.xlsx', { link: `${DIR}/견적.xlsx` }),
    f('자료/랜딩_B.html', { link: '/H/Desktop/dev/shop-landing/out/랜딩_B.html' }), f('자료/정리한.pdf', { mtime: 1 }), f('.숨김', { mtime: 2 })];
  const log = lockerLog(shown, entries, DIR, projects);

  it('보여 준 것(같은 파일은 최근 한 번) + 보관함 맨 위 낱 파일, 최근 것 먼저. 웹 주소·폴더 안 파일은 기록이 아니다', () => {
    expect(log.map((x) => x.path)).toEqual(['/H/Desktop/dev/shop-landing/out/랜딩_B.html', `${DIR}/견적.xlsx`, '/H/Desktop/dev/tax-memo/docs/메모.md']);
  });
  it('누가 · 어느 프로젝트 · 무엇(보여 줌 / 넣음)', () => {
    expect(log[0]).toMatchObject({ by: 's-shop', act: 'shown', project: 'shop-landing' });
    expect(log[1]).toMatchObject({ by: 'me', act: 'kept', project: null });
    expect(log[2]).toMatchObject({ by: 'o-1', project: 'tax-memo' });
  });
  it('내 폴더로 끈 것(바로가기)은 기록에 "→ 폴더"로 남는다 — 기록은 옮겨지지 않는다', () => {
    expect(log[0]!.filed).toEqual(['자료']);
    expect(log[1]!.filed).toEqual(['자료']);
    expect(log[2]!.filed).toEqual([]);
  });
  it('보관함 맨 위 별칭(채팅 첨부·프로젝트 결과물)은 가리키는 곳으로 프로젝트를 안다', () => {
    const l = lockerLog([], [f('cut.png', { link: '/H/Desktop/dev/shop-landing/cut.png', mtime: 5 })], DIR, projects);
    expect(l[0]).toMatchObject({ path: `${DIR}/cut.png`, project: 'shop-landing', act: 'kept' });
  });
});

describe('logDays — 날짜로 묶기', () => {
  const now = new Date(2026, 9, 11, 22, 0);
  const at = (day: number, h: number) => new Date(2026, 9, day, h).toISOString();
  const it3: LogItem[] = [at(11, 14), at(11, 9), at(10, 17), at(2, 9)].map((ts, i) => ({ path: `/p${i}`, ts, by: 'me', act: 'kept', project: null, filed: [] }));
  it('오늘 · 어제 · 날짜', () => {
    const g = logDays(it3, now);
    expect(g.map((x) => [x.label, x.items.length])).toEqual([['오늘 · 10월 11일', 2], ['어제 · 10월 10일', 1], ['10월 2일', 1]]);
  });
  it('dayLabel 은 연도가 다르면 연도까지', () => {
    expect(dayLabel(new Date(2025, 11, 30), now)).toBe('2025년 12월 30일');
  });
});

describe('defaultView — 카드/목록(⑨)', () => {
  it('고른 게 있으면 그것, 없으면 폴더는 카드·기록은 목록', () => {
    expect(defaultView(null, 'dir')).toBe('card');
    expect(defaultView(null, 'log')).toBe('list');
    expect(defaultView('list', 'dir')).toBe('list');
    expect(defaultView('card', 'log')).toBe('card');
    expect(defaultView('이상한 값', 'dir')).toBe('card');
  });
});
