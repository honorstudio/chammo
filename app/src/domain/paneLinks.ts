// 세션 id → 지금 붙어 있는 터미널 보기 손잡이. 끊긴 동안(null — 다시 붙는 중·참모를 다시 켜는 중) 친 말은
// 새 보기가 붙을 때까지 기다렸다 그 보기에 친다(ui/SessionGrid typeAndSend). 예전엔 그 순간의 손잡이를 쥐고 죽은 보기에 쳐서 말이 허공으로 갔다(2026-10-21)

/** 끊긴 보기를 기다리는 최대 — 참모 다시 켜기(10초 뒤 respawn·목록 3초)는 넉넉히 넘고, 끊김이 굳는 때(attachExit 90초)보다는 짧게:
 *  굳어서 채팅에 '전달 안 됨'이 뜰 땐 기다리던 말이 이미 포기돼 있어야 사람이 다시 보내도 두 번 안 간다 */
export const LINK_WAIT = 80_000;

export function paneLinks<T>() {
  const apis = new Map<string, T>();
  const waiters = new Map<string, ((api: T) => void)[]>();
  return {
    /** 붙음(api)·끊김(null) */
    set(id: string, api: T | null) {
      if (api == null) { apis.delete(id); return; }
      apis.set(id, api);
      const w = waiters.get(id);
      waiters.delete(id);
      w?.forEach((f) => f(api));
    },
    get: (id: string): T | undefined => apis.get(id),
    /** 붙어 있으면 바로, 아니면 붙을 때까지 ms 만큼 — 넘기면 실패 */
    wait(id: string, ms: number): Promise<T> {
      const now = apis.get(id);
      if (now !== undefined) return Promise.resolve(now);
      return new Promise<T>((resolve, reject) => {
        const f = (api: T) => { clearTimeout(t); resolve(api); };
        const t = setTimeout(() => {
          const list = waiters.get(id)?.filter((x) => x !== f) ?? [];
          if (list.length) waiters.set(id, list); else waiters.delete(id);
          reject(new Error('pane detached'));
        }, ms);
        waiters.set(id, [...(waiters.get(id) ?? []), f]);
      });
    },
  };
}
