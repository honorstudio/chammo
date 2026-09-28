// 달 모양 — 별알 숨은 진화(월식토끼: 보름달 밤에 활동). 평균 삭망월로 셈해서 실제와 반나절쯤 어긋날 수 있다(게임엔 충분)
const SYNODIC = 29.530588853 * 86_400_000;
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // 기준 삭

/** 0 = 삭(새달), 0.5 = 보름 */
export function moonPhase(t: number): number {
  const p = ((t - NEW_MOON) % SYNODIC) / SYNODIC;
  return p < 0 ? p + 1 : p;
}

/** 보름 앞뒤 하루 안이고, 밤(18시~새벽 6시)이다 */
export function isFullMoonNight(t: number): boolean {
  const h = new Date(t).getHours();
  return (h >= 18 || h < 6) && Math.abs(moonPhase(t) - 0.5) <= 86_400_000 / SYNODIC;
}
