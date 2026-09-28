import { describe, expect, it } from 'vitest';
import { findPaths, findPathsWrapped, pathCandidates, projectOrder, resolveLink, routeOf } from './links';

const BASE = '/U/dev/todo-api';
const HOME = '/U';

describe('resolveLink — ⌘+클릭한 링크를 무엇으로 열까', () => {
  it('http·https 는 그대로', () => {
    expect(resolveLink('https://github.com/x/y/pull/3', BASE, HOME)).toEqual({ kind: 'url', target: 'https://github.com/x/y/pull/3' });
  });

  it('file:// 은 경로로 (퍼센트 인코딩 풀기)', () => {
    expect(resolveLink('file:///U/dev/todo-api/src/%ED%95%9C.ts', BASE, HOME)).toEqual({ kind: 'file', target: '/U/dev/todo-api/src/한.ts' });
  });

  it('절대 경로', () => expect(resolveLink('/etc/hosts', BASE, HOME)).toEqual({ kind: 'file', target: '/etc/hosts' }));
  it('~ 는 홈으로', () => expect(resolveLink('~/.claude/CLAUDE.md', BASE, HOME)).toEqual({ kind: 'file', target: '/U/.claude/CLAUDE.md' }));
  it('상대 경로는 세션 폴더 기준', () => expect(resolveLink('src/app.ts', BASE, HOME)).toEqual({ kind: 'file', target: '/U/dev/todo-api/src/app.ts' }));
  it('./ ../ 도 정리', () => expect(resolveLink('../acme-shop/./a.md', BASE, HOME)).toEqual({ kind: 'file', target: '/U/dev/acme-shop/a.md' }));

  it('줄·칸 번호(:12 · :12:5)는 떼고 연다', () => {
    expect(resolveLink('src/app.ts:12', BASE, HOME)).toEqual({ kind: 'file', target: '/U/dev/todo-api/src/app.ts', line: 12 });
    expect(resolveLink('src/app.ts:12:5', BASE, HOME)).toEqual({ kind: 'file', target: '/U/dev/todo-api/src/app.ts', line: 12 });
  });

  it('javascript: 같은 위험한 스킴은 안 연다', () => {
    expect(resolveLink('javascript:alert(1)', BASE, HOME)).toBeNull();
    expect(resolveLink('ssh://x', BASE, HOME)).toBeNull();
  });

  it('빈 문자열은 null', () => expect(resolveLink('  ', BASE, HOME)).toBeNull());
});

describe('findPaths — 링크로 안 찍힌 평범한 경로도 찾기', () => {
  it('확장자가 있는 경로와 줄 번호', () => {
    const line = '⏺ Update(src/features/payment/refund.ts:42) 그리고 docs/starter.md 도 봐';
    expect(findPaths(line).map((m) => m.text)).toEqual(['src/features/payment/refund.ts:42', 'docs/starter.md']);
  });

  it('위치(시작 칸)를 돌려준다', () => {
    const [m] = findPaths('see a/b.ts');
    expect(m).toEqual({ text: 'a/b.ts', start: 4 });
  });

  it('URL 안의 경로는 경로로 안 잡는다 (URL 은 따로 처리)', () => {
    expect(findPaths('https://example.com/a/b.html')).toEqual([]);
  });

  it('버전 숫자·소수·문장 끝 점은 경로가 아니다', () => {
    expect(findPaths('v2.1.283 에서 3.5배 빨라졌다.')).toEqual([]);
  });

  it('한글 폴더·파일 이름도 끝까지(사용자 2026-09-28: ~/Desktop/ 까지만 잡혀 계약서가 안 열렸다)', () => {
    const p = '~/Desktop/오늘위생환경_견적/오늘위생환경_리플렛팜플렛POP_용역계약서_20260923_부가세별도.docx';
    expect(findPaths(`계약서는 ${p} 에 있어`).map((m) => m.text)).toEqual([p]);
    expect(findPaths('docs/회의록/9월.md 참고').map((m) => m.text)).toEqual(['docs/회의록/9월.md']);
  });

  it('~/ 와 / 로 시작하는 경로', () => {
    expect(findPaths('열어봐 ~/.claude/CLAUDE.md 랑 /Users/x/a.json').map((m) => m.text)).toEqual(['~/.claude/CLAUDE.md', '/Users/x/a.json']);
  });
});

