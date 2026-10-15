// 보임에 따라 늦추는 주기 실행기(판단만 — 창·타이머는 넘겨받는다). 앱은 ui/poll every 로 쓴다
import { dueOnShow, pollDelay } from './attention';
import type { Every } from './sharedPoll';

export type Vis = { isShown: () => boolean; onShown: (f: (shown: boolean) => void) => () => void };

/** 안 보이면 5배 느리게, 다시 보이면 원래 주기가 지났을 때 바로 한 번. 안 보이게 되면 지난번에서 5배 주기로 다시 건다 */
export function makeEvery(vis: Vis, now: () => number = Date.now): Every {
  return (fn, ms) => {
    let last = now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const arm = (wait: number) => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(run, wait);
    };
    const run = () => {
      last = now();
      // 던져도 다음 차례는 건다 — setInterval 처럼(한 번 throw 로 폴링이 영영 멈추지 않게)
      try { fn(); } finally { arm(pollDelay(ms, vis.isShown())); }
    };
    const off = vis.onShown((v) => arm(v ? dueOnShow(ms, last, now()) : Math.max(0, last + pollDelay(ms, false) - now())));
    arm(pollDelay(ms, vis.isShown()));
    return () => {
      stopped = true;
      clearTimeout(timer);
      off();
    };
  };
}
