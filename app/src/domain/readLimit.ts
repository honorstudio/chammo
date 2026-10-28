// 받기 시간 한도(data/web.ts timed) — 매달린 요청 하나가 받기 고리를 통째로 세우지 않게(2026-10-04) 20초에 끊되,
// 중계 길에선 큰 답(대화 기록·화면 파일) 뒤에 줄 서 있을 수 있다. 터널이 방금까지 받고 있었으면 느리지만 오는 중이라 더 기다린다
// (2026-10-27 느린 셀룰러: 오는 중인 답을 20초에 끊고 다시 불러 같은 MB 를 또 받았다 — 'aborted'). 먹통 소켓은 터널이 따로 끊는다(hub STALL)
export const READ_LIMIT_MS = 20_000;
export const READ_MAX_MS = 60_000;
/** 이만큼 안에 뭐라도 받았으면 '오는 중' — 그만큼 뒤에 다시 본다 */
export const BUSY_MS = 5_000;

/** elapsed = 요청 뒤 지난 시간, sinceRx = 터널이 마지막으로 받은 뒤 지난 시간. 'abort' 또는 다음에 볼 때까지 ms */
export function readCheck({ elapsed, sinceRx, relay }: { elapsed: number; sinceRx: number; relay: boolean }): 'abort' | number {
  if (!relay || elapsed >= READ_MAX_MS || sinceRx >= BUSY_MS) return 'abort';
  return Math.min(BUSY_MS, READ_MAX_MS - elapsed);
}
