import { describe, expect, it } from 'vitest';
import { agoText, sameName, shotChoices, shotsFirst, type Shot } from './lockerShots';

const s = (n: string, mtime = 0): Shot => ({ path: `/H/Desktop/스크린샷/${n}`, name: n, mtime });

describe('최근 스크린샷 맨 위', () => {
  it('shotsFirst — 최신 n장만 맨 위, 같은 파일은 나머지에서 뺀다', () => {
    const shots = [s('c.png'), s('b.png'), s('a.png')];
    const rest = [{ path: '/H/Desktop/스크린샷/b.png', name: 'b' }, { path: '/H/Documents/x.md', name: 'x' }];
    const r = shotsFirst(shots, rest, 2);
    expect(r.shots.map((x) => x.name)).toEqual(['c.png', 'b.png']);
    expect(r.rest.map((x) => x.name)).toEqual(['x']);
  });
  it('n 이 0이거나 목록이 비면 나머지 그대로', () => {
    const rest = [{ path: '/a', name: 'a' }];
    expect(shotsFirst([s('a.png')], rest, 0)).toEqual({ shots: [], rest });
    expect(shotsFirst([], rest)).toEqual({ shots: [], rest });
  });
  it('agoText — 방금·분·시간·날짜, 미래·없음은 빈 글', () => {
    const now = new Date(2026, 9, 12, 13, 0, 0).getTime();
    expect(agoText(now - 20_000, now)).toBe('방금');
    expect(agoText(now - 5 * 60_000, now)).toBe('5분 전');
    expect(agoText(now - 3 * 3_600_000, now)).toBe('3시간 전');
    expect(agoText(new Date(2026, 9, 9, 8, 0, 0).getTime(), now)).toBe('10/9');
    expect(agoText(now + 1000, now)).toBe('');
    expect(agoText(null, now)).toBe('');
  });
});

describe('# 고르기 맨 위 — 최근 스크린샷', () => {
  const now = new Date(2026, 9, 12, 13, 0, 0).getTime();
  const shots = [s('스크린샷 2026-10-12 오후 12.55.00.png', now - 2 * 60_000), s('스크린샷 2026-10-12 오후 12.10.00.png', now - 50 * 60_000), s('Screenshot b.png', now - 3 * 3_600_000), s('스크린샷 c.png', now - 5 * 3_600_000), s('스크린샷 d.png', now - 6 * 3_600_000)];
  it('빈 글이면 최신 3~4장을 n분 전과 함께 — 최대 4장', () => {
    const r = shotChoices(shots, '', now);
    expect(r).toHaveLength(4);
    expect(r[0]).toEqual({ path: shots[0]!.path, name: shots[0]!.name, ago: '2분 전' });
    expect(r.map((x) => x.ago)).toEqual(['2분 전', '50분 전', '3시간 전', '5시간 전']);
  });
  it('친 글자가 이름에 든 것만(대소문자 무시) — 합쳐 쓴 한글도 풀어 쓴 한글로 쳐도 맞는다', () => {
    expect(shotChoices(shots, 'screen', now).map((x) => x.name)).toEqual(['Screenshot b.png']);
    expect(shotChoices(shots, '\u1109\u1173', now).length).toBeGreaterThan(0);
    expect(shotChoices(shots, '없는이름', now)).toEqual([]);
  });
  it('max 로 줄이고 0이면 빈 목록', () => {
    expect(shotChoices(shots, '', now, 2)).toHaveLength(2);
    expect(shotChoices(shots, '', now, 0)).toEqual([]);
  });
  it('sameName — 보관함 줄과 같은 파일(풀어 쓴·합쳐 쓴 이름이 달라도)', () => {
    expect(sameName('\u1109\u1173\u110f\u1173\u1105\u1175\u11ab.png', '스크린.png')).toBe(true);
    expect(sameName('a.png', 'b.png')).toBe(false);
  });
});
