import { describe, expect, it } from 'vitest';
import { closeAsk, folderName, isShellKey, liveShellKeys, newShell, shellCwd } from './shellTab';

const projects = [{ root: '/u/dev/shop' }, { root: '/u/dev/shop/sub' }, { root: '/u/dev/tax' }];

describe('셸 탭 — 시작 폴더', () => {
  it('세션 탭이면 그 세션 폴더(워크트리면 워크트리)', () => {
    expect(shellCwd('s:abc', { sessionCwd: '/u/dev/shop/.claude/worktrees/x', projects, devRoot: '/u/dev' })).toBe('/u/dev/shop/.claude/worktrees/x');
  });
  it('파일 탭이면 그 파일이 든 가장 깊은 프로젝트', () => {
    expect(shellCwd('d:/u/dev/shop/sub/a.md', { projects, devRoot: '/u/dev' })).toBe('/u/dev/shop/sub');
    expect(shellCwd('d:/u/dev/tax/docs/x.md', { projects, devRoot: '/u/dev' })).toBe('/u/dev/tax');
  });
  it('이름만 같은 앞자리 폴더는 아니다(shop-2 ≠ shop)', () => {
    expect(shellCwd('d:/u/dev/shop-2/a.md', { projects, devRoot: '/u/dev' })).toBe('/u/dev');
  });
  it('보관함 프로젝트 홈(#p:)이면 그 뿌리', () => {
    expect(shellCwd('l:참모#p:/u/dev/tax', { projects, devRoot: '/u/dev' })).toBe('/u/dev/tax');
  });
  it('홈·보관함·모르는 화면이면 devRoot', () => {
    expect(shellCwd('l:참모#h', { projects, devRoot: '/u/dev' })).toBe('/u/dev');
    expect(shellCwd('', { projects, devRoot: '/u/dev' })).toBe('/u/dev');
    expect(shellCwd('s:gone', { projects, devRoot: '/u/dev' })).toBe('/u/dev');
  });
});

describe('셸 탭 — 이름·열쇠', () => {
  it('폴더 끝 이름, 홈은 ~', () => {
    expect(folderName('/u/dev/shop/', '/u')).toBe('shop');
    expect(folderName('/u', '/u')).toBe('~');
    expect(folderName('C:\\Users\\a\\dev', 'C:\\Users\\a')).toBe('dev');
  });
  it('같은 폴더를 또 열면 2·3, 열쇠는 번호로', () => {
    const a = newShell([], 1, '/u/dev/shop', '/u');
    const b = newShell([a], 2, '/u/dev/shop', '/u');
    const c = newShell([a, b], 3, '/u/dev/shop', '/u');
    expect([a, b, c].map((t) => t.title)).toEqual(['shop', 'shop 2', 'shop 3']);
    expect([a.key, b.key, c.key]).toEqual(['sh:1', 'sh:2', 'sh:3']);
    expect(isShellKey(a.key)).toBe(true);
    expect(isShellKey('s:1')).toBe(false);
  });
  it('탭 줄에 남은 셸만 산다', () => {
    expect([...liveShellKeys([{ tabs: ['sh:1', 's:x', '/a.md'] }, { tabs: ['sh:3'] }])]).toEqual(['sh:1', 'sh:3']);
  });
});

describe('셸 탭 — 닫기 확인', () => {
  it('쉬는 셸이면 묻지 않는다', () => expect(closeAsk(null)).toBeNull());
  it('돌던 프로그램이 있으면 이름을 넣어 묻는다', () => {
    expect(closeAsk('vim')?.body).toContain('vim');
    expect(closeAsk('')?.body).toBeTruthy();
  });
});
