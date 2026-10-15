import { describe, expect, it } from 'vitest';
import { cardLook, crumbOf, editedAfterOpen, folderKeyOf, folderTree, inFolder, lockerFiles, lockerPick, parseLockerPick, projectsOf, type LockerView } from './locker';

const ME = '참모-2';
const projects = [{ name: 'sheet-demo', root: '/u/dev/sheet-demo' }, { name: 'shop', root: '/u/dev/shop' }];
const view = (v: Partial<LockerView>): LockerView => ({ items: [], hidden: [], folders: [], ...v });
const item = (path: string, o: Record<string, unknown> = {}) => ({ owner: ME, path, copy: false, by: 'me', ts: '2026-10-11T01:00:00Z', folder: null, name: null, gone: false, mtime: null, size: 10, ...o });

describe('lockerFiles — 보관함 기록 + 보여 준 파일을 한 목록으로', () => {
  it('내가 준 것(보관함)과 참모가 띄운 것(show)을 합치고 최근 순 — 같은 파일은 한 번', () => {
    const shown = [
      { path: '/u/dev/sheet-demo/out/매출_정리.xlsx', ts: '2026-10-11T03:00:00Z', by: 'sess-1', byName: 'sheet-demo' },
      { path: '/u/dev/sheet-demo/samples/매출_원본.xlsx', ts: '2026-10-11T00:30:00Z', by: 'sess-1' },
    ];
    const v = view({ items: [item('/u/dev/sheet-demo/samples/매출_원본.xlsx'), item('/u/Desktop/견적서.pdf', { ts: '2026-10-11T02:00:00Z' })] });
    const fs = lockerFiles(v, ME, shown, projects);
    expect(fs.map((f) => [f.name, f.by, f.folder])).toEqual([
      ['매출_정리.xlsx', 'sess-1', 'p:sheet-demo'],
      ['견적서.pdf', 'me', 'etc'],
      ['매출_원본.xlsx', 'me', 'p:sheet-demo'],
    ]);
    expect(fs[2]!.kept).toBe(true);
    expect(fs[0]!.kept).toBe(false);
  });

  it('다른 참모 보관함·숨긴 것·그림 데이터 주소·웹 주소는 뺀다', () => {
    const v = view({
      items: [item('/u/a.md', { owner: '참모' })],
      hidden: [{ owner: ME, path: '/u/dev/shop/v1.html' }],
    });
    const shown = [{ path: '/u/dev/shop/v1.html', ts: '2026-10-11T01:00:00Z', by: 's' }, { path: 'data:image/png;base64,AA', ts: '2026-10-11T01:00:00Z', by: 'me' }, { path: 'http://localhost:3000/cart', ts: '2026-10-11T01:00:00Z', by: 's' }];
    expect(lockerFiles(v, ME, shown, projects)).toEqual([]);
  });

  it('내 폴더가 프로젝트 폴더보다 먼저 · 이름 바꾼 건 그 이름 · 원본이 없으면 gone · 넣은 뒤 고쳤으면 edited', () => {
    const v = view({ items: [item('/u/dev/shop/a.md', { folder: '10월 보고', name: '9월 보고서', gone: true }), item('/u/b.md', { mtime: Date.parse('2026-10-11T05:00:00Z') })] });
    const [b, a] = lockerFiles(v, ME, [], projects);
    expect([a!.folder, a!.name, a!.gone]).toEqual(['u:10월 보고', '9월 보고서', true]);
    expect(b!.edited).toBe(Date.parse('2026-10-11T05:00:00Z'));
    // 보관함 복사본 이름은 앞 시각(밀리초-)을 뗀다
    expect(lockerFiles(view({ items: [item('/d/locker/files/1700000000000-견적서.png', { copy: true })] }), ME, [], projects)[0]!.name).toBe('견적서.png');
    expect(a!.edited).toBeUndefined();
  });
});

