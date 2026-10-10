// 채팅 뷰 메뉴 트리(v10) — 참모·프로젝트마다 "대시보드 + 문서들", 그리고 내 페이지

/** 참모 밑 문서 — 고정(pinned)은 늘, 나머지는 그 참모가 띄운 md 를 최근 먼저(그때그때 쓴 것) */
export function orchDocs(showLog: string, orchId: string, pinned: string[]): { pinned: string[]; recent: string[] } {
  const seen = new Set(pinned);
  const recent: string[] = [];
  const lines = showLog.split('\n').reverse();
  for (const line of lines) {
    try {
      const r = JSON.parse(line) as { path?: string; from?: string; gone?: boolean };
      if (r.from !== orchId || !r.path || r.gone || !/\.md$/i.test(r.path) || seen.has(r.path)) continue;
      seen.add(r.path);
      recent.push(r.path);
    } catch {
      // 깨진 줄은 건너뛴다
    }
  }
  return { pinned, recent };
}

/** 고정한 문서 경로 전부(한 번씩) — Rust moved_paths 에 물어볼 것 */
export const pinPaths = (pins: Record<string, string[]>) => [...new Set(Object.values(pins).flat())];

/** 닫힌 워크트리에서 옮겨 간 고정 문서를 새 자리로(moved = 옛 경로 → 새 경로). 바뀐 게 없으면 null */
export function remapPins(pins: Record<string, string[]>, moved: Record<string, string>): Record<string, string[]> | null {
  let changed = false;
  const out: Record<string, string[]> = {};
  for (const [k, list] of Object.entries(pins)) {
    const next = [...new Set(list.map((p) => moved[p] ?? p))];
    if (next.length !== list.length || next.some((p, i) => p !== list[i])) changed = true;
    out[k] = next;
  }
  return changed ? out : null;
}

/** 워크트리(.claude/worktrees/x) 세션은 프로젝트 본체 폴더로 */
export const projectRoot = (cwd: string) => cwd.replace(/\/\.claude\/worktrees\/[^/]+\/?$/, '');

/** 프로젝트 세션들을 본체 폴더로 묶는다(처음 나온 순서) */
export function projectGroups<S extends { id: string; cwd: string; project: string }>(sessions: S[]): { name: string; root: string; sessions: S[] }[] {
  const out: { name: string; root: string; sessions: S[] }[] = [];
  for (const s of sessions) {
    const root = projectRoot(s.cwd);
    const g = out.find((x) => x.root === root);
    if (g) g.sessions.push(s);
    else out.push({ name: s.project, root, sessions: [s] });
  }
  return out;
}

/** 메뉴에 보일 문서 이름 — 파일 이름에서 .md, ADR 번호(0003-) 뗀다 */
export const docTitle = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/i, '').replace(/^\d{3,4}-/, '');
