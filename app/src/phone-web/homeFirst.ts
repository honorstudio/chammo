// 아이폰은 사파리와 홈 화면 앱이 쿠키·저장·열쇠를 따로 쓴다 — 사파리에서 로그인하고 홈 화면에 추가하면 홈 화면 앱은 로그인 전이고,
// 계정엔 사파리 기기가 따로 남는다(2026-10-24 사용자 실폰). 그래서 아이폰 사파리에선 로그인 대신 '홈 화면에 먼저 추가'.
// 안드로이드는 브라우저와 설치 앱이 저장을 나눠 쓰지만, 탭에서 로그인하면 그대로 웹으로 쓰게 된다(2026-11-18 사용자 "그냥 설치해서(pwa) 사용하도록") — 크롬 탭이면 설치부터.
// 데스크톱은 여기서

/** 아이폰·아이패드(데스크톱 UA 로 오는 아이패드는 손가락 수로) — iOS 의 크롬·파이어폭스도 같은 웹킷·같은 규칙 */
export function isIos(ua: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

/** 안드로이드(폰·태블릿) — iPadOS 는 맥 UA 라 여기 안 걸린다(isIos 가 손가락 수로 잡는다) */
export const isAndroid = (ua: string): boolean => /Android/i.test(ua);

export function loginPlace(o: { ios: boolean; android?: boolean; standalone: boolean }): 'here' | 'home-first' | 'install-first' {
  if (o.standalone) return 'here';
  if (o.ios) return 'home-first';
  return o.android ? 'install-first' : 'here';
}

/** 아이패드 — iPadOS 사파리는 맥 UA 라 손가락 수로(진짜 맥은 0) */
const isIpad = (ua: string, maxTouchPoints: number) => /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);

/** 계정에 올리는 기기 이름(2026-11-18 — 아이패드가 'Android'로 올라갔다). 안드로이드 태블릿은 UA 에 Mobile 이 없다 */
export function phoneName(ua: string, maxTouchPoints: number): string {
  if (isIpad(ua, maxTouchPoints)) return 'iPad';
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (isAndroid(ua)) return /Mobile/.test(ua) ? 'Android' : 'Android Tablet';
  return 'Browser';
}

/** 컴퓨터(Rust mobile_pair::device_name)가 기기 이름을 짓는 UA — 맥 UA 아이패드엔 iPad 를 붙인다(안 그러면 Mac) */
export const deviceUa = (ua: string, maxTouchPoints: number): string => (isIpad(ua, maxTouchPoints) && !/iPad/.test(ua) ? `${ua} iPad` : ua);
