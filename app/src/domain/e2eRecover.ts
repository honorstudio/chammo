// 계정 되찾기 갈래 ②(chammo-relay ADR 0007 R9) — 화면 글자 셈. 시안 docs/design-drafts/e2e-recover/v1.html TO-BE ②

/** 요청 코드 8자리를 4·4 로 띄워 읽기 쉽게(K7QM 2XPA) — 모양이 틀리면 빈 글 */
export function fmtRecoverCode(c: string): string {
  return /^[A-HJ-NP-Z2-9]{8}$/.test(c) ? `${c.slice(0, 4)} ${c.slice(4)}` : '';
}

/** 다시 시작까지 남은 시간(올림, 시간). 지났으면 0 */
export function hoursLeft(readyAt: number, now: number): number {
  return Math.max(0, Math.ceil((readyAt - now) / 3_600_000));
}
