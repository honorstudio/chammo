// 터미널 글꼴 — 아이콘(Nerd Font 글리프: 상태줄 파워라인 등)은 맥에 깔린 Meslo Nerd Font, 한글은 번들한 Chammo Hangul(D2Coding 한글 수정판), 나머지는 Menlo.
// 윈도우는 Menlo 가 없어 Cascadia Mono·Consolas — 없으면 한글 윈도우 기본 고정폭(굴림체)으로 넘어가 줄이 겹치고 \ 가 ₩ 로 보였다(윈도우판)

/** 번들 한글 글꼴의 한글 폭 — D2Coding 한글은 1em(라틴 0.5em 짝) */
const HANGUL_EM = 1;
export const HANGUL_RANGE = 'U+1100-11FF, U+3130-318F, U+AC00-D7A3, U+3000-303F, U+FF00-FFEF';
/** 윈도우용 — 같은 한글 글꼴을 칸 폭에 맞게 키운 것(main.tsx 가 재서 만든다) */
export const HANGUL_FIT = 'Chammo Hangul Fit';
/** 한글을 뺀 라틴 글꼴 줄 — 칸 폭(W 한 글자)을 잴 때 */
export const LATIN_STACK = '"MesloLGSDZ Nerd Font Mono", "MesloLGS NF", "MesloLGLDZ Nerd Font Mono", Menlo, "Cascadia Mono", Consolas, monospace';

const MAC = '"MesloLGSDZ Nerd Font Mono", "MesloLGS NF", "MesloLGLDZ Nerd Font Mono", "Chammo Hangul", Menlo, "Cascadia Mono", Consolas, "Apple SD Gothic Neo", monospace';

/** 윈도우는 한글을 칸에 맞춘 글꼴로 — Cascadia Mono 칸(0.586em)이 D2Coding 라틴(0.5em)보다 넓어 한글 두 칸에 2px 씩 비어
 *  '프 로 젝 트'처럼 벌어졌다(2026-10-22 윈도우 QA 31). 맥은 그대로 */
export const termFont = (win: boolean) => (win ? MAC.replace('"Chammo Hangul"', `"${HANGUL_FIT}"`) : MAC);

/** 한글 한 글자가 두 칸을 채우는 size-adjust(%) — latinW = 라틴 한 칸 폭, px = 그때 글자 크기. 이상한 값이면 100 */
export function hangulFit(latinW: number, px: number): number {
  const r = (2 * latinW) / (px * HANGUL_EM);
  return Number.isFinite(r) && r >= 1 && r <= 1.4 ? Math.round(r * 1000) / 10 : 100;
}
