// 폰 썸네일 줄 — 대화를 열면 파일마다 요청이 한꺼번에 나가 중계 일꾼(phone_relay MAX_WORKERS 8)을 넘긴 것이 503 busy 로 끝났고,
// 받기 고리까지 같이 밀렸다(11-06 실측: 대화를 열 때마다 썸네일이 꼭 7장씩만 찍혔다). 동시에 몇 개만 보내고, 나중에 부른 것(방금 화면에 들어온 칸)부터.
// 일꾼이 다 찼다는 답(busy)은 잠깐 뒤 다시 — 그 밖의 실패는 그대로 돌려준다(그릴 수 없는 파일을 또 안 묻게)

export const BUSY_DELAYS_MS = [800, 1600, 3200, 6400, 12800] as const;

type Opts = { delays?: readonly number[]; sleep?: (ms: number) => Promise<void> };
export type ThumbLine = <T>(job: () => Promise<T>) => Promise<T>;

export function thumbLine(limit: number, o: Opts = {}): ThumbLine {
  const delays = o.delays ?? BUSY_DELAYS_MS;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const waiting: (() => void)[] = [];
  let going = 0;
  const pump = () => {
    while (going < limit && waiting.length) {
      going++;
      waiting.pop()!();
    }
  };
  return <T,>(job: () => Promise<T>) => new Promise<T>((ok, no) => {
    const go = (tries: number) => {
      new Promise<T>((r) => r(job())).then(
        (v) => { going--; ok(v); pump(); },
        (e: unknown) => {
          going--;
          pump();
          if (!(e instanceof Error && e.message === 'busy') || tries >= delays.length) { no(e); return; }
          // 기다리는 동안은 자리를 안 쥔다 — 다시 줄 맨 앞(이미 화면에 있던 칸)으로
          void sleep(delays[tries]!).then(() => { waiting.push(() => go(tries + 1)); pump(); });
        },
      );
    };
    waiting.push(() => go(0));
    pump();
  });
}
