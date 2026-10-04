// 참모 색 → 채팅 칸 CSS 변수 세트. 탭을 바꾸면 그 참모 색으로 바뀌어 "다른 참모 방에 왔다"는 티가 난다(2026-10-02 사용자).
// 대비는 WCAG 4.5:1 — 밝은 참모 색(노랑)은 위 글자를 진하게, 바탕 위 글자는 테마마다 진하게·밝게 조정
const HEX = /^#[0-9a-fA-F]{6}$/;
const INK_LIGHT = '#ffffff';
const SURFACE = { light: '#ffffff', dark: '#1b1b1f' };

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c: number[]) => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

function luminance(h: string): number {
  const [r, g, b] = rgb(h).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/** a 를 t 만큼 + b 를 (1-t) — CSS color-mix(in srgb, a t%, b) 와 같다 */
export function mix(a: string, b: string, t: number): string {
  const [p, q] = [rgb(a), rgb(b)];
  return hex(p.map((v, i) => v * t + q[i]! * (1 - t)));
}

/** 바탕 위에서 4.5:1 이 될 때까지 검정(밝은 바탕)·흰색(어두운 바탕) 쪽으로 조금씩 섞는다 */
function readableOn(color: string, bg: string): string {
  const toward = luminance(bg) > 0.5 ? '#000000' : '#ffffff';
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = mix(toward, color, t);
    if (contrast(c, bg) >= 4.5) return c;
  }
  return toward;
}

export type OrchVars = Record<'--orch' | '--orch-solid' | '--orch-ink' | '--orch-text-light' | '--orch-text-dark', string>;

/** 꽉 찬 면(보내기 버튼·고른 탭 알약) — 위 글자·프사 몸은 늘 흰색. 4.5:1 이 안 되면(초록·주황·노랑·파랑) 면을 조금씩 진하게.
 *  진한 글자로 맞추던 때는 초록 알약에 어두운 글자·같은 초록 프사가 묻혔다(2026-10-02 사용자) */
function solidOf(c: string): { solid: string; ink: string } {
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const s = mix('#000000', c, t);
    if (contrast(INK_LIGHT, s) >= 4.5) return { solid: s, ink: INK_LIGHT };
  }
  return { solid: '#000000', ink: INK_LIGHT };
}

export function orchVars(color: string): OrchVars | Record<string, never> {
  if (!HEX.test(color)) return {};
  const c = color.toLowerCase();
  const { solid, ink } = solidOf(c);
  return {
    '--orch': c,
    '--orch-solid': solid,
    '--orch-ink': ink,
    '--orch-text-light': readableOn(c, SURFACE.light),
    '--orch-text-dark': readableOn(c, SURFACE.dark),
  };
}
