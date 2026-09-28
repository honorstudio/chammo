import type { ITheme } from '@xterm/xterm';

// 터미널 색도 앱 모드를 따른다. 라이트에선 Claude Code가 강조로 쓰는 white/brightWhite 를 어둡게 바꿔
// 흰 바탕에 글자가 사라지지 않게 한다
export const DARK: ITheme = {
  background: '#1b1b1f', foreground: '#e7e7ea', cursor: '#e7e7ea', selectionBackground: '#3a3f4b',
};

export const LIGHT: ITheme = {
  background: '#ffffff', foreground: '#1d1d20', cursor: '#1d1d20', cursorAccent: '#ffffff', selectionBackground: '#cfdcf5',
  black: '#1d1d20', red: '#c4302b', green: '#1f8a4c', yellow: '#946300', blue: '#2456c7', magenta: '#9b3fb5', cyan: '#177585', white: '#5f5f67',
  brightBlack: '#6e6e76', brightRed: '#d9463f', brightGreen: '#23a35a', brightYellow: '#a87200', brightBlue: '#2f6be0', brightMagenta: '#b04fcb', brightCyan: '#1a8a9c', brightWhite: '#2e2e33',
};

export const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');
export const currentTheme = () => (darkQuery().matches ? DARK : LIGHT);

/**
 * 최소 대비(xterm minimumContrastRatio). Claude Code 테마가 dark 라서 흰·연회색을 **트루컬러로 직접** 보낸다 —
 * 위 팔레트 바꿔치기는 기본 16색에만 먹혀서 라이트 모드 흰 바탕에선 글자가 사라졌다(2026-09-27 사용자).
 * 라이트는 4.5:1 보다 흐린 글자를 자동으로 진하게, 다크는 원래 색 그대로
 */
export const contrastFor = (dark: boolean) => (dark ? 1 : 4.5);
export const currentContrast = () => contrastFor(darkQuery().matches);
