// 과식 기준을 내 평소에 맞춘다 — 하루 커밋 80개를 넘는 사람한테 "한 시간 10개 = 과식"은 매일 걸린다(2026-09-27 실측).
// 평균으로 하면 커밋한 시간의 40%가 과식이라, 평소 바쁜 시간보다도 더 몰아친 시간(상위 10%)만 과식으로 친다
const HOUR = 3_600_000;
const WINDOW = 28 * 24 * HOUR;
export const MIN_OVERFEED = 10;

/** dayStart 직전 28일 동안 커밋이 있었던 시간들의 시간당 커밋 수 중 상위 10% 선. 최소 10 */
export function overfeedLine(commitTimes: number[], dayStart: number): number {
  const perHour = new Map<number, number>();
  for (const t of commitTimes) {
    if (t < dayStart - WINDOW || t >= dayStart) continue;
    const h = Math.floor(t / HOUR);
    perHour.set(h, (perHour.get(h) ?? 0) + 1);
  }
  const v = [...perHour.values()].sort((a, b) => a - b);
  return Math.max(MIN_OVERFEED, v[Math.floor(v.length * 0.9)] ?? 0);
}
