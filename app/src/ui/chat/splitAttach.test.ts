import { describe, expect, it } from 'vitest';
import { splitAttach } from './ChatView';

// 같은 파일을 여러 번 붙여도 #file 번호는 하나(2026-10-26 사용자)
describe('splitAttach', () => {
  it('이미 붙은 파일은 새로 안 붙이고 그 이름표만 돌려준다', () => {
    const r = splitAttach({ detail: ['/a/x.md', '/a/y.md'] }, [{ path: '/a/x.md', label: '#file1' }]);
    expect(r).toEqual({ fresh: ['/a/y.md'], again: ['#file1'] });
  });
  it('한 번에 같은 경로가 여럿 와도 하나만', () => {
    expect(splitAttach({ detail: ['/a/x.md', '/a/x.md', '/a/x.md'] }, [])).toEqual({ fresh: ['/a/x.md'], again: [] });
  });
  it('빈 끌기', () => {
    expect(splitAttach({ detail: null }, [])).toEqual({ fresh: [], again: [] });
  });
});
