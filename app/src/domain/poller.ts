// 받기 고리 — everyMs 마다 read → apply. 폰을 백그라운드에서 돌아오게 하면(알림 누르기 포함) 대화가 옛 상태로 한참 멈춰 있었다(2026-10-04 사용자 실기기).
// 원인 둘(시뮬레이터 재현): ① 돌아와도 다음 차례(시트 살짝이면 10초)를 기다렸다 ② 백그라운드 들어갈 때 날던 요청이 매달리면 고리 전체가 멈췄다(50초+).
// 그래서 kick = 지금 요청을 끊고(AbortSignal) 바로 다시, 끊긴 요청이 뒤늦게 와도 버린다(세대 번호). fresh = 시작·kick 뒤 첫 답이 왔나
/** kick(quiet) — quiet 면 '최신 아님' 표시 없이(주기만 바뀔 때) */
export type Poller = { start(): void; stop(): void; kick(quiet?: boolean): void };

/** 앱이 다시 보일 때(백그라운드에서 돌아옴·알림 누름·다시 연결) 받기 고리를 깨우는 창 사건 — ui/mobile/resume 이 쏜다 */
export const RESUME_EVENT = 'app-resume';

/** 이만큼 안에 시작한 요청은 kick 이 안 끊는다(돌아온 뒤 보낸 것 — 소켓이 살아 있다) */
const FRESH_REQ_MS = 1500;
/** 돌아왔을 때 대화·세션 말고 나머지 받기는 이만큼 뒤에 — 동시 연결(6개)에서 대화가 줄 서지 않게 */
export const RESUME_LATER_MS = 1200;

export function makePoller<T>(o: {
  read: (signal: AbortSignal) => Promise<T>;
  apply: (v: T) => void;
  everyMs: () => number;
  onFresh?: (fresh: boolean) => void;
}): Poller {
  let gen = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ctl: AbortController | null = null;
  let running = false;
  let startedAt = 0;
  let inflight = false;
  let again = false;
  const tick = async () => {
    const my = ++gen;
    ctl?.abort();
    const c = new AbortController();
    ctl = c;
    startedAt = Date.now();
    inflight = true;
    again = false;
    try {
      const v = await o.read(c.signal);
      if (my !== gen || !running) return; // 끊긴 요청의 늦은 답
      inflight = false;
      o.apply(v);
      if (!again) o.onFresh?.(true);
    } catch {
      if (my !== gen || !running) return;
      inflight = false;
      // 다음 차례에
    }
    if (my === gen && running) timer = setTimeout(() => void tick(), again ? 0 : o.everyMs());
  };
  return {
    start() {
      running = true;
      o.onFresh?.(false);
      void tick();
    },
    stop() {
      running = false;
      gen++;
      ctl?.abort();
      if (timer !== undefined) clearTimeout(timer);
    },
    kick(quiet = false) {
      if (!running) return;
      if (!quiet) o.onFresh?.(false);
      // 막 시작한 요청(돌아온 뒤 보낸 것)은 끊지 않고 끝나면 바로 한 번 더 — 신호가 250ms 차로 두 번 오면 첫 요청을 끊어 늦어졌다
      if (inflight && Date.now() - startedAt < FRESH_REQ_MS) { again = true; return; }
      if (timer !== undefined) clearTimeout(timer);
      void tick();
    },
  };
}
