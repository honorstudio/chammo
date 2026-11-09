import { describe, expect, it } from 'vitest';
import { commitsChanged, commitsFrom } from './useWorkFeed';

const DAY = 86_400_000;

describe('커밋 읽는 시작 — 같은 날엔 인자가 같아야 git 캐시가 맞는다(11-07 저장소 79곳 5분마다)', () => {
  it('같은 날 어느 때 불러도 같은 글', () => {
    const t = Date.UTC(2026, 10, 7, 8, 22, 3, 644);
    expect(commitsFrom(t)).toBe(commitsFrom(t + 5 * 60_000));
    expect(commitsFrom(t)).toBe(commitsFrom(Date.UTC(2026, 10, 7, 23, 59, 59, 999)));
    expect(commitsFrom(t)).toBe('2026-10-09T00:00:00.000Z');
  });
  it('날이 바뀌면 새 글, 읽는 범위는 늘 29일 이상', () => {
    const t = Date.UTC(2026, 10, 7, 23, 59);
    expect(commitsFrom(t + 60_000 * 2)).not.toBe(commitsFrom(t));
    expect(t - Date.parse(commitsFrom(t))).toBeGreaterThanOrEqual(29 * DAY);
    expect(t - Date.parse(commitsFrom(t))).toBeLessThan(30 * DAY);
  });
});

describe('커밋을 다시 받을까 — 답이 3.6MB 라 저장소가 그대로면 안 받는다(11-07 진짜 앱 79곳)', () => {
  const prev = { key: '2026-10-09', tag: 'a' };
  it('지문·날이 그대로면 안 받는다', () => expect(commitsChanged(prev, '2026-10-09', 'a')).toBe(false));
  it('지문이 바뀌면 받는다', () => expect(commitsChanged(prev, '2026-10-09', 'b')).toBe(true));
  it('날이 바뀌면 받는다', () => expect(commitsChanged(prev, '2026-10-10', 'a')).toBe(true));
  it('지문을 모르면 받는다 — 가지가 수천 개인 저장소·못 읽을 때', () => expect(commitsChanged(prev, '2026-10-09', '')).toBe(true));
  it('처음엔 받는다', () => expect(commitsChanged({ key: '', tag: '' }, '2026-10-09', 'a')).toBe(true));
});
