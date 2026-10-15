import { describe, expect, it } from 'vitest';
import css from './avatar.css?raw';
import shapes from './shapes.tsx?raw';

// 2026-10-04 mac-perf: 아무도 안 볼 때도 프사 무한 애니메이션이 GPU 39% — 다시 들어오지 않게
describe('avatar.css — 프사 움직임 규칙', () => {
  it('눈꺼풀(깜빡임)은 무한으로 돌지 않는다 — 6~8초마다 oa-blink 를 잠깐 단다', () => {
    const lids = css.split('\n').filter((l) => /\.oa-l[tb]\b/.test(l) && /animation:/.test(l));
    expect(lids.length).toBeGreaterThan(0);
    for (const l of lids) expect(l).not.toMatch(/infinite/);
    expect(css).toMatch(/\.oa-st-work\.oa-blink \.oa-lt/);
    expect(css).toMatch(/\.oa-st-rest\.oa-blink \.oa-lt/);
  });
  it('안 볼 때(oa-paused)는 그 자리에서 얼리지 않고 기본 자세 — 감은 눈·뛰는 중으로 굳으면 상태를 틀리게 보인다', () => {
    const rule = css.split('\n').find((l) => l.startsWith('html.oa-paused .oa *')); // 층(.oa-l)까지 — 2026-10-12 층 나누기
    expect(rule).toMatch(/animation: none !important/);
    expect(rule).toMatch(/html\.oa-paused \.oa::before/); // 올린 그림의 도는 고리도
    expect(css).toMatch(/html\.oa-paused \.oa-st-ask \.oa-eyes \{ transform: scale\(1\.14\); \}/);
  });
  it('프사마다 자기 합성 층 — 움직이는 SVG 가 둘레 칸(사이드바 줄·탭 알약)까지 매 프레임 다시 칠하지 않게(2026-10-09 GPU 27%→12%)', () => {
    const base = css.split('\n').find((l) => l.startsWith('.oa { position: relative;'));
    expect(base).toMatch(/will-change: transform/);
  });
});

// 2026-10-12 사용자 '가만히 있어도 앱이 무겁다' — 띠 프사 5개의 SVG 안쪽(<g>) 움직임을 WebKit 이 합성기로 못 돌려 매 프레임 다시 칠했다:
// 1개 GPU 3% → 2개 26~43% → 5개 50%. 프사를 겹친 층(몸·흰자·눈동자·눈꺼풀)으로 나눠 층마다 상자째 움직이면 다 움직이면서 1.2~1.4%(WebKit 하네스)
describe('프사 층 나누기 — 움직이는 건 HTML 층(합성기), SVG 안은 그림만', () => {
  it('도는 층(몸·얼굴·눈·눈동자)은 SVG 안 <g> 가 아니라 HTML 층', () => {
    for (const c of ['oa-tr', 'oa-all', 'oa-face', 'oa-eyes', 'oa-pup']) {
      expect(shapes, c).toMatch(new RegExp(`<span className="oa-l ${c}"`));
      expect(shapes, c).not.toMatch(new RegExp(`<g className="${c}"`));
    }
  });
  it('무한 움직임은 SVG 안쪽 그림(눈 하나·흰자·눈꺼풀·몸)을 직접 움직이지 않는다', () => {
    const svgInner = /\.oa-(eye|eyev|lt|lb|shut|smile|body|w|k|gl)\b(?![-\w])/;
    const bad = css.split('\n').filter((l) => /animation:[^;]*infinite/.test(l) && !l.startsWith('@'))
      .flatMap((l) => l.slice(0, l.indexOf('{')).split(',')).map((x) => x.trim()).filter((sel) => svgInner.test(sel.split(' ').pop() ?? ''));
    expect(bad).toEqual([]);
  });
  it('층을 옮기는 거리는 프사 크기 비율 — 층은 CSS px 라서 그대로 두면 작은 프사가 크게 움직인다', () => {
    for (const k of ['oa-w-face', 'oa-w-pup', 'oa-a-body', 'oa-t-alert', 'oa-t-joy', 'oa-ph-rise', 'oa-ph-ready']) {
      const i = css.indexOf(`@keyframes ${k} `);
      expect(i, k).toBeGreaterThan(-1);
      const body = css.slice(i, css.indexOf('\n@keyframes', i + 1) > 0 ? css.indexOf('\n@keyframes', i + 1) : undefined);
      expect(body.match(/translate[XY]?\([^)]*\d+(\.\d+)?px/g) ?? [], k).toEqual([]);
    }
  });
  it('안 볼 때·화면 밖·동작 줄이기는 층까지 다 멈춘다', () => {
    expect(css).toMatch(/html\.oa-paused \.oa \*, /);
    expect(css).toMatch(/\.oa\.oa-hidden \*, /);
  });
  // 사용자 걱정(2026-10-12): 층으로 나눈 프사(합성 층)가 위에 얹힌 상태 점·숫자를 가리면 안 된다
  it('쌓임 순서 — 프사는 제 안에서만 쌓이고(isolation), 프사 위 표시(상태 점·단계 점·뱃지)는 늘 위', () => {
    expect(css).toMatch(/\.oa \{[^}]*isolation: isolate/);
    expect(css).toMatch(/:is\(\.lk-pip, \.lk-ph-dot, \.cv-avb, .m-ring-dot\) \{ z-index: calc\(var\(--z-base\) \+ 1\); \}/);
  });
});

