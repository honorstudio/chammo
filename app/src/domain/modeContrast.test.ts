import { describe, expect, it } from 'vitest';
import appCss from '../ui/styles.css?raw';
import phoneCss from '../ui/mobile/mobile.css?raw';
import modeCss from '../ui/mode/mode.css?raw';
import modeTreeTsx from '../ui/mode/ModeTree.tsx?raw';
import { colorOf, normalize } from './modeTree';
import { svgDoc } from '../../hq-template/.claude/skills/hq-mode-kit/kit-svg';

// 모드 안 흐린 글(dimColor·inactive·subtle·gray, 키트 Svg --dim)이 WCAG AA 본문 4.5:1 을 넘는지 — 라이트·다크 둘 다(#4).
// 흐린 글은 12px 에 주로 쓰여 큰 글 기준(3:1)이 아니다. 모드 칸 바탕은 --surface·--surface-2·--panel·--bg 중 하나

const lum = (hex: string) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const ch = (i: number) => { const c = parseInt(full.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
};
const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

/** CSS 글에서 라이트(:root 첫 블록)·다크(@media dark 안) 토큰 값 */
const tokens = (css: string) => {
  const dark = css.indexOf('@media (prefers-color-scheme: dark)');
  const read = (part: string) => Object.fromEntries([...part.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{3,8})\b/gi)].map((m) => [m[1], m[2]]));
  return { light: read(css.slice(0, dark)), dark: read(css.slice(dark)) };
};
const GROUNDS = ['--surface', '--surface-2', '--panel', '--bg'];

describe('계산 확인 — 이슈 표의 숫자와 같다', () => {
  it('#8a8a92 / #fff = 3.43, #83838c / #1b1b1f = 4.57', () => {
    expect(contrast('#8a8a92', '#ffffff')).toBeCloseTo(3.43, 2);
    expect(contrast('#83838c', '#1b1b1f')).toBeCloseTo(4.57, 2);
  });
});

describe.each([['데스크톱 styles.css', appCss], ['폰 mobile.css', phoneCss]])('%s — 모드 흐린 글 토큰 --text-dim', (_, css) => {
  const t = tokens(css);
  it.each(['light', 'dark'] as const)('%s: 모드 칸 바탕 넷 모두 4.5:1 이상', (scheme) => {
    const dim = t[scheme]['--text-dim'];
    expect(dim, '--text-dim 이 있다').toMatch(/^#/);
    for (const g of GROUNDS) expect(contrast(dim, t[scheme][g]), `${scheme} ${g}`).toBeGreaterThanOrEqual(4.5);
  });
  it('흐린 글은 여전히 흐리다 — 보통 보조 글(--text-2)보다 대비가 낮다', () => {
    for (const s of ['light', 'dark'] as const) expect(contrast(t[s]['--text-dim'], t[s]['--surface'])).toBeLessThan(contrast(t[s]['--text-2'], t[s]['--surface']));
  });
});

describe('모드 트리 — 흐린 색은 모두 --text-dim', () => {
  const style = (props: Record<string, unknown>) => { const n = normalize({ type: 'Text', props, children: ['a'] }); if (n.type !== 'Text') throw new Error(n.type); return n.style; };
  it('dimColor·inactive·subtle·gray·grey·diff…Dimmed', () => {
    expect(style({ dimColor: true }).color).toBe('var(--text-dim)');
    for (const c of ['inactive', 'subtle', 'gray', 'grey', 'diffAddedDimmed', 'diffRemovedDimmed']) expect(colorOf(c), c).toBe('var(--text-dim)');
  });
  it('테마를 따르는 중간 회색 secondary(= --text-2)', () => {
    expect(colorOf('secondary')).toBe('var(--text-2)');
  });
  it('흐린 Markdown 도 같은 토큰', () => {
    expect(modeCss).toMatch(/\.mdv-md\.dim\s*\{\s*color:\s*var\(--text-dim\)/);
  });
  it('흐린 Button 도 같은 토큰 — 투명도 0.6 은 라이트 흰 칸 4.47·패널 4.32 로 모자랐다', () => {
    // 주 버튼(검은 바탕·흰 글)은 흐린 글색을 쓰면 더 안 보인다 — 그대로 투명도
    expect(modeTreeTsx).toMatch(/style=\{n\.dim \? \(n\.primary \? \{ opacity: 0\.6 \} : \{ color: 'var\(--text-dim\)' \}\) : undefined\}/);
  });
});

describe('키트 Svg 스킨 --dim — 스킨 바탕(--surf)과 앱 회색 칸에서 4.5:1 이상', () => {
  const { svg } = svgDoc({ maxH: 400, layers: [{ skin: 'gauge', w: 10, h: 10, body: '' }] });
  const app = tokens(appCss);
  const varsOf = (block: string, skin: string) => {
    const m = block.match(new RegExp(`\\.k-${skin}\\{([^}]*)\\}`));
    return Object.fromEntries([...(m?.[1] ?? '').matchAll(/(--[\w-]+):(#[0-9a-f]{3,8})/gi)].map((x) => [x[1], x[2]]));
  };
  const darkAt = svg.indexOf('@media (prefers-color-scheme: dark)');
  it.each(['gauge', 'cover'])('%s 라이트·다크', (skin) => {
    for (const [scheme, block] of [['light', svg.slice(0, darkAt)], ['dark', svg.slice(darkAt)]] as const) {
      const v = varsOf(block, skin);
      expect(v['--dim'], `${skin} ${scheme}`).toMatch(/^#/);
      for (const g of [v['--surf'], app[scheme]['--surface-2'], app[scheme]['--panel']]) expect(contrast(v['--dim'], g), `${skin} ${scheme} ${g}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
