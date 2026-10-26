// 아이폰은 사파리와 홈 화면 앱이 쿠키·저장·열쇠를 따로 쓴다 — 사파리에서 로그인하고 홈 화면에 추가하면 홈 화면 앱은 로그인 전이고,
// 계정엔 사파리 기기가 따로 남는다(2026-10-24 사용자 실폰). 그래서 아이폰 사파리에선 로그인 대신 '홈 화면에 먼저 추가'.
// 안드로이드·데스크톱은 브라우저와 설치 앱이 저장을 나눠 써서 어디서 로그인해도 된다

/** 아이폰·아이패드(데스크톱 UA 로 오는 아이패드는 손가락 수로) — iOS 의 크롬·파이어폭스도 같은 웹킷·같은 규칙 */
export function isIos(ua: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

export function loginPlace(o: { ios: boolean; standalone: boolean }): 'here' | 'home-first' {
  return o.ios && !o.standalone ? 'home-first' : 'here';
}
