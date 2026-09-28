import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { FILE_KIND_LABEL, GATE_LABEL } from './review';
import { ciState, fileKind, gates, groupFiles, parseChecks, type OpenPr } from './review';

// 2026-09-27 실제 PR 을 줄인 것 (acme-shop-platform #388·#389·#392, ops-hub #462)
const pr = (o: Partial<OpenPr>): OpenPr => ({
  key: 'acme/x#1', repo: 'acme/x', folder: 'x', number: 1, id: 'PR_1',
  title: '', body: '', url: '', head: 'feature/a', base: 'main',
  createdAt: '2026-09-27T05:00:00Z', updatedAt: '2026-09-27T05:00:00Z', draft: false, mergeable: 'MERGEABLE',
  additions: 0, deletions: 0, files: [], checks: [], commits: [], ...o,
});
const f = (path: string, additions: number, deletions = 0) => ({ path, additions, deletions });

describe('fileKind — 파일을 코드·테스트·DB·문서·생성물로', () => {
  it('마이그레이션 SQL 은 DB', () => expect(fileKind('supabase/migrations/20260927040000_revoke.sql')).toBe('db'));
  it('테스트', () => expect(fileKind('apps/mobile/src/domain/values/bodyMap.test.ts')).toBe('test'));
  it('docs 아래·md 는 문서 (시안 생성 스크립트도)', () => {
    expect(fileKind('docs/design-drafts/body-map/gen/bodymap.py')).toBe('docs');
    expect(fileKind('.claude/CLAUDE.md')).toBe('docs');
  });
  it('lock 은 생성물', () => expect(fileKind('pnpm-lock.yaml')).toBe('generated'));
  it('나머지는 코드', () => expect(fileKind('apps/mobile/app/studio/work-log/new.tsx')).toBe('code'));
});

describe('groupFiles — 묶음마다 줄 수, 코드 먼저', () => {
  it('#392 모양', () => {
    const g = groupFiles([f('app/new.tsx', 82, 42), f('docs/a/v1.html', 817), f('src/b.test.ts', 135), f('src/c.ts', 189)]);
    expect(g.map((x) => [x.kind, x.files.length, x.additions, x.deletions])).toEqual([
      ['code', 2, 271, 42],
      ['test', 1, 135, 0],
      ['docs', 1, 817, 0],
    ]);
  });
});

