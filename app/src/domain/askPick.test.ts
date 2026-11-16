import { describe, expect, it } from 'vitest';
import { areaOf, areaRef, boxOf, boxPx, boxText, cropOf, headingAbove, pickSpot, selRef } from './askPick';

// 2026-11-13 사용자: 스페이스 문서·그림에서 고른 곳을 짚은 채 참모에게 바로 묻기 — 글만 복사해 보내면 참모가 어느 문서 어디인지 모른다.
// 문서 = #sel1 "<파일>:<줄>" + 고른 글 인용, 그림 = #area1 "<파일>" box=x,y,w,h(0~1 비율, scripts/show --box 와 같은 꼴)

const DOC = [
  '# 주간 점검', // 1
  '', // 2
  '## A 안', // 3
  '사과만 판다.', // 4
  '', // 5
  '## B 안', // 6
  'B = 지금 쓰는 판매(주말 장터, **창고 재고**이 30일 전보다 줄면 새 주문 금지,', // 7
  '1상자·할인 35%). A = B 에서 그 거름망만 뺀 것.', // 8
  '', // 9
  '```', // 10
  '# 코드 속 샵은 제목이 아니다', // 11
  '```', // 12
  '주문 금지 조건은 [표](./t.md) 참고. 주문 금지 조건 다시.', // 13
].join('\n');

describe('pickSpot — 고른 글이 원본 몇째 줄인가', () => {
  it('한 줄 안에서 고르면 그 줄, 굵게·링크 표시는 빼고 맞춘다', () => {
    const before = '주간 점검\n\nA 안\n사과만 판다.\n\nB 안\nB = 지금 쓰는 판매(주말 장터, ';
    expect(pickSpot(DOC, '창고 재고이 30일 전보다 줄면 새 주문 금지,', before)).toEqual({ line: 7, heading: 'B 안' });
  });
  it('여러 줄을 고르면 시작~끝 줄', () => {
    const before = '주간 점검\n\nA 안\n사과만 판다.\n\nB 안\nB = 지금 쓰는 판매(주말 장터, ';
    expect(pickSpot(DOC, '창고 재고이 30일 전보다 줄면 새 주문 금지,\n1상자·할인 35%)', before)).toEqual({ line: 7, lineEnd: 8, heading: 'B 안' });
  });
  it('같은 글이 앞에도 있으면 앞에 나온 수(before)로 몇 번째인지 가른다', () => {
    const vis = '주간 점검\n\nA 안\n사과만 판다.\n\nB 안\nB = 지금 쓰는 판매(주말 장터, 창고 재고이 30일 전보다 줄면 새 주문 금지,\n1상자·할인 35%). A = B 에서 그 거름망만 뺀 것.\n\n# 코드 속 샵은 제목이 아니다\n';
    // 13줄의 두 번째 '주문 금지 조건'
    expect(pickSpot(DOC, '주문 금지 조건', `${vis}주문 금지 조건은 표 참고. `).line).toBe(13);
    // 7줄에도 '주문 금지' 가 있다 — 처음 나온 것
    expect(pickSpot(DOC, '주문 금지', 'B = 지금 쓰는 판매(주말 장터, 창고 재고이 30일 전보다 줄면 새 ').line).toBe(7);
  });
  it('코드 칸 속 # 줄은 제목으로 안 친다', () => {
    expect(headingAbove(DOC, 13)).toBe('B 안');
    expect(headingAbove(DOC, 2)).toBe('주간 점검');
    expect(headingAbove('그냥 글\n둘째', 2)).toBeUndefined();
  });
  it('제목 줄 자체를 고르면 그 제목', () => {
    expect(pickSpot(DOC, 'A 안', '주간 점검\n\n')).toEqual({ line: 3, heading: 'A 안' });
  });
  it('긴 첫 줄이 원본과 조금 달라도(탈출 글자) 앞 12자로 다시 찾는다', () => {
    const src = '첫 줄\n별표 \\*하나\\* 와 창고 재고 이야기를 길게 이어 쓴 줄입니다';
    expect(pickSpot(src, '별표 *하나* 와 창고 재고 이야기를 길게 이어 쓴 줄입니다', '첫 줄\n').line).toBe(2);
  });
  it('못 찾거나 빈 글이면 줄 없이', () => {
    expect(pickSpot(DOC, '없는 글입니다 아무데도', '')).toEqual({});
    expect(pickSpot(DOC, '   \n  ', '')).toEqual({});
  });
});

describe('selRef — 문서 고른 곳 칩', () => {
  it('#sel 칩 = 이름표 뒤 "경로:줄"(scripts/show 그대로), 화면 이름은 파일:줄만, 제목은 참모에게 가는 인용 머리에만(11-13 사용자 "글자 많은 거 싫어")', () => {
    const r = selRef('/Users/me/dev/shop/notes/주간.md', DOC, '창고 재고이 30일 전보다 줄면 새 주문 금지,', 'B = 지금 쓰는 판매(주말 장터, ');
    expect(r).toEqual({ kind: 'sel', who: '주간.md:7', head: '주간.md:7 · B 안', text: '창고 재고이 30일 전보다 줄면 새 주문 금지,', at: '"/Users/me/dev/shop/notes/주간.md:7"' });
  });
  it('여러 줄이면 :시작-끝, 줄을 못 찾으면 경로만', () => {
    expect(selRef('/a/b.md', DOC, '1상자·할인 35%). A = B\n그 거름망', 'x').at).toBe('"/a/b.md:8"');
    expect(selRef('/a/b.md', DOC, '창고 재고이 30일 전보다 줄면 새 주문 금지,\n1상자·할인 35%)', '').at).toBe('"/a/b.md:7-8"');
    expect(selRef('/a/b.md', DOC, '없는 글입니다 아무데도', '')).toMatchObject({ who: 'b.md', head: 'b.md', at: '"/a/b.md"' });
  });
  it('경로 속 따옴표·역슬래시는 칩 규칙대로 탈출', () => {
    expect(selRef('/a/"x" b.md', 'hi', 'hi', '').at).toBe('"/a/\\"x\\" b.md:1"');
  });
});

