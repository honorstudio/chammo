// 설정 > Chammo 계정(서버 ADR 0004) — 화면 판단. 지우기는 되돌릴 수 없어서 계정 이메일을 그대로 쳐야 한다(Rust team_account::delete_account 와 같은 규칙)

/** 공개판 기본 중계(Rust team_relay::DEFAULT_SERVER 와 같은 값) — 처음 로그인하는 기기의 입력칸에 미리 들어간다 */
export const DEFAULT_RELAY = 'https://relay.chammo.app';
/** 기본 중계(relay.chammo.app) 처리방침·약관 — README 개인정보 칸과 같은 주소 */
export const PRIVACY_URL = 'https://chammo.app/privacy';
export const TERMS_URL = 'https://chammo.app/terms';
export type TeamAccount = { email: string; name: string };
export type TeamDevice = { id: string; name: string; current: boolean };

export function deleteConfirmOk(a: TeamAccount, typed: string): boolean {
  const want = a.email || a.name;
  return !!want && typed === want;
}

/** 이 기기를 맨 위에. 이 기기는 끊기 대신 로그아웃으로 */
export function accountRows(list: TeamDevice[]): (TeamDevice & { revoke: boolean })[] {
  return [...list].sort((x, y) => Number(y.current) - Number(x.current)).map((d) => ({ ...d, revoke: !d.current }));
}
