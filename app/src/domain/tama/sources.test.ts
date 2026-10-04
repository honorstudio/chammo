import { describe, expect, it } from 'vitest';
import { isGeneratedPath, isTestPath, parseCiRuns, parseCommitLog, taskEvents } from './sources';

// Rust commit_log 가 저장소마다 붙여 주는 원문: @@C\t해시\t시각(초)\t부모들\t제목 + numstat 줄
const RAW = [
  '@@C\taaa\t1790000000\tp1\tfeat: 화면 추가',
  '120\t30\tsrc/ui/A.tsx',
  '40\t0\tsrc/ui/A.test.tsx',
  '',
  '@@C\tbbb\t1790000600\tp2\tfix: 버튼 (#42)',
  '5\t1\tsrc/b.ts',
  '',
  '@@C\tccc\t1790001200\tp3 p4\tMerge pull request #43 from x/y',
  '',
  '@@C\tddd\t1790001800\tp5\tchore: 이미지',
  '-\t-\tassets/logo.png',
  '@@C\taaa\t1790000000\tp1\tfeat: 화면 추가',
  '120\t30\tsrc/ui/A.tsx',
].join('\n');

describe('parseCommitLog — git log 원문 → 다마고치 기록', () => {
  const evs = parseCommitLog(RAW);

  it('저장소 표시 줄(@@R, 하루 리플레이용)이 끼어도 그대로', () => {
    expect(parseCommitLog(RAW.split('\n').flatMap((l) => (l.startsWith('@@C') ? ['@@R\ttodo-api', l] : [l])).join('\n'))).toEqual(evs);
  });

  it('커밋 = 줄 수(추가+삭제)·테스트 파일 여부, 시각은 ms', () => {
    expect(evs[0]).toEqual({ t: 1790000000_000, type: 'commit', lines: 190, hasTest: true });
  });

  it('제목 끝 (#번호) = 스쿼시 머지 → 커밋이면서 PR 머지', () => {
    expect(evs.filter((e) => e.t === 1790000600_000).map((e) => e.type)).toEqual(['commit', 'pr']);
  });

  it('부모가 둘인 머지 커밋은 PR 머지로만 (커밋·줄 수로는 안 셈)', () => {
    expect(evs.filter((e) => e.t === 1790001200_000)).toEqual([{ t: 1790001200_000, type: 'pr' }]);
  });

  it('바이너리(-)는 0줄', () => {
    expect(evs.find((e) => e.t === 1790001800_000)).toMatchObject({ lines: 0 });
  });

  it('같은 해시는 한 번만 (여러 저장소·브랜치에 같은 커밋)', () => {
    expect(evs.filter((e) => e.t === 1790000000_000)).toHaveLength(1);
  });

  it('깨진 줄은 건너뛴다', () => {
    expect(parseCommitLog('@@C\tzz\tnope\n아무말\n')).toEqual([]);
  });
});

describe('isGeneratedPath — 줄 수에서 빼는 자동 생성 파일 (커밋 크기 규칙의 예외와 같음)', () => {
  it('lock·빌드 결과·스키마 타입·마이그레이션·스냅샷', () => {
    for (const p of ['pnpm-lock.yaml', 'app/package-lock.json', 'yarn.lock', 'src-tauri/Cargo.lock', 'ios/Podfile.lock', 'dist/index.js', 'web/build/app.js', 'a.min.js',
      'src/types/database.types.ts', 'src/api.generated.ts', 'supabase/migrations/20260901_init.sql', 'src/__snapshots__/a.snap'])
      expect(isGeneratedPath(p), p).toBe(true);
    for (const p of ['src/ui/A.tsx', 'docs/build-notes.md', 'src/lock.ts', 'sql/query.sql'])
      expect(isGeneratedPath(p), p).toBe(false);
  });

  it('커밋 줄 수에 안 들어간다 — lock 파일만 크게 바뀐 커밋은 똥이 아니다', () => {
    const raw = '@@C\teee\t1790002400\tp6\tchore: 의존성\n2\t1\tpackage.json\n900\t700\tpnpm-lock.yaml';
    expect(parseCommitLog(raw)).toEqual([{ t: 1790002400_000, type: 'commit', lines: 3, hasTest: false }]);
  });
});

describe('isTestPath', () => {
  it('흔한 테스트 파일 모양', () => {
    for (const p of ['a/b.test.ts', 'x.spec.tsx', 'src/__tests__/a.ts', 'tests/e2e/login.ts', 'pkg/foo_test.go', 'test_api.py', 'e2e/pay.spec.ts'])
      expect(isTestPath(p), p).toBe(true);
    for (const p of ['src/latest.ts', 'contest/a.ts', 'README.md', 'src/testing-utils.ts'])
      expect(isTestPath(p), p).toBe(false);
  });
});

describe('taskEvents — 참모가 시킨 일이 끝난 시각', () => {
  it('done 만, 시각은 ms', () => {
    const t = '2026-09-28T01:00:00.000Z';
    expect(taskEvents([
      { ts: t, type: 'send', task: '1', target: 'a', title: 'x' },
      { ts: t, type: 'done', task: '1' },
      { ts: 'garbage', type: 'done', task: '2' },
    ])).toEqual([{ t: Date.parse(t), type: 'task', label: 'x' }]);
  });
});

describe('parseCiRuns — GitHub Actions 실행 = 배틀', () => {
  // Rust ci_runs 원문: 저장소마다 `이름\t<gh run list JSON>` 한 줄
  const runs = (xs: object[]) => JSON.stringify(xs);
  it('끝난 것만: 성공 = 승, 실패·시간 초과 = 패. 취소·건너뜀·진행 중은 안 셈', () => {
    const raw = [
      'ops-hub\t' + runs([
        { conclusion: 'success', status: 'completed', createdAt: '2026-09-28T01:00:00Z' },
        { conclusion: 'failure', status: 'completed', createdAt: '2026-09-28T02:00:00Z' },
        { conclusion: 'cancelled', status: 'completed', createdAt: '2026-09-28T03:00:00Z' },
        { conclusion: '', status: 'in_progress', createdAt: '2026-09-28T04:00:00Z' },
      ]),
      'todo-api\t' + runs([{ conclusion: 'timed_out', status: 'completed', createdAt: '2026-09-28T05:00:00Z' }, { conclusion: 'skipped', status: 'completed', createdAt: '2026-09-28T06:00:00Z' }]),
    ].join('\n');
    expect(parseCiRuns(raw)).toEqual([
      { t: Date.parse('2026-09-28T01:00:00Z'), type: 'ci', pass: true },
      { t: Date.parse('2026-09-28T02:00:00Z'), type: 'ci', pass: false },
      { t: Date.parse('2026-09-28T05:00:00Z'), type: 'ci', pass: false },
    ]);
  });

  it('gh 오류 문구·깨진 줄은 건너뛴다', () => {
    expect(parseCiRuns('x\tHTTP 404: Not Found\n\nno-tab-line')).toEqual([]);
  });
});
