// 새 버전 확인을 언제 칠까 — 판단만 여기(부르는 곳은 ui/useUpdates).
// 2026-10-24 PM PC 제보: 켤 때 한 번 + 6시간 타이머뿐이라 켜 둔 앱은 새 판을 몇 시간(잠자기를 끼면 며칠) 놓쳤고,
// 다시 켜도(맥 독·윈도우 single-instance) 떠 있던 창만 앞으로 와서 확인을 안 쳤다 — 앱을 다 끄고 켜야 떴다
export type CheckWhy = 'start' | 'tick' | 'shown';

/** 켜져 있으면 이만큼마다 — 벽시계로 잰다 */
export const EVERY_MS = 2 * 60 * 60 * 1000;
/** 짧은 틱 — 타이머는 잠든 동안 안 흘러서(맥·윈도우 둘 다) 긴 타이머 하나로는 잠자기를 끼면 며칠 밀린다. 깨어난 뒤 이 안에 친다 */
export const TICK_MS = 10 * 60 * 1000;
/** 창이 다시 앞에 와서 칠 때 앞 확인과의 최소 간격 — GitHub 비로그인 한도(IP 당 시간 60번)를 사무실 기기들이 나눠 쓴다 */
export const SHOWN_GAP_MS = 15 * 60 * 1000;

/** 지금 칠까. 켤 때는 늘, 틱은 주기가 찼을 때, 앞에 왔을 땐 간격이 찼을 때. 시계가 뒤로 가면(시간 맞춤) 친다 */
export function dueCheck(last: number | null, now: number, why: CheckWhy): boolean {
  if (why === 'start' || last === null || now < last) return true;
  return now - last >= (why === 'tick' ? EVERY_MS : SHOWN_GAP_MS);
}

/** 확인을 부를 때마다 판단을 거친다 — 친 때를 기억해 틱·앞에 옴이 서로의 간격으로 센다 */
export function updateChecker(check: () => void, now: () => number) {
  let last: number | null = null;
  const run = (why: CheckWhy) => {
    const t = now();
    if (!dueCheck(last, t, why)) return false;
    last = t;
    check();
    return true;
  };
  return { start: () => run('start'), tick: () => run('tick'), shown: () => run('shown') };
}
