import { describe, expect, it } from 'vitest';
import css from './avatar.css?raw';

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
    const rule = css.split('\n').find((l) => l.startsWith('html.oa-paused .oa svg *'));
    expect(rule).toMatch(/animation: none !important/);
    expect(rule).toMatch(/html\.oa-paused \.oa::before/); // 올린 그림의 도는 고리도
    expect(css).toMatch(/html\.oa-paused \.oa-st-ask \.oa-eyes \{ transform: scale\(1\.14\); \}/);
  });
  it('프사마다 자기 합성 층 — 움직이는 SVG 가 둘레 칸(사이드바 줄·탭 알약)까지 매 프레임 다시 칠하지 않게(2026-10-09 GPU 27%→12%)', () => {
    const base = css.split('\n').find((l) => l.startsWith('.oa { position: relative;'));
    expect(base).toMatch(/will-change: transform/);
  });
});
