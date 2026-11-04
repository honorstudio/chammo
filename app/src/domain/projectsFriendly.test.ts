import { describe, expect, it } from 'vitest';
import { askMatches, coverTone, isFirstRun, projectBuckets, projectCovers, projectProgress, projectTitle } from './projectsFriendly';
import type { ProjRowIn } from './projectsView';
import type { TaskEvent } from './tasks';

const row = (name: string, dot: ProjRowIn['dot'], at = 0): ProjRowIn => ({ root: `/dev/${name}`, name, dot, at });

describe('projectBuckets — 내 차례 / 일하는 중 / 쉬는 중', () => {
  const rows = [row('ops', 'ask', 5), row('shop', 'run', 9), row('blog', 'run', 3), row('photo', 'rest', 7), row('tax', 'off', 0), row('card', 'rest', 8)];
  it('세션이 묻는 중이거나 그 프로젝트 결정 카드가 있으면 내 차례, 돌고 있으면 일하는 중, 나머지는 쉬는 중(최근 순)', () => {
    const b = projectBuckets(rows, new Set(['/dev/photo']), []);
    expect(b.turn.map((r) => r.name)).toEqual(['photo', 'ops']);
    expect(b.working.map((r) => r.name)).toEqual(['shop', 'blog']);
    expect(b.resting.map((r) => r.name)).toEqual(['card', 'tax']);
  });
  it('목록에서 뺀 건 쉬는 중에서 빠져 뺀 것으로 — 내 차례·일하는 중은 빼도 남는다', () => {
    const b = projectBuckets(rows, new Set(), ['/dev/card/', '/dev/shop']);
    expect(b.resting.map((r) => r.name)).toEqual(['photo', 'tax']);
    expect(b.hidden.map((r) => r.name)).toEqual(['card']);
    expect(b.working.map((r) => r.name)).toContain('shop');
  });
});

describe('isFirstRun — 처음 쓰는 사람 화면', () => {
  it('프로젝트가 하나도 없을 때만', () => {
    expect(isFirstRun([])).toBe(true);
    expect(isFirstRun([row('a', 'off')])).toBe(false);
  });
});

describe('projectTitle — 폴더 이름 대신 사람 말 이름', () => {
  it('한 줄 설명의 앞마디(—·(·, 앞)', () => {
    expect(projectTitle('동네 빵집 예약·픽업 앱 (웹 + 앱)', 'shop-app')).toBe('동네 빵집 예약·픽업 앱');
    expect(projectTitle('shop — 빵집 예약 사이트', 'shop')).toBe('빵집 예약 사이트');
    expect(projectTitle('매장 운영 현황판. 매일 아침 갱신', 'ops-board')).toBe('매장 운영 현황판');
  });
  it('설명이 없거나 너무 길면 폴더 이름', () => {
    expect(projectTitle('', 'tax-memo')).toBe('tax-memo');
    expect(projectTitle('가'.repeat(40), 'long')).toBe('long');
  });
});

describe('coverTone — 표지 색(이름마다 늘 같은 색)', () => {
  it('0~5, 같은 이름은 같은 값', () => {
    const t = coverTone('shop-app');
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThan(6);
    expect(coverTone('shop-app')).toBe(t);
  });
});

describe('projectCovers — 표지 = 그 프로젝트에서 마지막으로 보여 준 그림·문서', () => {
  const log = [
    { path: '/dev/shop/.shots/a.png', ts: '2026-11-01T01:00:00Z', from: 'x' },
    { path: '/dev/shop/docs/plan.md', ts: '2026-11-01T03:00:00Z', from: 'x' },
    { path: '/dev/shop/out/정산안.pdf', ts: '2026-11-01T02:00:00Z', from: 'y' },
    { path: '/dev/shop-two/b.png', ts: '2026-11-01T04:00:00Z', from: 'x' },
    { path: '/dev/ops/c.png', ts: '2026-11-01T05:00:00Z', from: 'x', gone: true },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n{깨진 줄';
  it('md 같은 글은 표지로 안 쓴다, 이름이 겹치는 옆 폴더·없어진 파일은 빼고', () => {
    expect(projectCovers(log, ['/dev/shop', '/dev/ops'])).toEqual({ '/dev/shop': '/dev/shop/out/정산안.pdf' });
  });
});

describe('projectProgress — 오늘 맡긴 일 중 끝난 수', () => {
  const now = Date.parse('2026-11-01T10:00:00+09:00');
  const ev = (type: TaskEvent['type'], task: string, ts: string, more: Partial<TaskEvent> = {}): TaskEvent => ({ type, task, ts, ...more });
  const events = [
    ev('send', 't0', '2026-10-31T10:00:00+09:00', { target: 'shop', project: 'shop' }),
    ev('send', 't1', '2026-11-01T06:00:00+09:00', { target: 'shop', project: 'shop' }),
    ev('send', 't2', '2026-11-01T07:00:00+09:00', { target: 'shop-2' }),
    ev('send', 't3', '2026-11-01T08:00:00+09:00', { target: 'blog', project: 'blog' }),
    ev('done', 't1', '2026-11-01T09:00:00+09:00'),
  ];
  it('어제 일은 안 세고, 세션 이름으로 보낸 것도 그 프로젝트', () => {
    expect(projectProgress(events, ['shop', 'shop-2'], now)).toEqual({ done: 1, total: 2 });
    expect(projectProgress(events, ['photo'], now)).toEqual({ done: 0, total: 0 });
  });
});

describe('askMatches — 결정 카드가 이 프로젝트 것인가', () => {
  const p = { root: '/dev/shop', name: 'shop' };
  it('프로젝트 이름이 같거나 카드가 뜬 폴더가 그 안', () => {
    expect(askMatches({ project: 'shop' }, p)).toBe(true);
    expect(askMatches({ cwd: '/dev/shop/.claude/worktrees/x' }, p)).toBe(true);
    expect(askMatches({ cwd: '/dev/shop-two' }, p)).toBe(false);
    expect(askMatches({ project: '참모' }, p)).toBe(false);
  });
});
