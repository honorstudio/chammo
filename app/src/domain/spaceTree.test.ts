import { describe, expect, it } from 'vitest';
import { docTitle, orchDocs, projectGroups, projectRoot } from './spaceTree';

const show = (from: string, path: string, ts: string) => JSON.stringify({ ts, path, from });

describe('orchDocs — 참모 밑 문서: 고정은 늘, 나머지는 그 참모가 띄운 md(최근 먼저) — v10 Q3', () => {
  const log = [
    show('b1', '/d/a.md', '2026-09-30T01:00:00Z'),
    show('b1', '/d/v1.html', '2026-09-30T02:00:00Z'),
    show('b2', '/d/other.md', '2026-09-30T03:00:00Z'),
    show('b1', '/d/b.md', '2026-09-30T04:00:00Z'),
    show('b1', '/d/a.md', '2026-09-30T05:00:00Z'),
  ].join('\n');
  it('md 만, 같은 건 한 번, 최근 먼저, 고정한 건 이번 세션 쪽에서 빠진다', () => {
    expect(orchDocs(log, 'b1', ['/d/b.md'])).toEqual({ pinned: ['/d/b.md'], recent: ['/d/a.md'] });
    expect(orchDocs(log, 'b1', [])).toEqual({ pinned: [], recent: ['/d/a.md', '/d/b.md'] });
  });
  it('지워진 문서(gone)는 최근 목록에서 뺀다', () => {
    const l = `${log}\n${JSON.stringify({ ts: '2026-09-30T06:00:00Z', path: '/d/gone.md', from: 'b1', gone: true })}`;
    expect(orchDocs(l, 'b1', []).recent).toEqual(['/d/a.md', '/d/b.md']);
  });
});

describe('projectRoot / projectGroups — 프로젝트마다 워크트리 세션을 묶는다', () => {
  it('워크트리 경로는 본체로', () => {
    expect(projectRoot('/u/dev/project-a/.claude/worktrees/oms')).toBe('/u/dev/project-a');
    expect(projectRoot('/u/dev/project-x-app')).toBe('/u/dev/project-x-app');
  });
  it('같은 본체끼리 한 묶음, 이름은 프로젝트', () => {
    const s = (id: string, cwd: string, project: string) => ({ id, cwd, project });
    const g = projectGroups([s('1', '/u/dev/project-a/.claude/worktrees/oms', 'project-a'), s('2', '/u/dev/project-x', 'project-x'), s('3', '/u/dev/project-a', 'project-a')]);
    expect(g.map((x) => [x.name, x.root, x.sessions.map((y) => y.id)])).toEqual([
      ['project-a', '/u/dev/project-a', ['1', '3']],
      ['project-x', '/u/dev/project-x', ['2']],
    ]);
  });
});

describe('docTitle — 메뉴에 보일 문서 이름', () => {
  it('확장자 빼고, decisions 안은 번호 떼고', () => {
    expect(docTitle('/p/docs/starter.md')).toBe('starter');
    expect(docTitle('/p/docs/decisions/0003-tauri-app.md')).toBe('tauri-app');
    expect(docTitle('/x/이번 주 생각.md')).toBe('이번 주 생각');
  });
});
