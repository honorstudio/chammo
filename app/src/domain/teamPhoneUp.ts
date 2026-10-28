// 폰 → 팀 보관함 올리기 조각 — 폰 서버 몸통은 한 번에 PHONE_PART 까지라 파일을 조각으로 차례로 보낸다(맥 Rust team_phone_up 과 같은 크기).
// 맥이 다 모으면 데스크톱 끌어 넣기와 같은 길로 암호화해 올린다

export const PHONE_PART = 4 * 1024 * 1024;
/** 폰에서 올리는 파일 하나 상한 — 넘으면 '데스크톱에서 올려 줘' 한 줄 */
export const PHONE_MAX = 1024 * 1024 * 1024;

/** 조각 수 — 빈 파일도 한 조각, 상한을 넘으면 null */
export function partsOf(size: number): number | null {
  if (size > PHONE_MAX) return null;
  return Math.max(1, Math.ceil(size / PHONE_PART));
}

/** 올림 id — 맥이 받는 모양(영문 소문자·숫자·-)만 */
export const upId = () => `up-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
