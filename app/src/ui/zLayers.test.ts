import { describe, expect, it } from 'vitest';
import layers from './layers.css?raw';
import mainEntry from '../main.tsx?raw';
import modeEntry from '../mode.tsx?raw';
import readerEntry from '../reader.tsx?raw';
import mobileEntry from '../mobile.tsx?raw';

// 2026-10-11 UI 재조사: z-index 가 1~3000 에 흩어져 같은 숫자끼리 DOM 순서로 싸웠다(토스트 45 가 모달 1000·대화창 2000 밑에 깔림).
// 이제 층 이름 표(layers.css :root 의 --z-*) 만 쓴다 — 숫자 z-index 가 새로 생기면 여기서 걸린다.
// 폰(mobile.css)도 같이 묶는다(2026-10-11 폰 시트 공용화).
const sheets = import.meta.glob('/src/ui/**/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const desktop = Object.entries(sheets);

const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const LAYERS = ['base', 'panel', 'popover', 'sheet', 'modal', 'danger', 'toast', 'drag', 'boot'] as const;

function layerValues(css: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of noComments(css).matchAll(/--z-([a-z]+)\s*:\s*(-?\d+)\s*;/g)) out[m[1]!] = Number(m[2]);
  return out;
}

/** z-index 값 하나 → 실제 숫자(층 변수 + 더하기·빼기만 안다). 숫자가 그대로 박혀 있으면 null */
function resolve(v: string, z: Record<string, number>): number | null {
  const t = v.replace(/!important/, '').trim();
  const plain = /^var\(--z-([a-z]+)\)$/.exec(t);
  if (plain) return z[plain[1]!] ?? NaN;
  const calc = /^calc\(\s*var\(--z-([a-z]+)\)\s*([+-])\s*(\d+)\s*\)$/.exec(t);
  if (calc) return (z[calc[1]!] ?? NaN) + (calc[2] === '+' ? 1 : -1) * Number(calc[3]);
  return null;
}

/** 선택자 → z 값 (맨 안쪽 규칙만) */
function zRules(css: string): { sel: string; v: string }[] {
  const out: { sel: string; v: string }[] = [];
  for (const m of noComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const zm = /(?:^|;)\s*z-index\s*:\s*([^;]+)/.exec(m[2] ?? '');
    if (zm) out.push({ sel: (m[1] ?? '').replace(/\s+/g, ' ').trim(), v: zm[1]!.trim() });
  }
  return out;
}

describe('z-index 층 이름 표', () => {
  const z = layerValues(layers);

  it('CSS 를 실제로 읽었다(빈 글 함정 — vite test.css.include)', () => {
    expect(desktop.length).toBeGreaterThan(10);
    for (const [p, css] of desktop) expect(css.length, p).toBeGreaterThan(0);
  });

  it('층 표를 쓰는 창(메인·모드·리더·폰)은 layers.css 를 먼저 읽는다 — 안 읽으면 var 가 비어 z-index 가 auto 로 풀린다', () => {
    for (const [name, src] of [['main', mainEntry], ['mode', modeEntry], ['reader', readerEntry], ['mobile', mobileEntry]] as const) expect(src, name).toContain("import './ui/layers.css';");
  });

  it('층 변수 9개가 layers.css :root 에 있고 아래에서 위로 쌓인다', () => {
    for (const l of LAYERS) expect(z[l], l).toBeTypeOf('number');
    const vals = LAYERS.map((l) => z[l]!);
    expect([...vals].sort((a, b) => a - b)).toEqual(vals);
  });

  it('토스트는 위험 확인·모달 위, 끌기 유령은 토스트 위', () => {
    expect(z.toast!).toBeGreaterThan(z.danger!);
    expect(z.danger!).toBeGreaterThan(z.modal!);
    expect(z.drag!).toBeGreaterThan(z.toast!);
  });

  it('숫자 z-index 가 없다 — var(--z-*) 이나 calc(var(--z-*) ± n) 만', () => {
    const bad: string[] = [];
    for (const [p, css] of desktop) for (const r of zRules(css)) if (resolve(r.v, z) === null && r.v !== 'auto') bad.push(`${p} ${r.sel} → ${r.v}`);
    expect(bad).toEqual([]);
  });

  it('층 안에서 더하는 수는 다음 층에 닿지 않는다(0~9)', () => {
    const bad: string[] = [];
    for (const [p, css] of desktop) for (const r of zRules(css)) {
      const m = /calc\(\s*var\(--z-[a-z]+\)\s*[+-]\s*(\d+)\s*\)/.exec(r.v);
      if (m && Number(m[1]) > 9) bad.push(`${p} ${r.sel} → ${r.v}`);
    }
    expect(bad).toEqual([]);
  });

  it('겹치면 안 되는 쌍 — 위에 와야 하는 쪽이 위', () => {
    const all = desktop.flatMap(([, css]) => zRules(css));
    const at = (sel: string) => {
      const r = all.find((x) => x.sel === sel);
      expect(r, sel).toBeDefined();
      return resolve(r!.v, z)!;
    };
    const above = (hi: string, lo: string) => expect(at(hi), `${hi} > ${lo}`).toBeGreaterThan(at(lo));
    // 토스트가 모달·대화창 뒷막에 가려 안 읽히던 것
    above('.toasts', '.od-back');
    above('.toasts', '.abm-back');
    above('.toasts', '.setup');
    above('.toasts', '.pet-modal');
    above('.toasts', '.tour');
    // 위험 확인 대화창은 다른 모달 위
    above('.od-back', '.abm-back');
    above('.od-back', 'body > .dash-preview');
    // 팝오버는 패널(하니터·크게 보기·스페이스 모달) 위, 모달 밑
    above('.inbox-pop', '.space-modal');
    above('.inbox-pop', '.hn-panel.float');
    above('.setup', '.acct-pop');
    // 리더 활성 테두리는 칸 안 장식 — 결정 대기함·토스트 위로 지나가지 않는다
    above('.inbox-pop', '.reader-panel.active::after');
    above('.toasts', '.reader-panel.active::after');
    // 스페이스 모달은 보내기 FAB·찾기 줄 위, 크게 보기 리더는 칸 안 FAB 묶음 위
    above('.space-modal', '.sfab');
    above('.space-modal', '.cv-find');
    above('.reader-panel.full', '.sp-fab-wrap');
    // 끌기 유령은 늘 맨 위
    above('.cv-drag-ghost', '.od-back');
    above('.rd-ghost', '.abm-back');
    above('.furn-float', '.toasts');
    // 폰: 채팅 시트 < 아래 시트·전체 보기(공용 시트, 같은 층은 나중에 연 것이 위) < 맨 위 오류 줄 < 그림 크게 < 길게 누르기 메뉴 < 알림
    above('.m-pick-wrap', '.m-sheet');
    above('.m-top-err', '.m-pick-wrap');
    above('.m-iv', '.m-top-err');
    above('.m-menu-wrap', '.m-iv');
    above('.m-notice-wrap', '.m-menu-wrap');
    expect(at('.m-view')).toBe(at('.m-pick-wrap'));
    expect(at('.m-pick-wrap')).toBe(z.sheet);
  });
});
