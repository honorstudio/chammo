// 같은 걸 여러 화면이 따로 묻던 폴링을 하나로(2026-10-11 perf 4번 — agent_lives 를 App·SpaceView 가 각자 1.5초마다).
// 구독자가 하나라도 있으면 한 바퀴만 돌고, 다 떠나면 멈춘다. 받은 값이 같으면 알리지 않는다(화면이 다시 안 그린다)

/** 주기 실행기 — fn 을 ms 마다, 멈추는 함수를 돌려준다. 앱은 보임에 따라 늦추는 ui/poll every 를 넘긴다 */
export type Every = (fn: () => void, ms: number) => () => void;

const plainEvery: Every = (fn, ms) => {
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
};

export type SharedPoll<T> = { current: () => T; subscribe: (f: (v: T) => void) => () => void };

export function sharedPoll<T>(load: () => Promise<T>, ms: number, init: T, every: Every = plainEvery): SharedPoll<T> {
  let now = init;
  let key = JSON.stringify(init);
  let stop: (() => void) | null = null;
  let busy = false;
  const subs = new Set<(v: T) => void>();
  const tick = () => {
    if (busy) return; // 앞 물음이 안 끝났으면 겹쳐 묻지 않는다
    busy = true;
    load().then(
      (v) => {
        busy = false;
        const k = JSON.stringify(v);
        if (k === key) return;
        now = v;
        key = k;
        subs.forEach((f) => f(v));
      },
      () => { busy = false; },
    );
  };
  return {
    current: () => now,
    subscribe(f) {
      subs.add(f);
      if (!stop) {
        tick();
        stop = every(tick, ms);
      }
      return () => {
        subs.delete(f);
        if (!subs.size && stop) {
          stop();
          stop = null;
        }
      };
    },
  };
}
