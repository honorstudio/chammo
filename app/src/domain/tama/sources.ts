// 다마고치 먹이 출처 — 작업 기록 원문을 pet.ts 의 TamaEvent 로 바꾼다
import type { TaskEvent } from '../tasks';
import type { TamaEvent } from './pet';

const TEST_PATH = /(^|\/)(__tests__|tests?|e2e|spec)\/|\.(test|spec)\.[a-z0-9]+$|_test\.[a-z]+$|(^|\/)test_[^/]+\.py$/i;
export const isTestPath = (p: string) => TEST_PATH.test(p);

// 커밋 크기 규칙이 예외로 인정하는 자동 생성물 — lock·빌드 결과·스키마 타입·마이그레이션·스냅샷. 줄 수(똥)에서 뺀다
const GENERATED = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|[^/]+\.lock)$|(^|\/)(dist|build)\/|\.min\.(js|css)$|(\.types|\.generated|\.gen)\.[a-z]+$|(^|\/)migrations\/[^/]+\.sql$|(^|\/)__snapshots__\//i;
export const isGeneratedPath = (p: string) => GENERATED.test(p);

/** 스쿼시 머지는 GitHub 가 제목 끝에 (#번호) 를 붙인다 */
const SQUASH_PR = /\(#\d+\)\s*$/;

/**
 * Rust `commit_log` 원문: 커밋마다 `@@C\t해시\t시각(초)\t부모들\t제목` 한 줄 + `--numstat` 줄들.
 * 부모가 둘 이상 = 머지 커밋 → PR 머지(특식)로만 센다. 같은 해시는 한 번만(저장소·브랜치 중복)
 */
export function parseCommitLog(raw: string): TamaEvent[] {
  const out: TamaEvent[] = [];
  const seen = new Set<string>();
  let cur: { t: number; lines: number; hasTest: boolean; pr: boolean } | null = null;
  const flush = () => {
    if (!cur) return;
    out.push({ t: cur.t, type: 'commit', lines: cur.lines, hasTest: cur.hasTest });
    if (cur.pr) out.push({ t: cur.t, type: 'pr' });
    cur = null;
  };
  let skip = false;
  for (const line of raw.split('\n')) {
    if (line.startsWith('@@C\t')) {
      flush();
      const [, hash = '', sec = '', parents = '', subject = ''] = line.split('\t');
      const t = Number(sec) * 1000;
      skip = !hash || !Number.isFinite(t) || seen.has(hash);
      if (skip) continue;
      seen.add(hash);
      if (parents.trim().split(/\s+/).length > 1) { out.push({ t, type: 'pr' }); skip = true; continue; }
      cur = { t, lines: 0, hasTest: false, pr: SQUASH_PR.test(subject) };
      continue;
    }
    if (skip || !cur) continue;
    const [a, d, path] = line.split('\t');
    if (path === undefined) continue;
    if (!isGeneratedPath(path)) cur.lines += (Number(a) || 0) + (Number(d) || 0);
    if (isTestPath(path)) cur.hasTest = true;
  }
  flush();
  return out;
}

/** 참모가 시킨 일이 끝남 = 단백질 */
export function taskEvents(events: TaskEvent[]): TamaEvent[] {
  return events
    .filter((e) => e.type === 'done')
    .map((e) => Date.parse(e.ts))
    .filter((t) => Number.isFinite(t))
    .map((t) => ({ t, type: 'task' as const }));
}

type GhRun = { conclusion?: string; status?: string; createdAt?: string };
const WIN = new Set(['success']);
const LOSE = new Set(['failure', 'timed_out', 'startup_failure']);

/** Rust `ci_runs` 원문(저장소마다 `이름\t<gh run list JSON>`) → 배틀. 끝난 실행만, 취소·건너뜀은 판으로 안 친다 */
export function parseCiRuns(raw: string): TamaEvent[] {
  const out: TamaEvent[] = [];
  for (const line of raw.split('\n')) {
    const json = line.slice(line.indexOf('\t') + 1);
    if (!line.includes('\t') || !json.startsWith('[')) continue;
    let runs: GhRun[];
    try { runs = JSON.parse(json) as GhRun[]; } catch { continue; }
    for (const r of runs) {
      const t = Date.parse(r.createdAt ?? '');
      const c = r.conclusion ?? '';
      if (r.status !== 'completed' || !Number.isFinite(t) || !(WIN.has(c) || LOSE.has(c))) continue;
      out.push({ t, type: 'ci', pass: WIN.has(c) });
    }
  }
  return out;
}
