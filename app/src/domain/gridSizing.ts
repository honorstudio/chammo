// 격자 창 크기(경계선 끌기)와 순서(창 끌어 옮기기). 크기는 fr 비율 배열로 저장한다.

const MIN_SHARE = 0.1; // 한 칸은 전체의 10% 밑으로 안 줄인다 — 터미널이 한 줄도 안 보이게 되는 걸 막는다

/** 저장된 비율이 지금 칸 수와 맞을 때만 쓰고, 아니면 균등 */
export function tracksFor(saved: number[] | undefined, n: number): number[] {
  return saved && saved.length === n ? saved : Array.from({ length: n }, () => 1);
}

/**
 * 경계선 i(칸 i-1 과 칸 i 사이)를 끌었다. delta 는 전체 길이 대비 비율(오른쪽·아래가 +).
 * 두 칸만 주고받아서 합은 그대로다
 */
export function resizeTracks(fr: number[], i: number, delta: number): number[] {
  const total = fr.reduce((a, b) => a + b, 0);
  const a = fr[i - 1];
  const b = fr[i];
  if (a == null || b == null) return fr;
  const min = total * MIN_SHARE;
  const d = Math.max(min - a, Math.min(b - min, delta * total));
  const out = [...fr];
  out[i - 1] = a + d;
  out[i] = b - d;
  return out;
}

/** 사용자가 정한 순서를 먼저, 새로 생긴 세션은 뒤에. 사라진 세션은 버린다 */
export function applyOrder(ids: string[], saved: string[] | undefined): string[] {
  if (!saved?.length) return ids;
  const known = saved.filter((x) => ids.includes(x));
  return [...known, ...ids.filter((x) => !known.includes(x))];
}

/** from 창을 to 창 자리로 옮긴다 (나머지는 한 칸씩 밀림) */
export function moveTo(order: string[], from: string, to: string): string[] {
  const i = order.indexOf(from);
  const j = order.indexOf(to);
  if (i < 0 || j < 0 || i === j) return order;
  const out = order.filter((x) => x !== from);
  out.splice(j, 0, from);
  return out;
}
