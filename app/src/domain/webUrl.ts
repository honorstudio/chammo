// 주소 미리보기 — scripts/show 로 온 http(s) 주소, 주소 줄에 친 것(2026-10-02 사용자 "인앱에서 띄워 주고 크롬에서 보기").
// 앱 명령(Rust webpage::parse_web_url)이 같은 규칙으로 한 번 더 본다 — 여기는 화면용

/** http(s) 주소인가 — 스킴 뒤 바로 호스트, 빈칸·제어 글자 없이 */
export function isWebUrl(s: string): boolean {
  if (!/^https?:\/\/[^/\\?#\s]/i.test(s) || /[\s\x00-\x1f\x7f]/.test(s)) return false;
  try {
    return !!new URL(s).hostname;
  } catch {
    return false;
  }
}

const LOCAL = /^(localhost|[\w-]+\.localhost|127(\.\d+){3}|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}|\[[0-9a-f:]+\])(:\d+)?([/?#]|$)/i;

/** 주소 줄에 친 것 → 열 주소. 스킴이 없으면 로컬·사설 IP 는 http, 그 밖은 https. 주소가 아니면 null */
export function addressToUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^/:]+:\d/.test(s)) return isWebUrl(s) ? s : null; // 스킴이 있다(localhost:3000 은 스킴 아님)
  if (!/^[^\s/?#]+\.[^\s/?#]|^localhost|^\[/i.test(s)) return null; // 점이 없는 말은 주소가 아니다
  const url = `${LOCAL.test(s) ? 'http' : 'https'}://${s}`;
  return isWebUrl(url) ? url : null;
}

/** 막대·카드 이름 — 호스트(+포트) + 경로(끝 / 없이) */
export function webTitle(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return url;
  }
}
