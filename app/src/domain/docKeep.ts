// 최근 참모 문서 살려 두기(2026-10-12 사용자 결정) — 참모를 바꿀 때마다 스페이스 문서 편집기(BlockNote)를 부수고 새로 만들어
// 움직임 뒤 120~250ms 굳었다. 최근 참모 몇 명의 문서는 화면에서 떼어 낸 채 살려 두고 돌아오면 그대로 다시 붙인다(ui/space/docKeep)

/** 편집기 하나 ≈ JS 힙 0.9MB + DOM 1,400개(md 241블록, 크롬 실측) — 메모리가 모자라 스왑을 쓰면(4GB, domain/load level 의 바쁨 기준) 지금 것 하나만 */
export function docKeepLimit(swapGb: number | null): number {
  return swapGb != null && swapGb >= 4 ? 1 : 3;
}

/** id 를 맨 뒤(최근)로 옮기고 한도를 넘으면 앞(오래된 것)부터 내린다 — id 는 안 내린다 */
export function keepTouch(order: string[], id: string, limit: number): { order: string[]; drop: string[] } {
  const next = [...order.filter((x) => x !== id), id];
  const n = Math.max(0, next.length - Math.max(1, limit));
  return { order: next.slice(n), drop: next.slice(0, n) };
}