describe('폴더', () => {
  it('folderKeyOf — 가장 긴 프로젝트 뿌리, 없으면 기타', () => {
    const ps = [...projects, { name: 'sheet-demo-run', root: '/u/dev/sheet-demo/.claude/worktrees/run' }];
    expect(folderKeyOf('/u/dev/sheet-demo/.claude/worktrees/run/out/a.pptx', ps)).toBe('p:sheet-demo-run');
    expect(folderKeyOf('/u/dev/sheet-demox/a.md', ps)).toBe('etc');
  });

  it('folderTree — 최근·프로젝트(있는 것만)·내 폴더(빈 것도)·기타, 개수', () => {
    const v = view({ folders: [{ owner: ME, name: '견적·계약' }, { owner: '참모', name: '남의 폴더' }], items: [item('/u/dev/shop/a.md', { folder: '10월 보고' })] });
    const fs = lockerFiles(v, ME, [{ path: '/u/dev/sheet-demo/b.md', ts: '1', by: 's' }, { path: '/u/x.md', ts: '1', by: 's' }], projects);
    const t = folderTree(fs, v, ME);
    expect(t.recent).toBe(3);
    expect(t.projects).toEqual([{ key: 'p:sheet-demo', name: 'sheet-demo', count: 1 }]);
    expect(t.mine).toEqual([{ key: 'u:견적·계약', name: '견적·계약', count: 0 }, { key: 'u:10월 보고', name: '10월 보고', count: 1 }]);
    expect(t.etc).toBe(1);
  });

  it('inFolder — 최근은 전부, 그 밖은 그 폴더만', () => {
    const fs = lockerFiles(view({}), ME, [{ path: '/u/dev/shop/a.md', ts: '2', by: 's' }, { path: '/u/b.md', ts: '1', by: 's' }], projects);
    expect(inFolder(fs, 'recent').length).toBe(2);
    expect(inFolder(fs, 'p:shop').map((f) => f.name)).toEqual(['a.md']);
    expect(crumbOf('u:10월 보고')).toBe('10월 보고');
    expect(crumbOf('etc')).toBe('기타');
  });
});

describe('화면 자리(pick)', () => {
  it('l:<참모 id>#<폴더> 를 오간다', () => {
    expect(lockerPick('o1')).toBe('l:o1');
    expect(lockerPick('o1', 'u:10월 보고')).toBe('l:o1#u:10월 보고');
    expect(parseLockerPick('l:o1#u:10월 보고')).toEqual({ orch: 'o1', folder: 'u:10월 보고' });
    expect(parseLockerPick('l:o1')).toEqual({ orch: 'o1', folder: 'recent' });
    expect(parseLockerPick('o:o1')).toBeNull();
  });
});

describe('cardLook — 썸네일 모양', () => {
  it('그림은 그대로, PPT·PDF·시안은 진짜 썸네일, 엑셀·한글·md·워드는 문서 모양', () => {
    expect(cardLook('/a/b.PNG')).toEqual({ look: 'image', tag: 'PNG' });
    expect(cardLook('/a/월간보고.pptx')).toEqual({ look: 'shot', tag: 'PPTX' });
    expect(cardLook('/a/b.pdf').look).toBe('shot');
    expect(cardLook('/a/v1.html').look).toBe('shot');
    expect(cardLook('/a/매출.xlsx')).toEqual({ look: 'doc', tag: 'XLSX' });
    expect(cardLook('/a/신청서.hwpx').look).toBe('doc');
    expect(cardLook('/a/요약.md').look).toBe('doc');
    expect(cardLook('/a/Makefile')).toEqual({ look: 'doc', tag: 'FILE' });
  });
});

describe('projectsOf — 폰은 세션 폴더로 프로젝트를 안다', () => {
  it('워크트리는 본 폴더로, HQ 는 빼고, 한 번씩', () => {
    expect(projectsOf(['/u/dev/shop', '/u/dev/shop/.claude/worktrees/fix-a', '/u/hq', '/u/dev/sheet-demo/'], '/u/hq')).toEqual([
      { name: 'shop', root: '/u/dev/shop' },
      { name: 'sheet-demo', root: '/u/dev/sheet-demo' },
    ]);
  });
});

describe('editedAfterOpen — 보관함에서 연 파일을 맥 앱으로 고쳐 저장했나', () => {
  it('연 뒤에 바뀐 것만, 같은 저장은 한 번', () => {
    const opened = new Map([['/u/a.pptx', 1_000_000], ['/u/b.hwpx', 1_000_000]]);
    const told = new Map<string, number>();
    const items = [item('/u/a.pptx', { mtime: 1_005_000 }), item('/u/b.hwpx', { mtime: 999_000 }), item('/u/c.pdf', { mtime: 2_000_000 })];
    expect(editedAfterOpen(items, opened, told).map((i) => i.path)).toEqual(['/u/a.pptx']);
    expect(editedAfterOpen(items, opened, told)).toEqual([]);
    expect(editedAfterOpen([item('/u/a.pptx', { mtime: 1_009_000 })], opened, told).map((i) => i.path)).toEqual(['/u/a.pptx']);
  });
});
