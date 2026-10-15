// 입력칸 뒤판(.chat-backdrop) — textarea 는 글자를 따로 꾸밀 수 없어서 같은 글을 뒤에 깔아 @img1·@file1 자리만 칠한다.
// 칠한 자리가 글자와 맞으려면 줄바꿈이 똑같아야 해서, CSS 를 손으로 맞추지 않고 입력칸의 계산값을 그대로 옮긴다(2026-10-11 185·186.png)
const COPY = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-kerning', 'font-feature-settings', 'font-variant-ligatures', 'letter-spacing', 'word-spacing', 'line-height', 'text-indent', 'text-transform', 'tab-size',
  'white-space', 'overflow-wrap', 'word-break', 'box-sizing', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'];

/** get = 입력칸 getComputedStyle 값, box = 입력칸 폭(offsetWidth − clientWidth − 테두리 = 스크롤바) */
export function backdropStyle(get: (prop: string) => string, box: { offsetWidth: number; clientWidth: number }): Record<string, string> {
  const s: Record<string, string> = {};
  for (const k of COPY) { const v = get(k); if (v) s[k] = v; }
  const bar = box.offsetWidth - box.clientWidth - (parseFloat(get('border-left-width')) || 0) - (parseFloat(get('border-right-width')) || 0);
  if (bar > 0) s['padding-right'] = `${(parseFloat(get('padding-right')) || 0) + bar}px`;
  return s;
}
