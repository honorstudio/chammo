// 폰 첫 화면 — 처음 열 때(콜드 스타트) 칸들이 300ms 씩 세 번에 나눠 '뚝뚝' 나왔다(LTE 흉내 실측: 머리 660·할 일·파일 980·썸네일 1300ms).
// 스플래시(모찌) 동안 첫 화면에 쓸 것을 미리 받아 기억에 넣고, 다 되거나 마감이면 한 번에 보인다(2026-10-03 사용자). 계산만
import { fileKind } from './phoneFile';
import { dashFiles } from './dashboard';

export const SPLASH_MAX = 2500;
/** 늦게 준비됐을 때(느린 망 첫 켜기) 미리 받기를 더 기다리는 시간 — 준비되자마자 걷으면 칸이 '뚝뚝' 다시 나온다 */
export const PRELOAD_GRACE = 800;
/** 첫 받기(맥 정보·세션) 시간 제한 — 맥이 꺼져 요청이 매달리면 모찌만 20초 보이지 않게 이만큼에 '못 닿음'으로(다시 시도는 그대로 돈다) */
export const BOOT_LIMIT_MS = 10_000;

/** 첫 받기 상태 — wait = 맥 정보·세션을 아직 못 받음, ready = 받음, nokey = 짝짓기 안 됨, error = 못 닿음 */
export type BootBase = 'wait' | 'ready' | 'nokey' | 'error';

/** 미리 받기 마감 — 일찍 준비됐으면 연 지 2.5초, 늦게 준비됐으면 준비 + 0.8초(ms, 페이지 연 때부터) */
export const splashDeadline = (readyAt: number) => Math.max(SPLASH_MAX, readyAt + PRELOAD_GRACE);

/** 스플래시(모찌)를 걷을까 — 받기 전엔 계속(2.5초에 걷었다가 '불러오는 중…' 글자 화면이 떴다, 2026-10-04 사용자 LTE).
 *  짝짓기·못 닿음은 바로, 받은 뒤엔 미리 받기가 끝나거나 마감에. now·readyAt = 페이지 연 때부터 ms */
export function splashDone(o: { base: BootBase; preloaded: boolean; now: number; readyAt: number }): boolean {
  if (o.base === 'nokey' || o.base === 'error') return true;
  if (o.base === 'wait') return false;
  return o.preloaded || o.now >= splashDeadline(o.readyAt);
}

/** 기억해 둔 맥 정보 — 다음 켜기에 이걸로 먼저 그리고 새로 받아 바꾼다. 모양이 다르면 버린다(받을 때까지 기다림) */
export type BootEnv = { assistantName: string; language: string; devRoot: string; extraProjects: string[]; hqDir: string };
export const ENV_KEY = 'm.env';
export function envFromCache(raw: string | null): BootEnv | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<BootEnv> | null;
    if (!v || typeof v !== 'object') return null;
    const str = (x: unknown): x is string => typeof x === 'string';
    if (!str(v.assistantName) || !str(v.language) || !str(v.devRoot) || !str(v.hqDir) || !v.hqDir) return null;
    if (!Array.isArray(v.extraProjects) || !v.extraProjects.every(str)) return null;
    return { assistantName: v.assistantName, language: v.language, devRoot: v.devRoot, extraProjects: v.extraProjects, hqDir: v.hqDir };
  } catch {
    return null;
  }
}

/** 대시보드 첫 카드들의 썸네일 — 화면과 같은 순서(dashFiles: 보낸 시각 최근 순) 앞 n 개 중 그림·첫 장(QuickLook)이 있는 것. 첫 카드는 크게(720).
 *  기록 줄 순서로 고르면 화면 카드와 어긋나 썸네일을 또 받았다(실측) */
export function firstThumbs(showLog: string, orchId: string, n = 4): { path: string; size: 360 | 720 }[] {
  return dashFiles(showLog, orchId, [], []).slice(0, n)
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => ['image', 'pdf', 'html', 'office', 'video'].includes(fileKind(f.path)))
    .map(({ f, i }) => ({ path: f.path, size: i === 0 ? 720 : 360 }));
}