describe('findPathsWrapped — 두 줄로 접힌 경로도 한 링크로 (2026-09-27 사용자: 좁은 창에서 ⌘클릭하면 앞 조각만 열렸다)', () => {
  const at = (rows: string[], wrapped: boolean[] = []) => ({ line: (i: number) => rows[i] ?? null, wrapped: (i: number) => wrapped[i] ?? false });

  it('안 접힌 줄은 전과 같다', () => {
    const { line, wrapped } = at(['see src/a.ts:12 here']);
    expect(findPathsWrapped(line, wrapped, 0, 80)).toEqual([{ text: 'src/a.ts:12', from: { row: 0, col: 4 }, to: { row: 0, col: 14 } }]);
  });

  it('터미널이 접은 줄(isWrapped) — 두 줄 어디를 눌러도 같은 링크', () => {
    const rows = ['abc docs/design-drafts/pix', 'el-office/v3.html (67KB)'];
    const { line, wrapped } = at(rows, [false, true]);
    const want = [{ text: 'docs/design-drafts/pixel-office/v3.html', from: { row: 0, col: 4 }, to: { row: 1, col: 16 } }];
    expect(findPathsWrapped(line, wrapped, 0, 26)).toEqual(want);
    expect(findPathsWrapped(line, wrapped, 1, 26)).toEqual(want);
  });

  it('Claude 화면이 직접 접은 줄 — 다음 줄 들여쓰기는 건너뛰고 잇는다', () => {
    const rows = ['  › [file] docs/design-drafts/pixel-office/', '    v3.html (67.8KB)'];
    const { line, wrapped } = at(rows);
    expect(findPathsWrapped(line, wrapped, 1, rows[0]!.length + 1)).toEqual([
      { text: 'docs/design-drafts/pixel-office/v3.html', from: { row: 0, col: 11 }, to: { row: 1, col: 10 } },
    ]);
  });

  it('앞 줄이 짧으면(끝까지 안 찼으면) 따로 본다 — 목록의 경로 두 개를 잇지 않게', () => {
    const { line, wrapped } = at(['src/a.ts', 'src/b.ts']);
    expect(findPathsWrapped(line, wrapped, 1, 80).map((x) => x.text)).toEqual(['src/b.ts']);
  });
});

describe('findPathsWrapped — 웹 주소도(사용자 2026-09-28: 좁은 창에서 URL 이 줄바꿈되면 윗줄 조각까지만 링크)', () => {
  const at = (rows: string[], wrapped: boolean[] = []) => ({ line: (i: number) => rows[i] ?? null, wrapped: (i: number) => wrapped[i] ?? false });
  const URL = 'https://example.com/d/00000000-0000-4000-8000-000000000000.abcdefghijklmnopqrstuvwx';

  it('한 줄 URL 은 그대로(끝 구두점·괄호는 뗀다)', () => {
    const { line, wrapped } = at([`링크: ${URL}). 끝`]);
    expect(findPathsWrapped(line, wrapped, 0, 200).map((x) => x.text)).toEqual([URL]);
  });

  it('Claude 화면이 직접 접은 URL — 들여쓰기 건너뛰고 한 링크, 두 줄 어디를 눌러도', () => {
    const head = `  링크: ${URL.slice(0, 60)}`;
    const rows = [head, `  ${URL.slice(60)}`];
    const { line, wrapped } = at(rows);
    const cols = head.length + 1;
    expect(findPathsWrapped(line, wrapped, 0, cols).map((x) => x.text)).toEqual([URL]);
    expect(findPathsWrapped(line, wrapped, 1, cols).map((x) => x.text)).toEqual([URL]);
  });

  it('쿼리 문자열(?·=·&·%)이 줄 끝에 걸려도 잇는다', () => {
    const u = 'https://example.com/search?q=chammo&page=2%20x';
    const rows = [`  ${u.slice(0, 30)}`, `  ${u.slice(30)}`];
    const { line, wrapped } = at(rows);
    expect(findPathsWrapped(line, wrapped, 1, rows[0]!.length + 1).map((x) => x.text)).toEqual([u]);
  });
});

