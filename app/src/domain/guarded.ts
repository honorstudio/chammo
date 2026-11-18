/** 한 번에 하나만 — 도는 동안 또 부르면 안 돌리고 false. 상태(useState)는 다음 그리기까지 옛 값이라 같은 순간 두 번(Enter·단추)을 못 막는다 — ref 로.
 *  11-17 스페이스 '고친 것' 486자가 1.3초 사이 두 번 갔다 */
export async function guarded(flag: { current: boolean }, run: () => Promise<void>): Promise<boolean> {
  if (flag.current) return false;
  flag.current = true;
  try {
    await run();
    return true;
  } finally {
    flag.current = false;
  }
}
