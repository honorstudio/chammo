import { describe, expect, it } from 'vitest';
import { TAB_FADE, tabEdges, tabScrollLeft, tabsTight } from './tabScroll';

// 탭 줄(가로 스크롤) 안에서 고른 탭이 보이게 할 scrollLeft — 이미 보이면 그대로(null)
// 가장자리 흐림(TAB_FADE) 밑에 걸쳐도 안 보이는 것으로 친다 — 흐림 밖까지 굴린다
describe('tabScrollLeft', () => {
  const box = { left: 100, width: 300, scrollLeft: 200 };
  it('왼쪽으로 밀려 안 보이면 탭 왼쪽 끝이 흐림 밖에 보이게', () => {
    // 탭이 화면 좌표 40~120 — 칸 왼쪽(100)보다 앞
    expect(tabScrollLeft(box, { left: 40, width: 80 })).toBe(200 - (100 + TAB_FADE - 40));
  });
  it('오른쪽으로 넘치면 탭 오른쪽 끝이 흐림 밖에 보이게', () => {
    // 탭이 360~460 — 칸 오른쪽(400)을 넘음
    expect(tabScrollLeft(box, { left: 360, width: 100 })).toBe(200 + (460 - (400 - TAB_FADE)));
  });
  it('흐림 밑에만 걸쳐도 굴린다', () => {
    // 탭이 300~390 — 칸 안이지만 오른쪽 흐림(400-TAB_FADE~400)에 걸침
    expect(tabScrollLeft(box, { left: 300, width: 90 })).toBe(200 + (390 - (400 - TAB_FADE)));
  });
  it('이미 다 보이면 null', () => {
    expect(tabScrollLeft(box, { left: 150, width: 100 })).toBeNull();
  });
  it('0 아래로는 안 간다', () => {
    expect(tabScrollLeft({ left: 100, width: 300, scrollLeft: 5 }, { left: 90, width: 50 })).toBe(0);
  });
});

// 넘친 탭 줄에서 양 끝 너머에 탭이 더 있나 — 흐림을 어느 쪽에 깔지
describe('tabEdges', () => {
  it('안 넘치면 양쪽 다 없음', () => {
    expect(tabEdges({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 })).toEqual({ left: false, right: false });
  });
  it('맨 왼쪽이면 오른쪽만', () => {
    expect(tabEdges({ scrollLeft: 0, scrollWidth: 600, clientWidth: 300 })).toEqual({ left: false, right: true });
  });
  it('가운데면 양쪽', () => {
    expect(tabEdges({ scrollLeft: 120, scrollWidth: 600, clientWidth: 300 })).toEqual({ left: true, right: true });
  });
  it('맨 오른쪽이면 왼쪽만 — 소수점 반올림(1px)은 끝으로 친다', () => {
    expect(tabEdges({ scrollLeft: 299.5, scrollWidth: 600, clientWidth: 300 })).toEqual({ left: true, right: false });
  });
});

// 좁은 탭 줄 — 안 고른 탭이 최소 폭(108) 가까이 눌리면 × 는 올렸을 때만(2026-10-10 사용자 PC: 이름이 두 글자만 보였다)
describe('tabsTight', () => {
  it('탭이 넉넉하면 아님 — × 늘 보임', () => {
    expect(tabsTight({ row: 900, add: 28, active: 150, gap: 4, n: 3 })).toBe(false);
  });
  it('안 고른 탭 몫이 최소 폭 근처면 좁음', () => {
    expect(tabsTight({ row: 560, add: 28, active: 150, gap: 4, n: 4 })).toBe(true);
  });
  it('넘쳐서 넘기는 중이어도 좁음', () => {
    expect(tabsTight({ row: 560, add: 28, active: 150, gap: 4, n: 10 })).toBe(true);
  });
  it('탭 하나면 안 고른 탭이 없어 아님', () => {
    expect(tabsTight({ row: 200, add: 28, active: 150, gap: 4, n: 1 })).toBe(false);
  });
  it('× 가 있든 없든 같은 값에서 갈린다 — 탭 폭이 아니라 줄 폭으로 재서 롤오버·전환에 출렁이지 않는다', () => {
    // 몫 = (560 - 28 - 4 - 150) / 3 - 4 = 122 → 좁음, 줄이 넓어 몫 140 이면 아님
    expect(tabsTight({ row: 560, add: 28, active: 150, gap: 4, n: 4 })).toBe(true);
    expect(tabsTight({ row: 614, add: 28, active: 150, gap: 4, n: 4 })).toBe(false);
  });
});
