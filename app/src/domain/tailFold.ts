// 대화 기록 꼬리 → 요약(activity) — 바뀐 꼬리만 다시 푼다. 10초마다 세션마다 256KB 를 전부 다시 풀고(JSON.parse)
// 매번 새 객체로 넣어 App 전체가 다시 그려졌다(2026-11-01 ux-daily M9). 읽는 주기·신선도는 그대로
export function foldTails<S>(prevRaws: Readonly<Record<string, string>>, prevSums: Readonly<Record<string, S>>, tails: Readonly<Record<string, string>>, summarize: (raw: string) => S): { raws: Record<string, string>; sums: Record<string, S>; changed: boolean } {
  const ids = Object.keys(tails);
  let changed = ids.length !== Object.keys(prevSums).length;
  const sums: Record<string, S> = {};
  for (const id of ids) {
    const raw = tails[id]!;
    if (prevRaws[id] === raw && id in prevSums) sums[id] = prevSums[id]!;
    else { sums[id] = summarize(raw); changed = true; }
  }
  return { raws: { ...tails }, sums: changed ? sums : (prevSums as Record<string, S>), changed };
}
