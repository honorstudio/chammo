import { describe, expect, it } from 'vitest';
import layers from './layers.css?raw';

// 2026-11-01 사용자 제보: 스페이스 문서 탭 테두리 좌우 끝이 잘려 보인다.
// 원인 — 고른 탭이 바깥 링(box-shadow 0 0 0 1px)으로 테두리를 그렸는데, 탭이 가로 스크롤 줄(.lk-tabs-scroll, overflow) 맨 앞·맨 끝에
// 오면 칸 밖 1px 가 스크롤 칸 가장자리에서 잘렸다. 앱을 훑어 같은 모양(overflow 칸 안 바깥 링) 두 곳을 더 찾았다 — 보낼 것 빈 동그라미(.sfab, overflow hidden)
// 와 도구 화면 기준 프로젝트 포커스 링(.cv-titles p, 줄임표 줄), 폰 참모 프로필 이름 칸(.m-prof-form, 스크롤 칸). 고치는 법은 하나: 그런 자리의 획은 안쪽(inset)으로 — layers.css --hair-in·--ring-in.
const sheets = import.meta.glob('/src/ui/**/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

type Rule = { file: string; sel: string; body: string };
/** 규칙(선택자 + 몸통) — @media 안쪽도 한 겹 */
function rules(): Rule[] {
  const out: Rule[] = [];
  for (const [file, raw] of Object.entries(sheets)) {
    const css = noComments(raw).replace(/@(media|supports)[^{]*\{/g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ file, sel: m[1]!.trim(), body: m[2]! });
  }
  return out;
}
const shadowOf = (body: string) => body.match(/(?:^|;)\s*box-shadow\s*:\s*([^;]+)/)?.[1]?.trim() ?? null;
const parts = (v: string) => v.split(/,(?![^(]*\))/).map((p) => p.trim());

/** 바깥으로 퍼진 획(퍼짐 > 0·흐림 ≤ 2px·inset 아님) — 잘리는 칸 안에선 금지인 것 */
function outwardStrokes(v: string): string[] {
  if (v === 'none') return [];
  return parts(v).filter((p) => {
    if (/\binset\b/.test(p) || /^var\(--(hair|ring)-in\)/.test(p)) return false;
    const lens = p.replace(/var\(--ring-w\)/g, '2px').replace(/color-mix\((?:[^()]|\([^()]*\))*\)|rgba?\([^)]*\)|var\([^)]*\)|#[0-9a-f]+/gi, ' ')
      .match(/-?(?:\d*\.)?\d+px|(?<![\w.-])0(?![\w.%])/g) ?? [];
    const [, , blur = '0', spread = '0'] = lens;
    return parseFloat(spread) > 0 && parseFloat(blur) <= 2;
  });
}

// overflow 칸 안에 놓여 칸 가장자리에 닿는 것들(앱 훑기로 찾은 자리) — 이 클래스를 고르는 규칙엔 바깥 획이 없어야 한다.
// 새 자리를 찾으면 여기에 한 줄: [클래스, 자르는 칸]
const CLIPPED: [cls: string, by: string][] = [
  ['lk-tab', '.lk-tabs-scroll·.lk-tabs (overflow) — 맨 앞·맨 끝 탭'],
  ['sfab-pill', '.sfab (overflow hidden, 알약 모양 그대로 창으로 늘어남)'],
  ['tl-root', '.cv-titles p (줄임표 줄, overflow hidden)'],
  ['m-new-input', '폰 .m-prof-form (overflow-y auto, 옆 여백 0) — 이름 칸 좌우'],
];

describe('획 잘림 — overflow 칸 안 획은 안쪽으로', () => {
  it('layers.css 에 안쪽 획 토큰이 있다(굵기는 --ring-w 그대로)', () => {
    const css = noComments(layers);
    expect(css).toMatch(/--hair-in:\s*inset 0 0 0 1px;/);
    expect(css).toMatch(/--ring-in:\s*inset 0 0 0 var\(--ring-w\);/);
  });

  it('잘리는 칸 안 클래스를 고르는 규칙엔 바깥으로 퍼진 획이 없다', () => {
    const bad: string[] = [];
    for (const r of rules()) {
      const v = shadowOf(r.body);
      if (!v) continue;
      // 선택자의 마지막 조각(실제로 칠하는 요소)이 그 클래스일 때만
      for (const one of r.sel.split(',')) {
        const last = one.trim().split(/\s+|>/).filter(Boolean).pop() ?? '';
        for (const [cls] of CLIPPED) {
          if (new RegExp(`\\.${cls}(?![\\w-])`).test(last)) for (const p of outwardStrokes(v)) bad.push(`${r.file}: ${one.trim()} → ${p}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('고른 탭은 위·좌·우만 긋는다 — 아래는 열려 문서와 이어지고, 칸 자르기(clip-path)는 더 안 쓴다', () => {
    const on = rules().find((r) => r.sel === '.lk-tab.on');
    expect(on).toBeTruthy();
    const v = shadowOf(on!.body)!;
    expect(parts(v)).toEqual(['inset 1px 0 var(--line)', 'inset -1px 0 var(--line)', 'inset 0 1px var(--line)']);
    expect(on!.body).not.toMatch(/clip-path/);
    // 새 탭 반짝임도 같은 세 줄 위에
    const fresh = shadowOf(rules().find((r) => r.sel === '.lk-tab.fresh')!.body)!;
    expect(parts(fresh).slice(0, 3)).toEqual(parts(v));
    expect(outwardStrokes(fresh)).toEqual([]);
  });

  it('도구 기준 프로젝트 — 안쪽 링 자리만큼 줄과 단추를 같이 넓혀 글 자리는 그대로', () => {
    const tools = noComments(Object.entries(sheets).find(([f]) => f.endsWith('/space/tools.css'))![1]);
    const pad = (sel: string) => tools.match(new RegExp(`${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    for (const sel of ['.tl .cv-titles p', '.tl .tl-root']) {
      const b = pad(sel);
      const l = Number(b.match(/padding-left:\s*(\d+)px/)?.[1]), m = Number(b.match(/margin-left:\s*-(\d+)px/)?.[1]);
      expect(l, sel).toBeGreaterThanOrEqual(2);
      expect(m, sel).toBe(l);
    }
  });

  it('잡는 모양을 안다', () => {
    expect(outwardStrokes('0 0 0 1px var(--line)')).toHaveLength(1);
    expect(outwardStrokes('0 0 0 var(--ring-w) var(--accent)')).toHaveLength(1);
    expect(outwardStrokes('0 0 0 1px var(--line), 0 0 0 3px color-mix(in srgb, var(--working) 28%, transparent)')).toHaveLength(2);
    expect(outwardStrokes('var(--hair-in) var(--line), 0 2px 6px rgba(0, 0, 0, .08)')).toEqual([]); // 안쪽 획 + 흐린 그림자
    expect(outwardStrokes('inset 0 0 0 var(--ring-w) var(--accent)')).toEqual([]);
    expect(outwardStrokes('0 8px 22px color-mix(in srgb, var(--accent) 40%, transparent)')).toEqual([]); // 흐린 그림자는 획이 아님
  });
});
