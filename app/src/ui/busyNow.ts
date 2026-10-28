// 맥이 바쁜가(domain/busyGate) — 앱이 이미 재는 부하 주기(ui/useLoad)가 넣는다, 여기서 새로 재지 않는다(ui/calm 과 같은 결).
// 터미널 칸들이 attach 차례(turns)를 같이 쓴다
import { useEffect, useState } from 'react';
import { attachTurns, busyOf, type Busy } from '../domain/busyGate';

type Sys = { load1: number; cores: number; bootAt?: number | null };
let sys: Sys | null = null;
const started = Date.now();
/** 앱을 켜고 첫 부하를 받기 전 — 재부팅 직후 앱이 켜지면 첫 측정(ps)도 몇 초 걸린다. 그동안 칸들이 한꺼번에 붙지 않게 attach 차례만 하나씩
 *  (화면 문구·목록 간격·다시 켜기는 잰 값으로만 — 한가한 맥에서 켤 때마다 '맥이 바빠서'가 떴다, 리뷰) */
const UNMEASURED = 15_000;
let last: Busy = 'ok';
const subs = new Set<(b: Busy) => void>();

/** 잰 부하로 본 바쁨 — 아직 못 쟀으면 ok */
export function busyNow(now = Date.now()): Busy {
  return sys ? busyOf(sys, now) : 'ok';
}

/** 터미널 칸 attach 차례 — 바쁘면(못 쟀으면 앱을 켜고 15초까지도) 하나씩 */
export const turns = attachTurns(() => (sys ? busyNow() : Date.now() - started < UNMEASURED ? 'busy' : 'ok'));

/** 부하를 잴 때마다 */
export function feedBusy(s: Sys | null) {
  if (s) sys = s;
  const b = busyNow();
  turns.poke();
  if (b === last) return;
  last = b;
  subs.forEach((f) => f(b));
}

export function useBusy(): Busy {
  const [b, setB] = useState<Busy>(() => busyNow());
  useEffect(() => {
    subs.add(setB);
    setB(busyNow());
    return () => { subs.delete(setB); };
  }, []);
  return b;
}
