// 세션 id → 지금 붙어 있는 터미널 보기 손잡이. 끊긴 동안(null — 다시 붙는 중·참모를 다시 켜는 중) 친 말은
// 새 보기가 붙을 때까지 기다렸다 그 보기에 친다(ui/SessionGrid typeAndSend). 예전엔 그 순간의 손잡이를 쥐고 죽은 보기에 쳐서 말이 허공으로 갔다(2026-10-21)

/** 끊긴 보기를 기다리는 최대 — 참모 다시 켜기(10초 뒤 respawn·목록 3초)는 넉넉히 넘고, 끊김이 굳는 때(attachExit 90초)보다는 짧게:
 *  굳어서 채팅에 '전달 안 됨'이 뜰 땐 기다리던 말이 이미 포기돼 있어야 사람이 다시 보내도 두 번 안 간다 */
export const LINK_WAIT = 80_000;
/** 칸이 아직 붙는 중(attach 안내 줄뿐·맥이 바빠 목록을 못 읽음)이면 LINK_WAIT 를 넘겨도 이만큼까지 기다린다 — 부팅 직후 붙는 데 몇 분 걸렸다(2026-10-26) */
export const HOLD_MAX = 10 * 60_000;

export function paneLinks<T>() {
  const apis = new Map<string, T>();
  type Waiter = { ok: (api: T) => void; no: () => void };
  const waiters = new Map<string, Waiter[]>();
  const remove = (id: string, w: Waiter) => {
    const list = waiters.get(id)?.filter((x) => x !== w) ?? [];
    if (list.length) waiters.set(id, list); else waiters.delete(id);
  };
  return {
    /** 붙음(api)·끊김(null) */
    set(id: string, api: T | null) {
      if (api == null) { apis.delete(id); return; }
      apis.set(id, api);
      const w = waiters.get(id);
      waiters.delete(id);
      w?.forEach((f) => f.ok(api));
    },
    get: (id: string): T | undefined => apis.get(id),
    /** 붙어 있으면 바로, 아니면 붙을 때까지 ms 만큼 — 넘기면 실패. hold 가 참이면(아직 붙는 중·맥이 바빠 목록을 못 읽음) 한 번 더 ms 만큼 */
    wait(id: string, ms: number, hold?: () => boolean): Promise<T> {
      const now = apis.get(id);
      if (now !== undefined) return Promise.resolve(now);
      return new Promise<T>((resolve, reject) => {
        let t: ReturnType<typeof setTimeout> | undefined;
        const w: Waiter = {
          ok: (api) => { clearTimeout(t); resolve(api); },
          no: () => { clearTimeout(t); reject(new Error('pane detached')); },
        };
        const arm = () => {
          t = setTimeout(() => {
            if (hold?.()) { arm(); return; }
            remove(id, w);
            reject(new Error('pane detached'));
          }, ms);
        };
        arm();
        waiters.set(id, [...(waiters.get(id) ?? []), w]);
      });
    },
    /** 끊김이 굳음 — 기다리던 말을 바로 놓는다(채팅이 '전달 안 됨'을 띄우는 순간 줄에 남아 있으면 다시 보낸 말과 두 번 간다) */
    drop(id: string) {
      const w = waiters.get(id);
      waiters.delete(id);
      w?.forEach((f) => f.no());
    },
  };
}
