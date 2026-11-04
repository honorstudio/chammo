// 잠깐 끊김 조용히 다시 — 맥↔중계 허브 소켓이 몇 초씩 끊겼다 붙는 동안(2026-11-02, 끊긴 뒤 4~16초에 다시 붙음)
// 받기 하나가 'Load failed' 로 바로 실패해 폰에 '맥에 못 닿았어요'가 떴다. 망 오류일 때 받기(GET·HEAD)만 몇 번 더 해 본다.
// 쓰기(POST)는 맥에서 이미 됐을 수 있어 다시 안 한다(같은 말이 두 번 갈 수 있다) — 맥이 cid 로 한 번만 치는 보내기(/api/send)만 예외

/** 다시 해 보기 전 기다림(ms) — 합쳐 7초 남짓. 그 뒤로도 안 되면 받기 고리가 이어 받고, 오래 끊길 때만 화면에(domain/unreach) */
export const RETRY_DELAYS_MS = [500, 1500, 2000, 3000] as const;

/** 잠깐 끊김인가 — fetch 망 오류·터널이 낸 오류(둘 다 TypeError, 컴퓨터 꺼짐 OfflineError 도 이것을 잇는다).
 *  끊기(AbortError)·서버 답 오류(Error)·열쇠 없음은 아니다 */
export function isTransient(e: unknown): boolean {
  if (!(e instanceof TypeError)) return false;
  return e.name !== 'AbortError';
}

/** 다시 보내도 되는 요청인가 — 메서드가 없거나 GET·HEAD */
export function idempotent(init: { method?: string } | undefined): boolean {
  const m = (init?.method ?? 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD';
}

/** 망 오류 때 다시 보내도 되는가 — 받기, 또는 cid 를 단 보내기(맥 mobile_sends 가 같은 cid 는 한 번만 친다, 11-04 03:12 '못 보냈어요') */
export function retryable(path: string, init: { method?: string; body?: unknown } | undefined): boolean {
  if (idempotent(init)) return true;
  if (path !== '/api/send' || typeof init?.body !== 'string') return false;
  try {
    const cid = (JSON.parse(init.body) as { cid?: unknown }).cid;
    return typeof cid === 'string' && cid.length > 0;
  } catch {
    return false;
  }
}

const abortReason = (s: AbortSignal) => (s.reason instanceof Error || s.reason instanceof DOMException ? s.reason : new DOMException('aborted', 'AbortError'));

/** 기다리기 — 끊으면 바로 끝난다 */
function waitMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((ok) => {
    if (signal?.aborted) return ok();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      ok();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** fn 을 부르고, 잠깐 끊김이면 RETRY_DELAYS_MS 만큼 쉬며 다시. 끝까지 안 되면 마지막 오류. signal 이 끊기면 그 이유로 */
export async function netRetry<T>(fn: () => Promise<T>, o: { signal?: AbortSignal; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; delays?: readonly number[] } = {}): Promise<T> {
  const delays = o.delays ?? RETRY_DELAYS_MS;
  const sleep = o.sleep ?? waitMs;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransient(e) || i >= delays.length) throw e;
      if (o.signal?.aborted) throw abortReason(o.signal);
      await sleep(delays[i]!, o.signal);
      if (o.signal?.aborted) throw abortReason(o.signal);
    }
  }
}
