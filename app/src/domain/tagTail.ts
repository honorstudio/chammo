// 폰 받기 고리의 '바뀐 것만 받기' — 예전엔 show 기록(5초마다 최대 64KB)·세션 목록(3초마다 수 KB)을 통째로 다시 받았다(2026-10-09).
// show 기록은 세션별 공평 나누기 꼬리(reader::fair_tail)라 바이트 자리로 이어 붙일 수 없어서, 서버가 낸 글의 꼬리표(tag)를 since 로 돌려주면
// 같을 때 글 없이 {same:true} 만 온다(mobile_http tagged). 이어 붙이는 기록(tasks.jsonl)은 domain/taskTail
export type TagChunk = { text: string; tag: string; same: boolean };

/** 서버 몸통 — 첫 줄 {"tag","same"}, 그 뒤 = 원문(same 이면 빈 글) */
export function parseTagChunk(body: string): TagChunk {
  const i = body.indexOf('\n');
  const m = (i < 0 ? null : JSON.parse(body.slice(0, i))) as { tag?: unknown; same?: unknown } | null;
  if (!m || typeof m.tag !== 'string' || typeof m.same !== 'boolean') throw new Error('bad tag chunk');
  return { text: body.slice(i + 1), tag: m.tag, same: m.same };
}

/** 받기 함수 — 지난번 꼬리표를 since 로. 겹쳐 받은 늦은 답은 더 늦게 보낸 요청의 답을 덮지 않는다 */
export function makeTagTail(read: (since: string, signal?: AbortSignal) => Promise<TagChunk>): (signal?: AbortSignal) => Promise<string> {
  let text = '';
  let tag = '';
  let sent = 0;
  let applied = 0;
  return async (signal) => {
    const n = ++sent;
    const since = tag;
    const c = await read(since, signal);
    if (n < applied) return text;
    applied = n;
    // same = 보낸 since 와 같다는 뜻 — 그사이 다른 답으로 글을 바꿨으면 지금 글이 맞는지 모르니 다음엔 통째로
    if (c.same) {
      if (since !== tag) tag = '';
      return text;
    }
    text = c.text;
    tag = c.tag;
    return text;
  };
}