describe('gates — 사용자 확인이 필요한 PR (DB·돈·보안·+500줄). 운영 배포는 조건이 아니다', () => {
  it('마이그레이션 파일 = DB', () => {
    const g = gates(pr({ title: 'run_tier_auto_adjust 실행 권한 회수', files: [f('supabase/migrations/20260927040000_revoke.sql', 26)] }));
    expect(g.map((x) => x.kind)).toEqual(['db', 'security']);
    expect(g[0]!.why).toBe('마이그레이션 1개');
  });
  it('본문의 GRANT·REVOKE·RLS = DB', () => {
    expect(gates(pr({ body: 'revoke execute on function x from anon' })).map((x) => x.kind)).toContain('db');
  });
  it('본문에 "마이그레이션은 없다" 는 DB 아님 (#462)', () => {
    expect(gates(pr({ body: 'jsonb라 마이그레이션은 없다' }))).toEqual([]);
  });
  it('결제·환불·과금 말 = 돈 (scripts/task 결제 관문과 같은 말)', () => {
    expect(gates(pr({ title: '예약 환불 처리' }))[0]).toEqual({ kind: 'money', why: '"환불"' });
    expect(gates(pr({ files: [f('src/billing/plan.ts', 10)] }))[0]).toEqual({ kind: 'money', why: 'src/billing/plan.ts' });
  });
  it('영어는 낱말로만 — discharge 는 돈 아님', () => {
    expect(gates(pr({ body: 'battery discharge curve' }))).toEqual([]);
  });
  it('본문의 키 이름 = 보안 (#462 OPENAI_API_KEY)', () => {
    expect(gates(pr({ body: '- Vercel `OPENAI_API_KEY` (Production·Preview)' }))).toEqual([{ kind: 'security', why: 'OPENAI_API_KEY' }]);
  });
  it('키는 환경변수 모양만 — 게임 용어 "SECRET 은 안 남긴다" 는 보안 아님 (scene #48)', () => {
    expect(gates(pr({ body: 'SECRET은 안 남긴다' }))).toEqual([]);
    expect(gates(pr({ body: 'SUPABASE_SERVICE_ROLE_KEY 추가' }))).toEqual([{ kind: 'security', why: 'SUPABASE_SERVICE_ROLE_KEY' }]);
  });
  it('본문에 "권한" 이 스쳐 지나간 건 보안 아님 — 제목만 본다 (#392 "computer-use 권한 없음")', () => {
    expect(gates(pr({ title: '작업일지 인체 그림', body: '손가락 터치는 못 눌러봄(computer-use 권한 없음)' }))).toEqual([]);
  });
  it('제목의 SECURITY DEFINER = DB + 보안 (#389)', () => {
    expect(gates(pr({ title: '누구나 부를 수 있던 SECURITY DEFINER 함수 정리' }))).toEqual([
      { kind: 'db', why: '"SECURITY DEFINER"' },
      { kind: 'security', why: '"SECURITY DEFINER"' },
    ]);
  });
  it('코드(+테스트·DB) 500줄 이상 = 큼. 문서·생성물은 안 센다 (#392 = 코드 +807)', () => {
    const g = gates(pr({ files: [f('app/a.tsx', 557), f('app/a.test.ts', 250), f('docs/draft.html', 2872), f('pnpm-lock.yaml', 900)] }));
    expect(g).toEqual([{ kind: 'big', why: '코드 +807' }]);
    expect(gates(pr({ files: [f('app/a.tsx', 499), f('docs/x.md', 3000)] }))).toEqual([]);
  });
  it('배포만 걸리는 건 조건 아님 (ops-hub 는 머지 = Vercel 배포)', () => {
    expect(gates(pr({ title: '제안서 문구 수정', body: '머지하면 Vercel 운영 배포' }))).toEqual([]);
  });
});

describe('parseChecks · ciState — CheckRun·StatusContext 둘 다', () => {
  const rollup = [
    { __typename: 'CheckRun', name: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'u1' },
    { __typename: 'StatusContext', context: 'Vercel', state: 'SUCCESS', targetUrl: 'u2' },
  ];
  it('통과', () => {
    expect(parseChecks(rollup)).toEqual([{ name: 'CI', state: 'pass', url: 'u1' }, { name: 'Vercel', state: 'pass', url: 'u2' }]);
    expect(ciState(parseChecks(rollup))).toBe('pass');
  });
  it('하나라도 실패면 실패, 도는 중이면 도는 중, 없으면 없음', () => {
    expect(ciState(parseChecks([...rollup, { __typename: 'CheckRun', name: 'e2e', status: 'COMPLETED', conclusion: 'FAILURE' }]))).toBe('fail');
    expect(ciState(parseChecks([...rollup, { __typename: 'CheckRun', name: 'e2e', status: 'IN_PROGRESS', conclusion: '' }]))).toBe('running');
    expect(ciState(parseChecks([{ __typename: 'StatusContext', context: 'x', state: 'PENDING' }]))).toBe('running');
    expect(ciState([])).toBe('none');
  });
  it('건너뜀(SKIPPED·NEUTRAL)은 통과를 막지 않는다', () => {
    expect(ciState(parseChecks([...rollup, { __typename: 'CheckRun', name: 'deploy', status: 'COMPLETED', conclusion: 'SKIPPED' }]))).toBe('pass');
  });
});

describe('영어 모드', () => {
  afterEach(() => setLang('ko'));
  it('조건·파일 묶음 이름과 이유를 영어로 — 열쇠(kind)는 그대로', () => {
    expect(GATE_LABEL.db).toBe('DB 변경');
    setLang('en');
    expect(GATE_LABEL.db).toBe('DB change');
    expect(FILE_KIND_LABEL.docs).toBe('Docs & drafts');
    const g = gates(pr({ files: [f('supabase/migrations/1.sql', 10), f('src/a.ts', 600)] }));
    expect(g.map((x) => [x.kind, x.why])).toEqual([['db', '1 migration'], ['big', 'code +610']]);
  });
});