describe('findPathsWrapped — 한글 줄', () => {
  it('끝까지 찼는지는 글자 수가 아니라 화면 칸으로 잰다(한글 두 칸)', () => {
    const rows = ['파일은 docs/a/', 'b.ts 에 있어'];
    const used = (i: number) => (i === 0 ? 18 : 12); // '파일은 ' = 7칸 + 경로 9칸 … 끝까지
    expect(findPathsWrapped((i) => rows[i] ?? null, () => false, 1, 20, used).map((x) => x.text)).toEqual(['docs/a/b.ts']);
  });
});

describe('routeOf — 링크를 어디서 열까(사용자 2026-09-28: 웹은 기본 브라우저, 문서는 리더)', () => {
  it('웹 주소는 브라우저', () => expect(routeOf({ kind: 'url', target: 'https://example.com' })).toBe('browser'));
  it('문서·그림·HTML·PDF 는 리더', () => {
    for (const f of ['/a/b.md', '/a/b.html', '/a/b.pdf', '/a/b.png', '/a/b.txt', '/a/README.markdown']) expect(routeOf({ kind: 'file', target: f })).toBe('reader');
  });
  it('코드·폴더 등 나머지는 기본 앱', () => {
    for (const f of ['/a/b.ts', '/a/b.rs', '/a/src']) expect(routeOf({ kind: 'file', target: f })).toBe('app');
  });
});

describe('pathCandidates — 리더 문서 속 경로 ⌘클릭: 문서 폴더부터 위로 올라가며 찾는다', () => {
  it('상대 경로는 문서 폴더 → 부모들(홈까지) 순서', () =>
    expect(pathCandidates('docs/starter.md', '/U/dev/app/docs/plans', '/U')).toEqual([
      '/U/dev/app/docs/plans/docs/starter.md', '/U/dev/app/docs/docs/starter.md', '/U/dev/app/docs/starter.md', '/U/dev/docs/starter.md', '/U/docs/starter.md',
    ]));
  it('절대·~ 경로는 그 하나', () => {
    expect(pathCandidates('/etc/hosts', '/U/x', '/U')).toEqual(['/etc/hosts']);
    expect(pathCandidates('~/a.md', '/U/x', '/U')).toEqual(['/U/a.md']);
  });
  it('줄 번호·따옴표·끝 구두점은 뗀다', () => expect(pathCandidates('`src/a.ts:12`,', '/U/p', '/U')[0]).toBe('/U/p/src/a.ts'));
  it('경로처럼 안 생긴 글자는 없음', () => expect(pathCandidates('그냥 문장이야', '/U/p', '/U')).toEqual([]));
});

describe('projectOrder — 문서 속 경로가 다른 프로젝트 기준일 때 볼 순서(사용자 2026-09-28: 상태 보고서의 docs/… 가 안 열렸다)', () => {
  const projects = ['acme-shop', 'hello-docs', 'project-a', 'todo-api'];
  it('같은 문단에 이름이 나온 프로젝트를 먼저, 나머지는 그대로', () =>
    expect(projectOrder(projects, '힐노트: hello-docs/docs/starter.md · docs/roadmap.md')).toEqual(['hello-docs', 'acme-shop', 'project-a', 'todo-api']));
  it('이름이 둘이면 먼저 나온 순서', () =>
    expect(projectOrder(projects, 'project-a 와 hello-docs')).toEqual(['project-a', 'hello-docs', 'acme-shop', 'todo-api']));
  it('이름이 없으면 원래 순서', () => expect(projectOrder(projects, '그냥 문장')).toEqual(projects));
});
