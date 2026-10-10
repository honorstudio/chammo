import { describe, expect, it } from 'vitest';
import { foreignText, nextForeign, type Foreign } from './foreignBrowser';
import type { Session } from './session';

const s = (o: Partial<Session>): Session => ({ id: 'a1', name: 'shop', project: 'shop', cwd: '/d/shop', kind: 'background', state: 'working', ...o }) as Session;

describe('nextForeign — 앱 밖 크롬을 띄운 팀 세션(2026-10-10 사용자 "브라우저는 참모 브라우저만")', () => {
  const subs = [s({ id: 'a1', procPid: 100 }), s({ id: 'b2', name: 'blog', project: 'blog', procPid: 200 })];
  it('세션 번호로 짝짓고 세션·종류마다 한 번', () => {
    const found: Foreign[] = [{ sessionPid: 200, pid: 9, kind: 'chrome' }, { sessionPid: 100, pid: 7, kind: 'extension' }];
    const r = nextForeign(found, subs, new Set());
    expect(r).toEqual({ sub: subs[1], f: found[0], key: 'b2:chrome' });
    expect(nextForeign(found, subs, new Set(['b2:chrome']))?.key).toBe('a1:extension');
    // 스크립트가 다시 돌아 크롬 번호가 바뀌어도 같은 세션이면 또 안 알린다
    expect(nextForeign([{ sessionPid: 200, pid: 99, kind: 'chrome' }], subs, new Set(['b2:chrome']))).toBeNull();
  });
  it('목록에 없는 세션(팀 아님)은 버린다', () => {
    expect(nextForeign([{ sessionPid: 555, pid: 1, kind: 'chrome' }], subs, new Set())).toBeNull();
  });
});

describe('foreignText — 맡긴 참모 입력칸에 한 줄', () => {
  it('크롬 직접 띄움은 스크립트를 참모 브라우저로, 확장은 respawn', () => {
    const t = foreignText(s({ id: 'a1' }), 'chrome');
    expect(t.startsWith('[앱] shop 세션(a1)이 앱 밖 크롬을 직접 띄웠어')).toBe(true);
    expect(t).toContain('chammo-browser');
    expect(t).toContain('scripts/app browser connect');
    expect(t).not.toContain('\n');
    const e = foreignText(s({ id: 'a1' }), 'extension');
    expect(e).toContain('--extension');
    expect(e).toContain('claude respawn a1');
  });
});
