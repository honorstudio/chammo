import { describe, expect, it } from 'vitest';
import { addNeed, attachNote, showButton, type BrowserLink, type BrowserNeed } from './browserNeed';
import { intentOf } from './appctl';

const link = (o: Partial<BrowserLink>): BrowserLink => ({ available: true, connected: false, name: '', scope: '', other: false, added: false, ...o });

describe('브라우저 연결 카드(GitHub #2)', () => {
  it('scripts/app browser need·task send 줄 → 카드 할 일', () => {
    expect(intentOf({ action: 'browser-need', arg: { dir: '/d/ops', session: 'abcd1234', why: '슬랙 로그인' } })).toEqual({ kind: 'browserNeed', dir: '/d/ops', session: 'abcd1234', why: '슬랙 로그인' });
    expect(intentOf({ action: 'browser-need', arg: { dir: '/d/ops' } })).toEqual({ kind: 'browserNeed', dir: '/d/ops', session: '', why: '' });
    expect(intentOf({ action: 'browser-need', arg: { dir: '  ' } })).toBeNull();
    expect(intentOf({ action: 'browser-need', arg: 'ops' })).toBeNull();
  });

  it('같은 폴더는 한 장 — 새 이유로 바꾸고 맨 위로, 다섯 장까지', () => {
    let l: BrowserNeed[] = [];
    l = addNeed(l, { dir: '/d/a', session: 's1', why: '1', at: 1 });
    l = addNeed(l, { dir: '/d/b', session: '', why: '', at: 2 });
    l = addNeed(l, { dir: '/d/a/', session: 's2', why: '2', at: 3 });
    expect(l.map((n) => [n.dir, n.why])).toEqual([['/d/a', '2'], ['/d/b', '']]);
    for (let i = 0; i < 8; i++) l = addNeed(l, { dir: `/d/x${i}`, session: '', why: '', at: 10 + i });
    expect(l).toHaveLength(5);
    expect(l[0]!.dir).toBe('/d/x7');
  });

  it('버튼은 깔려 있고 안 붙었을 때만', () => {
    expect(showButton(link({}))).toBe(true);
    expect(showButton(link({ connected: true }))).toBe(false);
    expect(showButton(link({ available: false }))).toBe(false);
    expect(showButton(null)).toBe(false);
  });

  it('붙인 뒤 안내 — 도구 이름·같이 뜨는 저장소 것·다시 켜기', () => {
    const n = attachNote(link({ connected: true, added: true, name: 'chammo-browser', scope: 'local', other: true }), 2);
    expect(n).toContain('chammo-browser');
    expect(n).toMatch(/다시 켜|restart/);
    expect(n).toMatch(/playwright/);
    expect(attachNote(link({ connected: true, added: false, name: 'playwright', scope: 'project' }), 0)).toMatch(/이미|already/);
    expect(attachNote(link({ connected: true, added: true, name: 'playwright', scope: 'local' }), 0)).not.toMatch(/다시 켜|restart/);
  });
});
