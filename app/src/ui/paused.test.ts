import { describe, expect, it } from 'vitest';
import paused from './paused.css?raw';
import mainEntry from '../main.tsx?raw';
import mobileEntry from '../mobile.tsx?raw';
import readerEntry from '../reader.tsx?raw';
import modeEntry from '../mode.tsx?raw';

// 2026-10-11 perf: 안 볼 때(oa-paused)도 프사만 멈추고 도는 고리·숨쉬기는 그대로 돌아 앞+손 안 댐 GPU 39% — 무한 애니메이션은 전부 paused.css 목록에
const sheets = import.meta.glob('/src/**/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const PREFIX = ':is(html.oa-paused, html.oa-calm) '; // 안 볼 때 + 애니메이션 줄이기(ui/calm) 같은 목록
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
/** 괄호 안(:is(a, b)) 쉼표는 안 쪼갠다 */
function splitSelectors(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
/** 맨 안쪽 규칙(선택자 { 선언 })만 — @media·@keyframes 껍데기는 [^{}] 로 저절로 빠진다 */
function rules(css: string): { sel: string[]; body: string }[] {
  return [...noComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: splitSelectors(m[1] ?? ""), body: m[2] ?? "" }));
}
const INFINITE = /(^|;)\s*animation(-iteration-count)?\s*:[^;]*\binfinite\b/;

describe('paused.css — 안 볼 때 무한 애니메이션 전부 멈춤', () => {
  const rule = rules(paused).find((r) => r.sel.every((s) => s.startsWith(PREFIX)));
  const list = new Set((rule?.sel ?? []).map((s) => s.slice(PREFIX.length)));

  it('목록은 규칙 하나 — 그 자리에서 멈춘다(모양 그대로, 돌아오면 이어서)', () => {
    expect(rule).toBeTruthy();
    expect(rule!.body).toMatch(/animation-play-state: paused !important/);
  });

  it('CSS 어디든 infinite 애니메이션이 있으면 목록에 있어야 한다 — 새로 만들면 여기 한 줄', () => {
    expect(Object.keys(sheets).length).toBeGreaterThan(10);
    expect(Object.entries(sheets).filter(([, css]) => !css.trim()).map(([f]) => f)).toEqual([]); // 빈 글로 읽힌 파일(vite.config 의 test.css.include 밖)이 없나
    const missing: string[] = [];
    let seen = 0;
    for (const [file, css] of Object.entries(sheets)) {
      if (file.endsWith('/paused.css')) continue;
      for (const r of rules(css)) {
        if (!INFINITE.test(r.body)) continue;
        for (const s of r.sel) { seen++; if (!list.has(s)) missing.push(`${file}: ${s}`); }
      }
    }
    expect(seen).toBeGreaterThan(20);
    expect(missing).toEqual([]);
  });

  it('목록에 없는(지워진) 선택자는 남기지 않는다', () => {
    const all = new Set<string>();
    for (const [file, css] of Object.entries(sheets)) {
      if (file.endsWith('/paused.css')) continue;
      for (const r of rules(css)) if (INFINITE.test(r.body)) r.sel.forEach((s) => all.add(s));
    }
    expect([...list].filter((s) => !all.has(s))).toEqual([]);
  });

  it('무한 애니메이션이 있는 창 진입점은 다 paused.css 를 불러온다', () => {
    for (const src of [mainEntry, mobileEntry, readerEntry, modeEntry]) expect(src).toMatch(/import '\.\/ui\/paused\.css';/);
  });
});

// 2026-10-11 perf 2번: 보내기 고리(.cur-send)가 @property --cur-a 를 애니메이션해 프레임마다 스타일을 다시 계산했다(하네스 GPU +3%p, 펼침 판 +8%p).
// 도는 고리(.cv-spin 등 transform 회전)는 WebKit 이 이미 합성으로 돌려 will-change 를 붙여도 그대로였다 — 속성 애니메이션만 고친다
describe('보내기 고리 — 속성 애니메이션 대신 회전', () => {
  it('보내기 고리는 사용자 정의 속성(--cur-a) 대신 회전으로 돈다 — 속성 애니메이션은 프레임마다 스타일을 다시 계산한다', () => {
    const space = sheets['/src/ui/space/space.css'] ?? '';
    const before = rules(space).find((r) => r.sel.includes('.cur-send::before') && /animation\s*:/.test(r.body));
    expect(before?.body).toMatch(/animation: cur-ring /);
    expect(space).toMatch(/@keyframes cur-ring \{ to \{ transform: rotate\(360deg\); \} \}/);
    // 펼침 판 둘레 빛은 둥근 네모라 회전으로 못 바꾼다 — 보일 때(올림·초점·쌓임)만 돈다
    const wrap = rules(space).filter((r) => /animation\s*:[^;]*cur-spin/.test(r.body)).flatMap((r) => r.sel);
    expect(wrap).toEqual(['.cur-send-wrap:is(:hover, :focus-within, .has)::before']);
  });
});

// 2026-10-12 사용자 '부하 심하면 애니메이션 때문에 끊긴다' — 줄이기(oa-calm)는 위 목록을 같이 쓰고, 끄기(oa-still)는 전부 0
describe('애니메이션 줄이기·끄기', () => {
  it('끄기는 모든 움직임·전환을 끝 모양으로 바로', () => {
    expect(paused).toMatch(/html\.oa-still \*, html\.oa-still \*::before, html\.oa-still \*::after \{ animation-duration: 1ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; transition: none !important;/);
  });
  it('줄이기·끄기에서 프사는 기본 자세(일함·쉼 눈꺼풀, 물음 큰 눈)', () => {
    const av = sheets['/src/ui/avatar/avatar.css'] ?? '';
    expect(av).toMatch(/html\.oa-calm \.oa \*, html\.oa-calm \.oa, html\.oa-calm \.oa::before, html\.oa-still \.oa \*, html\.oa-still \.oa, html\.oa-still \.oa::before \{ animation: none !important; \}/);
    expect(av).toMatch(/:is\(html\.oa-calm, html\.oa-still\) \.oa-st-ask \.oa-eyes \{ transform: scale\(1\.14\); \}/);
  });
});

