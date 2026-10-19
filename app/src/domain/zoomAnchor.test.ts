import { describe, expect, it } from 'vitest';
import { anchorOf, scrollShift, viewCenter, type Rect } from './zoomAnchor';

// 스크롤 칸 한 축 모형 — 칸(왼쪽 bx, 폭 bw, 안쪽 여백 pad)에 폭 w 그림. 칸보다 작으면 가운데, 크면 여백부터 시작해 스크롤.
// 브라우저처럼 scroll 은 0 ~ (내용 - 칸) 으로 잘린다
const BX = 200;
const BW = 600;
const PAD = 16;
const maxScroll = (w: number) => Math.max(0, w + 2 * PAD - BW);
const imgLeft = (w: number, scroll: number) => BX + (w + 2 * PAD <= BW ? (BW - w) / 2 : PAD) - scroll;
const rect = (w: number, scroll: number, sy = 0): Rect => ({ left: imgLeft(w, scroll), top: imgLeft(w, sy) - BX + 100, width: w, height: w });
/** 확대 한 번 — 전 크기 w0·스크롤 s0 에서 커서 x 기준으로 w1 이 됐을 때의 새 스크롤 */
const zoomOnce = (w0: number, s0: number, w1: number, x: number) => {
  const a = anchorOf({ x, y: 300 }, rect(w0, s0))!;
  const s1 = s0 + scrollShift(a, rect(w1, s0)).dx;
  return Math.min(maxScroll(w1), Math.max(0, s1));
};
/** 커서 x 아래 그림 좌표(그림 원래 폭 1000 기준) */
const under = (w: number, scroll: number, x: number) => ((x - imgLeft(w, scroll)) / w) * 1000;

describe('zoomAnchor — 핀치·휠 확대는 커서 아래 점이 제자리에(왼쪽 위 기준으로 커졌다, 2026-10-19 사용자)', () => {
  it('이미 칸보다 큰 그림을 키워도 커서 아래 그림 좌표가 1px 안에서 그대로', () => {
    const x = 640;
    const s1 = zoomOnce(1000, 300, 1500, x);
    expect(Math.abs(under(1500, s1, x) - under(1000, 300, x))).toBeLessThan(1);
  });

  it('칸에 맞춘(작은) 그림에서 커서 쪽을 키우면 그 점이 그대로 — 왼쪽 위가 아니라', () => {
    const x = 650; // 오른쪽 가운데쯤
    const before = under(400, 0, x);
    const s1 = zoomOnce(400, 0, 1200, x);
    expect(s1).toBeGreaterThan(0); // 예전엔 스크롤 0(왼쪽 위 고정)
    expect(Math.abs(under(1200, s1, x) - before)).toBeLessThan(1);
  });

  it('축소도 같다 — 칸보다 클 때까지는 커서 아래 점이 그대로', () => {
    const x = 420;
    const s1 = zoomOnce(2000, 900, 1400, x);
    expect(Math.abs(under(1400, s1, x) - under(2000, 900, x))).toBeLessThan(1);
  });

  it('여러 번 이어서 키워도 쌓인 오차가 1px 안', () => {
    const x = 480;
    const start = under(500, 0, x);
    let w = 500;
    let s = 0;
    for (const n of [600, 750, 900, 1100, 1300, 1600, 2000, 2500]) { s = zoomOnce(w, s, n, x); w = n; }
    expect(Math.abs(under(w, s, x) - start)).toBeLessThan(1);
  });

  it('세로도 같은 셈', () => {
    const a = anchorOf({ x: 0, y: 250 }, { left: 0, top: 100, width: 10, height: 400 })!;
    expect(a.v).toBeCloseTo(0.375);
    expect(scrollShift(a, { left: 0, top: 100, width: 10, height: 800 }).dy).toBeCloseTo(150);
  });

  it('키보드 +/−·단추는 보이는 칸 가운데 기준', () => {
    expect(viewCenter({ left: 200, top: 50, width: 600, height: 400 })).toEqual({ x: 500, y: 250 });
  });

  it('크기 0 그림(아직 안 불림)은 기준점이 없다', () => {
    expect(anchorOf({ x: 1, y: 1 }, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });
});
