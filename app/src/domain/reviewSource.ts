// gh 원문(Rust review.rs 가 돌려준 그대로) → 리뷰 화면 자료. 못 읽는 건 조용히 빈 값 — GitHub 가 잠깐 안 돼도 앱 나머지는 그대로
import { parseChecks, type OpenPr, type PrFile } from './review';

export type MergedPr = { key: string; repo: string; folder: string; number: number; id: string; title: string; url: string; mergedAt: string };
export type Hit = { key: string; repo: string; folder: string; number: number; updatedAt: string };
/** 소문자 'owner/name' → dev 아래 폴더 이름 */
export type RepoMap = Record<string, string>;

const json = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** Rust repo_map: 줄마다 `폴더\t origin url`. GitHub 저장소만 */
export function parseRepoMap(raw: string): RepoMap {
  const out: RepoMap = {};
  for (const line of raw.split('\n')) {
    const [folder, url = ''] = line.split('\t');
    const m = url.trim().match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(\.git)?$/i);
    if (folder && m) out[m[1]!.toLowerCase()] = folder;
  }
  return out;
}

type SearchRow = { number?: number; id?: string; title?: string; url?: string; updatedAt?: string; closedAt?: string; repository?: { nameWithOwner?: string } };

const rows = (raw: string, map: RepoMap) =>
  (Array.isArray(json(raw)) ? (json(raw) as SearchRow[]) : [])
    .map((r) => ({ r, repo: r.repository?.nameWithOwner ?? '' }))
    .filter(({ r, repo }) => typeof r.number === 'number' && map[repo.toLowerCase()] !== undefined)
    .map(({ r, repo }) => ({ r, repo, folder: map[repo.toLowerCase()]!, key: `${repo}#${r.number}` }));

/** gh search prs --state open — dev 아래 저장소만. 상세는 needsView 인 것만 다시 읽는다 */
export const parseHits = (raw: string, map: RepoMap): Hit[] =>
  rows(raw, map).map(({ r, repo, folder, key }) => ({ key, repo, folder, number: r.number!, updatedAt: r.updatedAt ?? '' }));

/** 상세(gh pr view)를 다시 읽을지 — updatedAt 이 바뀌었거나, 도는 중인 검사가 있을 때.
 *  검사가 끝나도 PR updatedAt 은 안 바뀐다(#483 실측: updatedAt 08:45:05, CI 끝 08:47:37) — updatedAt 만 보면 'CI 도는 중'에 굳는다 */
export const needsView = (cached: OpenPr | undefined, hit: Hit): boolean =>
  !cached || cached.updatedAt !== hit.updatedAt || cached.checks.some((c) => c.state === 'running');

/** gh search prs --merged — 검색 결과엔 mergedAt 이 없어 closedAt(머지 = 닫힘)을 쓴다. 최근 위 */
export const parseMerged = (raw: string, map: RepoMap): MergedPr[] =>
  rows(raw, map)
    .map(({ r, repo, folder, key }) => ({ key, repo, folder, number: r.number!, id: r.id ?? '', title: r.title ?? '', url: r.url ?? '', mergedAt: r.closedAt ?? '' }))
    .sort((a, b) => (a.mergedAt < b.mergedAt ? 1 : a.mergedAt > b.mergedAt ? -1 : 0));

type ViewJson = {
  number?: number; id?: string; title?: string; body?: string; url?: string; headRefName?: string; baseRefName?: string;
  createdAt?: string; updatedAt?: string; isDraft?: boolean; mergeable?: string; additions?: number; deletions?: number;
  files?: PrFile[]; statusCheckRollup?: unknown; commits?: { messageHeadline?: string }[];
};

/** gh pr view --json … 한 건 */
export function parseView(raw: string, folder: string, repo: string): OpenPr | null {
  const v = json(raw) as ViewJson | null;
  if (!v || typeof v.number !== 'number') return null;
  return {
    key: `${repo}#${v.number}`, repo, folder, number: v.number, id: v.id ?? '',
    title: v.title ?? '', body: v.body ?? '', url: v.url ?? '', head: v.headRefName ?? '', base: v.baseRefName ?? '',
    createdAt: v.createdAt ?? '', updatedAt: v.updatedAt ?? '', draft: !!v.isDraft, mergeable: v.mergeable ?? 'UNKNOWN',
    additions: v.additions ?? 0, deletions: v.deletions ?? 0,
    files: (v.files ?? []).map((f) => ({ path: f.path, additions: f.additions ?? 0, deletions: f.deletions ?? 0 })),
    checks: parseChecks(v.statusCheckRollup),
    commits: (v.commits ?? []).map((c) => c.messageHeadline ?? '').filter(Boolean),
  };
}

export type DiffFile = { path: string; lines: string[]; /** 상한을 넘어 안 보여 준 줄 수 */ cut: number };

/** gh pr diff 원문 → 파일별. 파일당 max 줄까지만(큰 PR #154 는 파일 126개) — 화면은 펼친 파일만 그린다 */
export function parseDiff(raw: string, max = 400): DiffFile[] {
  const out: DiffFile[] = [];
  let cur: DiffFile | null = null;
  let inHunk = false;
  for (const line of raw.split('\n')) {
    const head = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (head) {
      cur = { path: head[2]!, lines: [], cut: 0 };
      out.push(cur);
      inHunk = false;
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('@@')) inHunk = true;
    if (!inHunk) continue;
    if (cur.lines.length < max) cur.lines.push(line);
    else cur.cut += 1;
  }
  return out;
}
