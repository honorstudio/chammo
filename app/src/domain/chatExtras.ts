// 채팅 말풍선 사이에 끼울 것(직접 답하기 카드) — 시각 순으로 그 시각 자리에, 고정(pin)은 맨 아래.
// 사람 답을 기다리는 카드를 물은 시각 자리에 끼우면 뒤 대화에 밀려 위로 묻힌다(2026-10-05 아이맥 — 14:10 카드를 다섯 시간 못 찾음)
export type ExtraAt = { ts: string; key: string; pin?: boolean };

export function interleave<I extends { ts: string }, X extends ExtraAt>(items: I[], extras: X[]): ({ item: I } | { extra: X })[] {
  const by = (a: X, b: X) => Date.parse(a.ts) - Date.parse(b.ts);
  const flow = extras.filter((x) => !x.pin).sort(by);
  const out: ({ item: I } | { extra: X })[] = [];
  let i = 0;
  for (const it of items) {
    while (i < flow.length && Date.parse(flow[i]!.ts) <= Date.parse(it.ts)) out.push({ extra: flow[i++]! });
    out.push({ item: it });
  }
  for (; i < flow.length; i++) out.push({ extra: flow[i]! });
  for (const x of extras.filter((e) => e.pin).sort(by)) out.push({ extra: x });
  return out;
}
