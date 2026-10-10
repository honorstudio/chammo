/** items 를 n 개까지만 같이 돌린다 — 하나가 끝나면 다음 것. stopped() 가 참이면 새로 시작하지 않는다. 실패한 것은 건너뛴다(부르는 쪽이 따로 잡는다) */
export async function runPool<T>(items: readonly T[], n: number, f: (x: T) => Promise<unknown>, stopped: () => boolean = () => false): Promise<void> {
  let i = 0;
  const lane = async () => {
    while (i < items.length && !stopped()) {
      const x = items[i++]!;
      await f(x).catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, lane));
}
