// 대화 기록 꼬리 — 안 바뀐 세션은 글을 다시 안 받는다. 세션 13개 × 256KB 를 10초·3초마다 받아 분당 23MB 를 풀었고(11-07 실측) 이게 가만히 웹뷰 CPU·메모리의 주범이었다.
// 맥은 표(크기·고친 시각)가 같으면 글 없이 표만 준다. 부르는 쪽은 예전처럼 세션 → 글 지도를 받는다(같은 글이면 같은 문자열 — foldTails 가 바로 같다고 본다)
export type TailReply = { s: string; t?: string };
export type TailRead = (ids: string[], tail: number | undefined, known: Record<string, string> | undefined) => Promise<Record<string, TailReply>>;

/** 기억할 세션 수 — 넘으면 오래된 것부터 뺀다(한 세션 256KB) */
export const TAIL_KEEP = 64;

export function makeTailReader(read: TailRead) {
  const cache = new Map<string, { s: string; t: string }>();
  return async (ids: string[], tail?: number): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    // 깊게 읽기(DEEP_TAIL)는 드물고 크다 — 기억하지 않는다
    if (tail !== undefined) {
      for (const [id, v] of Object.entries(await read(ids, tail, undefined))) if (v.t !== undefined) out[id] = v.t;
      return out;
    }
    const known: Record<string, string> = {};
    for (const id of ids) {
      const c = cache.get(id);
      if (c) known[id] = c.s;
    }
    const got = await read(ids, undefined, known);
    for (const [id, v] of Object.entries(got)) {
      if (v.t !== undefined) {
        cache.delete(id); // 맨 뒤로 — 오래 안 바뀐 것부터 빠지게
        cache.set(id, { s: v.s, t: v.t });
      }
      const c = cache.get(id);
      if (c) out[id] = c.t;
    }
    while (cache.size > TAIL_KEEP) cache.delete(cache.keys().next().value as string);
    return out;
  };
}
