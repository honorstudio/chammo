// 경로 모양 맞추기 — 앱 안의 비교(startsWith(`${root}/`)·split('/'))는 / 기준이다.
// 윈도우 경로는 들어오는 입구(app_env·claude agents)에서 C:/… 로 바꿔 둔다. 윈도우도 / 경로를 그대로 받는다

/** 윈도우 경로(C:\… · C:/…)만 / 로, 드라이브 글자는 대문자로. 맥 경로는 손대지 않는다 */
export function fwd(p: string): string {
  if (!/^[A-Za-z]:[\\/]/.test(p)) return p;
  return p[0]!.toUpperCase() + p.slice(1).replace(/\\/g, '/');
}

/** 경로 비교 열쇠 — fwd + 끝 / 빼기, 윈도우 드라이브 경로면 소문자(윈도우는 대소문자를 안 가린다). 맥 경로는 대소문자 그대로 */
export function pathKey(p: string): string {
  const f = fwd(p).replace(/\/+$/, '');
  return /^[A-Za-z]:(\/|$)/.test(f) ? f.toLowerCase() : f;
}

/** 같은 폴더인가 — 윈도우는 /api/env 의 C:\Users\me/.chammo/hq 와 agents 의 C:/Users/me/.chammo/hq 가 같다(2026-10-05 폰 "떠 있는 참모가 없어요") */
export const samePath = (a: string, b: string): boolean => pathKey(a) === pathKey(b);

/** 맥 정보(폰 /api/env·기억해 둔 것)의 경로를 앱과 같은 모양으로 — 데스크톱은 data/tauri.ts getAppEnv 가 같은 일을 한다 */
export const fwdEnv = <T extends { devRoot: string; extraProjects: string[]; hqDir: string }>(e: T): T =>
  ({ ...e, devRoot: fwd(e.devRoot), extraProjects: e.extraProjects.map(fwd), hqDir: fwd(e.hqDir) });
