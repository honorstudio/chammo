/** 문서 찾기 — 글 조각(텍스트 노드)들에서 찾은 자리. 조각을 넘는 건 안 찾는다(노션·브라우저도 대부분 한 덩어리 안) */
export function findAll(parts: string[], q: string): [number, number, number][] {
  const needle = q.toLowerCase();
  if (!needle) return [];
  const out: [number, number, number][] = [];
  parts.forEach((p, i) => {
    const hay = p.toLowerCase();
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) out.push([i, at, at + needle.length]);
  });
  return out;
}

/** 짚어 보여 주기 — 조각들을 이어 붙인 글에서 needle 의 nth 번째(없으면 처음) 자리를 [조각, 위치] 로.
 *  굵게·코드처럼 조각이 나뉜 줄도 찾는다. 못 찾으면 앞 20글자로 다시(원본과 화면 글이 조금 다를 때) */
export function locate(parts: string[], needle: string, nth: number): { start: [number, number]; end: [number, number] } | null {
  const hay = parts.join('').toLowerCase();
  const tryFind = (q: string) => {
    const hits: number[] = [];
    for (let i = hay.indexOf(q); i >= 0 && q; i = hay.indexOf(q, i + q.length)) hits.push(i);
    return hits.length ? [hits[nth] ?? hits[0]!, q.length] as const : null;
  };
  const q = needle.toLowerCase().trim();
  const hit = tryFind(q) ?? (q.length > 20 ? tryFind(q.slice(0, 20)) : null);
  if (!hit) return null;
  const at = (pos: number, end: boolean): [number, number] => {
    let base = 0;
    for (let i = 0; i < parts.length; i++) {
      const len = parts[i]!.length;
      if (pos < base + len || (end && pos === base + len)) return [i, pos - base];
      base += len;
    }
    return [parts.length - 1, parts[parts.length - 1]!.length];
  };
  return { start: at(hit[0], false), end: at(hit[0] + hit[1], true) };
}
