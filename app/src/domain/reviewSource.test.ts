import { describe, expect, it } from 'vitest';
import { parseDiff, parseHits, parseMerged, parseRepoMap, parseView } from './reviewSource';

const map = { 'acme/acme-shop-platform': 'acme-shop-platform', 'acme/cookbook': 'Cookbook' };

describe('parseRepoMap — dev 아래 폴더 ↔ GitHub 저장소 (Rust: 폴더\\t origin url)', () => {
  it('ssh·https 둘 다, 대소문자 무시, GitHub 아닌 건 뺀다', () => {
    const raw = ['acme-shop-platform\tgit@github.com:acme/acme-shop-platform.git', 'Cookbook\thttps://github.com/acme/Cookbook.git', 'local\t', 'gl\thttps://gitlab.com/a/b.git'].join('\n');
    expect(parseRepoMap(raw)).toEqual(map);
  });
});

describe('parseHits — gh search prs 결과 중 dev 아래 저장소만', () => {
  it('열린 PR', () => {
    const json = JSON.stringify([
      { number: 392, repository: { nameWithOwner: 'acme/acme-shop-platform' }, updatedAt: '2026-09-27T10:04:00Z' },
      { number: 2, repository: { nameWithOwner: 'acme/project-e' }, updatedAt: '2026-02-23T03:58:04Z' },
    ]);
    expect(parseHits(json, map)).toEqual([{ key: 'acme/acme-shop-platform#392', repo: 'acme/acme-shop-platform', folder: 'acme-shop-platform', number: 392, updatedAt: '2026-09-27T10:04:00Z' }]);
  });
  it('깨진 JSON 은 빈 목록', () => expect(parseHits('gh: rate limit', map)).toEqual([]));
});

describe('parseMerged — 오늘 머지된 것, 최근 위', () => {
  it('closedAt = 머지 시각', () => {
    const json = JSON.stringify([
      { number: 32, id: 'P32', title: '상담: 반반 안내', url: 'u32', closedAt: '2026-09-26T19:49:18Z', repository: { nameWithOwner: 'acme/cookbook' } },
      { number: 392, id: 'P392', title: '인체 그림', url: 'u392', closedAt: '2026-09-27T10:05:02Z', repository: { nameWithOwner: 'acme/acme-shop-platform' } },
    ]);
    expect(parseMerged(json, map).map((m) => [m.folder, m.number, m.mergedAt])).toEqual([
      ['acme-shop-platform', 392, '2026-09-27T10:05:02Z'],
      ['Cookbook', 32, '2026-09-26T19:49:18Z'],
    ]);
  });
});

describe('parseView — gh pr view JSON 을 OpenPr 로', () => {
  const json = JSON.stringify({
    number: 388, id: 'PR_x', title: 'run_tier_auto_adjust 실행 권한 회수', body: '## 왜\n…', url: 'u',
    headRefName: 'fix/revoke', baseRefName: 'main', createdAt: 'c', updatedAt: 'u2', isDraft: false, mergeable: 'MERGEABLE',
    additions: 26, deletions: 0,
    files: [{ path: 'supabase/migrations/1.sql', additions: 26, deletions: 0 }],
    statusCheckRollup: [{ __typename: 'CheckRun', name: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    commits: [{ messageHeadline: '실행 권한 회수', oid: 'a' }],
  });
  it('필드·CI·커밋 제목', () => {
    const p = parseView(json, 'acme-shop-platform', 'acme/acme-shop-platform')!;
    expect(p.key).toBe('acme/acme-shop-platform#388');
    expect(p.checks).toEqual([{ name: 'CI', state: 'pass' }]);
    expect(p.commits).toEqual(['실행 권한 회수']);
    expect(p.files[0]!.path).toBe('supabase/migrations/1.sql');
    expect(p.head).toBe('fix/revoke');
  });
  it('못 읽으면 null', () => expect(parseView('', 'x', 'o/x')).toBeNull());
});

describe('parseDiff — 파일별로 @@ 부터, 너무 길면 자른다', () => {
  const raw = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1..2 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,3 @@',
    ' const a = 1;',
    '+const b = 2;',
    'diff --git a/db/1.sql b/db/1.sql',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/db/1.sql',
    '@@ -0,0 +1,3 @@',
    '+a',
    '+b',
    '+c',
  ].join('\n');
  it('파일 두 개', () => {
    expect(parseDiff(raw)).toEqual([
      { path: 'src/a.ts', lines: ['@@ -1,2 +1,3 @@', ' const a = 1;', '+const b = 2;'], cut: 0 },
      { path: 'db/1.sql', lines: ['@@ -0,0 +1,3 @@', '+a', '+b', '+c'], cut: 0 },
    ]);
  });
  it('파일당 줄 수 상한 — 남은 줄 수를 cut 에', () => {
    expect(parseDiff(raw, 2)[1]).toEqual({ path: 'db/1.sql', lines: ['@@ -0,0 +1,3 @@', '+a'], cut: 2 });
  });
});