describe('boxOf — 끈 자리 → 0~1 비율 상자', () => {
  const img = { left: 100, top: 50, width: 400, height: 200 };
  it('왼쪽 위 → 오른쪽 아래', () => {
    expect(boxOf({ x: 148, y: 110 }, { x: 248, y: 146 }, img)).toEqual([0.12, 0.3, 0.25, 0.18]);
  });
  it('거꾸로 끌어도 같은 상자', () => {
    expect(boxOf({ x: 248, y: 146 }, { x: 148, y: 110 }, img)).toEqual([0.12, 0.3, 0.25, 0.18]);
  });
  it('그림 밖까지 끌면 그림 가장자리에서 자른다(0~1)', () => {
    expect(boxOf({ x: 0, y: 0 }, { x: 900, y: 900 }, img)).toEqual([0, 0, 1, 1]);
    expect(boxOf({ x: 300, y: 150 }, { x: 900, y: -40 }, img)).toEqual([0.5, 0, 0.5, 0.5]);
  });
  it('반올림해도 x+w·y+h 가 1 을 안 넘고 소수 찌꺼기가 없다', () => {
    const b = boxOf({ x: 100.33, y: 50.71 }, { x: 499.9999, y: 249.9999 }, img)!;
    expect(b[0] + b[2]).toBeLessThanOrEqual(1);
    expect(b[1] + b[3]).toBeLessThanOrEqual(1);
    expect(b.every((v) => String(v).length <= 5)).toBe(true);
  });
  it('6px 보다 작게 끌면(누르기·떨림) 상자가 아니다, 그림이 안 그려졌으면 없음', () => {
    expect(boxOf({ x: 200, y: 100 }, { x: 204, y: 180 }, img)).toBeNull();
    expect(boxOf({ x: 200, y: 100 }, { x: 260, y: 104 }, img)).toBeNull();
    expect(boxOf({ x: 50, y: 10 }, { x: 90, y: 40 }, img)).toBeNull(); // 그림 밖에서만 끌었다
    expect(boxOf({ x: 1, y: 1 }, { x: 90, y: 90 }, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });
  it('글 = 쉼표로 이은 비율(scripts/show --box 와 같은 꼴), 화면 자리로 되돌리기', () => {
    expect(boxText([0.12, 0.3, 0.25, 0.18])).toBe('0.12,0.3,0.25,0.18');
    expect(boxText([0, 0, 1, 1])).toBe('0,0,1,1');
    expect(boxPx([0.12, 0.3, 0.25, 0.18], img)).toEqual({ left: 148, top: 110, width: 100, height: 36 });
  });
});

describe('areaRef — 그림 상자 칩', () => {
  it('#area 칩 = 이름표 뒤 "경로" box=x,y,w,h, 이름 칸에 파일 이름', () => {
    expect(areaRef('/Users/me/shot 1.png', [0.12, 0.3, 0.25, 0.18])).toEqual({ kind: 'area', who: 'shot 1.png', text: 'box=0.12,0.3,0.25,0.18', at: '"/Users/me/shot 1.png" box=0.12,0.3,0.25,0.18' });
  });
});

describe('areaOf·cropOf — 입력칸 #area 칩에 숫자 대신 그 상자 부분 그림', () => {
  it('칩 자리 글("경로" box=…)을 경로·상자로 되읽는다 — 탈출 글자도', () => {
    expect(areaOf('"/Users/me/shot 1.png" box=0.12,0.3,0.25,0.18')).toEqual({ path: '/Users/me/shot 1.png', box: [0.12, 0.3, 0.25, 0.18] });
    expect(areaOf(areaRef('/a/"x" b.png', [0, 0, 1, 1]).at)).toEqual({ path: '/a/"x" b.png', box: [0, 0, 1, 1] });
  });
  it('#sel 자리·깨진 상자는 그림 칩이 아니다', () => {
    expect(areaOf('"/a/b.md:3"')).toBeNull();
    expect(areaOf('"/a/b.png" box=0.1,0.2,0.3')).toBeNull();
    expect(areaOf('"/a/b.png" box=0.9,0,0.5,0.5')).toBeNull(); // 그림 밖
    expect(areaOf(undefined)).toBeNull();
  });
  it('잘라 보이기 — 높이를 맞추고 상자 모양 그대로(그림 비율로), 너비는 20~64px', () => {
    // 1280×800 그림의 왼쪽 위 0.25×0.2 → 320×160px 상자 = 2:1 → 높이 24 이면 너비 48
    expect(cropOf([0, 0, 0.25, 0.2], { w: 1280, h: 800 }, 24)).toEqual({ w: 48, h: 24, img: { width: 192, height: 120, left: 0, top: 0 } });
    // 오른쪽 아래 반 — 그림을 그만큼 왼쪽 위로 민다
    expect(cropOf([0.5, 0.5, 0.5, 0.5], { w: 1000, h: 1000 }, 24)).toEqual({ w: 24, h: 24, img: { width: 48, height: 48, left: -24, top: -24 } });
    // 아주 길쭉한 상자는 64px 에서 자르고 가로 가운데
    const c = cropOf([0, 0.4, 1, 0.02], { w: 1000, h: 1000 }, 24);
    expect(c.w).toBe(64);
    expect(c.h).toBe(24);
  });
});
