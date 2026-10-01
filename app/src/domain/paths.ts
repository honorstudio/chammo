// 경로 모양 맞추기 — 앱 안의 비교(startsWith(`${root}/`)·split('/'))는 / 기준이다.
// 윈도우 경로는 들어오는 입구(app_env·claude agents)에서 C:/… 로 바꿔 둔다. 윈도우도 / 경로를 그대로 받는다

/** 윈도우 경로(C:\… · C:/…)만 / 로, 드라이브 글자는 대문자로. 맥 경로는 손대지 않는다 */
export function fwd(p: string): string {
  if (!/^[A-Za-z]:[\\/]/.test(p)) return p;
  return p[0]!.toUpperCase() + p.slice(1).replace(/\\/g, '/');
}
