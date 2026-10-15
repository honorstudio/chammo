// 입력을 시작할 때 화면이 툭 바뀌던 것(2026-10-12 사용자) — 시트가 살짝→반으로 오르며 대화 칸이 나타나고, 첫 글자에 단추가 바뀐다(스피커 → 참모, 참모 → 보내기).
// 전환은 160~240ms ease-out, transform·opacity 만, 움직임 줄이기면 끈다. 앱 테스트엔 DOM 이 없어서 CSS 규칙과 Composer 가 바뀐 단추에만 거는지를 본다
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';
import src from './Composer.tsx?raw';

const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel: string) => {
  const m = new RegExp(`(?:^|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm').exec(bare);
  return m?.[1] ?? '';
};
const keyframes = (name: string) => new RegExp(`@keyframes\\s+${name}\\s*\\{([\\s\\S]*?)\\}\\s*\\}`).exec(bare)?.[1] ?? '';
const ms = (decl: string) => { const m = /(\d+)ms/.exec(decl); return m ? Number(m[1]) : NaN; };

describe('입력 시작 전환', () => {
  for (const [sel, name] of [['.m-cin', 'm-cin'], ['.m-sheet:not(.m-snap-peek) .m-log', 'm-rise'], ['.m-peek', 'm-rise']] as const) {
    it(`${sel} — ${name} 160~240ms ease-out`, () => {
      const r = rule(sel);
      expect(r).toMatch(new RegExp(`animation:\\s*${name}\\s+\\d+ms\\s+ease-out`));
      expect(ms(r)).toBeGreaterThanOrEqual(160);
      expect(ms(r)).toBeLessThanOrEqual(240);
    });
  }
  it('움직이는 건 transform·opacity 만', () => {
    for (const k of ['m-cin', 'm-rise']) {
      const body = keyframes(k);
      expect(body, k).not.toBe('');
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      expect(props.every((p) => p === 'transform' || p === 'opacity'), `${k}: ${props.join(',')}`).toBe(true);
    }
  });
  it('움직임 줄이기면 끈다', () => {
    const m = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([^{}]*\{[^}]*\}[^{}]*)\}/g;
    const all = [...bare.matchAll(m)].map((x) => x[1]).join('\n');
    for (const sel of ['.m-cin', '.m-sheet:not(.m-snap-peek) .m-log', '.m-peek']) expect(all, sel).toContain(sel);
  });
  it('Composer 는 단추가 처음 바뀐 뒤에만 새로 놓인 단추에 m-cin — 처음 그릴 땐 안 움직인다', () => {
    expect(src).toMatch(/moved\.current/);
    expect(src).toMatch(/m-cin/);
    // 자리마다 key — 같은 button 이 클래스만 바뀌면 애니메이션이 다시 안 돈다
    for (const k of ['key="go"', 'key="voice"', "orchBtn('orch-l')", "orchBtn('orch-c')", 'key={key}']) expect(src).toContain(k);
  });
});
