// 사이드바 프로젝트 검색. 앞 일치 > 중간 일치 > 띄엄띄엄(hd → hello-docs) 순으로.

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');

function subsequence(q: string, t: string): boolean {
  let i = 0;
  for (const c of t) if (c === q[i]) i++;
  return i === q.length;
}

export function searchProjects(query: string, names: string[]): string[] {
  const q = norm(query);
  if (!q) return names;
  const score = (name: string) => {
    const t = norm(name);
    if (t.startsWith(q)) return 0;
    if (t.includes(q)) return 1;
    if (subsequence(q, t)) return 2;
    return -1;
  };
  return names
    .map((n, i) => ({ n, i, s: score(n) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.n);
}
