import { describe, expect, it } from 'vitest';
import { fitZoom, makePinchAccum, makeWheelAccum, nextTabZoom, parseTabZooms, tabZoomable, tabZoomLabel, tabZoomOf, TAB_ZOOM_MAX_FILES, withTabZoom, wheelDir } from './tabZoom';

// 2026-10-12 사용자(참모-2 전달): 스페이스 탭(md·txt·엑셀·pdf·그림·html)에서 확대·축소·맞춤. 배율은 파일(경로)마다 기억
describe('tabZoomable — 어떤 탭이 확대되나', () => {
  it('md·txt·엑셀·pdf·그림·html·오피스는 된다', () => {
    for (const p of ['/a/n.md', '/a/n.txt', '/a/s.xlsx', '/a/d.pdf', '/a/i.png', '/a/p.html', '/a/x.pptx']) expect(tabZoomable(p)).toBe(true);
  });
  it('영상·소리·웹 주소는 확대할 게 없다', () => {
    for (const p of ['/a/v.mp4', '/a/s.mp3', 'https://example.com/x']) expect(tabZoomable(p)).toBe(false);
  });
});

describe('파일마다 기억 — withTabZoom·tabZoomOf', () => {
  it('기본은 100(그림은 맞춤), 적은 파일만 그 배율', () => {
    expect(tabZoomOf({}, '/a/n.md')).toBe(100);
    expect(tabZoomOf({}, '/a/i.png')).toBe(0);
    const m = withTabZoom({}, '/a/n.md', 150);
    expect(tabZoomOf(m, '/a/n.md')).toBe(150);
    expect(tabZoomOf(m, '/b/n.md')).toBe(100); // 같은 종류 다른 파일은 그대로 100
  });
  it('기본값으로 돌리면 기억에서 뺀다(저장소가 안 불어남)', () => {
    expect(withTabZoom({ '/a/n.md': 150 }, '/a/n.md', 100)).toEqual({});
    expect(withTabZoom({ '/a/i.png': 50 }, '/a/i.png', 0)).toEqual({});
  });
  it('파일이 너무 많으면 오래된 것부터 버리고, 바꾼 파일은 최근 자리로', () => {
    let m: Record<string, number> = {};
    for (let i = 0; i < TAB_ZOOM_MAX_FILES + 5; i++) m = withTabZoom(m, `/f/${i}.md`, 125);
    expect(Object.keys(m)).toHaveLength(TAB_ZOOM_MAX_FILES);
    expect(m['/f/0.md']).toBeUndefined();
    expect(m[`/f/${TAB_ZOOM_MAX_FILES + 4}.md`]).toBe(125);
    const k = Object.keys(m)[0]!;
    expect(Object.keys(withTabZoom(m, k, 200)).at(-1)).toBe(k);
  });
  it('저장값 읽기 — 숫자 아닌 값·범위 밖은 버린다', () => {
    expect(parseTabZooms(JSON.stringify({ '/a/n.md': 150, '/b/n.md': 'x', '/c/n.md': 9999, '/a/i.png': 0, '/b/i.png': 25 }))).toEqual({ '/a/n.md': 150, '/a/i.png': 0, '/b/i.png': 25 });
    expect(parseTabZooms(null)).toEqual({});
    expect(parseTabZooms('깨짐')).toEqual({});
    expect(parseTabZooms('[1,2]')).toEqual({});
  });
});

describe('nextTabZoom — 단계 한 칸·100%·맞춤', () => {
  it('글·표는 리더와 같은 단계 표로 한 칸씩', () => {
    expect(nextTabZoom('/a/n.md', 100, 1)).toBe(110);
    expect(nextTabZoom('/a/n.md', 100, -1)).toBe(90);
    expect(nextTabZoom('/a/n.md', 300, 1)).toBe(300); // 끝
    expect(nextTabZoom('/a/n.md', 50, -1)).toBe(50);
  });
  it('⌘0 은 100%, 그림도 100%(실제 크기)', () => {
    expect(nextTabZoom('/a/n.md', 175, 0)).toBe(100);
    expect(nextTabZoom('/a/i.png', 50, 0)).toBe(100);
  });
  it('⌘9 맞춤 — 그림은 FIT, 글·표는 넘기는 맞춤 배율(없으면 100)', () => {
    expect(nextTabZoom('/a/i.png', 200, 'fit')).toBe(0);
    expect(nextTabZoom('/a/s.xlsx', 100, 'fit', { fitTo: 67 })).toBe(67);
    expect(nextTabZoom('/a/n.md', 150, 'fit')).toBe(100);
  });
  it('그림이 맞춤 상태에서 누르면 지금 보이는 배율에서 한 칸', () => {
    expect(nextTabZoom('/a/i.png', 0, 1, { shown: 42 })).toBe(50);
    expect(nextTabZoom('/a/i.png', 0, -1, { shown: 42 })).toBe(33);
    expect(nextTabZoom('/a/i.png', 0, 1)).toBe(110); // 모르면 100 에서
  });
});

describe('fitZoom — 표가 창보다 넓으면 줄여 맞춘다', () => {
  it('안 넘치면 100, 넘치면 창 폭에 들어오는 가장 가까운 아래 단계', () => {
    expect(fitZoom(800, 700, 100)).toBe(100);
    expect(fitZoom(800, 1000, 100)).toBe(80); // 80%
    expect(fitZoom(800, 1400, 100)).toBe(50); // 57% → 50
    expect(fitZoom(800, 100, 100)).toBe(100);
  });
  it('이미 줄인 상태(z=50)의 scrollWidth 도 자연 폭으로 되돌려 잰다', () => {
    expect(fitZoom(800, 500, 50)).toBe(80); // 자연 1000 → 80%
  });
  it('폭을 못 재면 100', () => { expect(fitZoom(0, 900, 100)).toBe(100); expect(fitZoom(800, 0, 100)).toBe(100); });
});

describe('wheelDir — ⌘+휠 · Ctrl+휠 · Alt+휠 · 트랙패드 핀치(ctrlKey 붙은 wheel)', () => {
  const w = (m: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }>, deltaY: number) => ({ ctrlKey: false, metaKey: false, altKey: false, ...m, deltaY });
  it('위로 = 확대, 아래로 = 축소', () => {
    for (const m of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(wheelDir(w(m, -10))).toBe(1);
      expect(wheelDir(w(m, 10))).toBe(-1);
    }
  });
  it('수정키가 없거나 움직임이 없으면 그냥 스크롤(null)', () => {
    expect(wheelDir(w({}, -10))).toBeNull();
    expect(wheelDir(w({ ctrlKey: true }, 0))).toBeNull();
  });
});

describe('휠·핀치 모으기 — 작은 값이 많이 와도 한 단계씩', () => {
  it('트랙패드 핀치: 문턱 40 을 넘을 때마다 한 단계', () => {
    const a = makeWheelAccum();
    expect([a(-10), a(-10), a(-10), a(-10)]).toEqual([0, 0, 0, 1]);
    expect(a(100)).toBe(-1);
  });
  it('사파리 gesturechange: 15% 벌어질 때마다 한 단계, 기준을 새로 잡는다', () => {
    const p = makePinchAccum();
    p.start();
    expect([p.move(1.05), p.move(1.16), p.move(1.2), p.move(1.34)]).toEqual([0, 1, 0, 1]);
    p.start();
    expect(p.move(0.8)).toBe(-1);
  });
});

describe('머리 글자', () => { it('맞춤·%', () => { expect(tabZoomLabel(0)).toBe('맞춤'); expect(tabZoomLabel(125)).toBe('125%'); }); });
