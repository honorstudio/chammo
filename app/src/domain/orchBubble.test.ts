import { describe, expect, it } from 'vitest';
import { BADGE, DESK_PAD, POP_MS, anchorOf, badgeCounts, bubbleFace, deskPop, deskStage, stageBox, FAN_LEAVE_MS, FAN_OUT_MS, fanKeep, fanPlan, fanPoints, fanRings, fanSide, isDrag, padRect, farEdges, fitPopSize, placeOf, popLayout, resizedPop,  popOrigin, popPlace, popSteps, readAnchor, readSpot, screenPlace, screenSave, type Screen } from './orchBubble';

const box = { x: 0, y: 0, w: 1200, h: 800 };

describe('떠 있는 참모 배지 — 앱 안 자리(시안 orch-bubble A, 10-28 사용자 "A 좋다")', () => {
  it('처음엔 오른쪽 아래(가장자리에서 22px)', () => {
    expect(placeOf(null, box)).toEqual({ x: 1200 - BADGE - 22, y: 800 - BADGE - 22 });
  });
  it('놓은 자리는 가까운 가장자리에서 떨어진 px 로 기억한다 — 창을 키워도 그 가장자리에 붙어 따라간다', () => {
    const a = anchorOf({ x: 1100, y: 100 }, box); // 오른쪽·위가 가깝다
    expect(a).toEqual({ h: 'r', dx: 1200 - 1100 - BADGE, v: 't', dy: 100 });
    expect(placeOf(a, { x: 0, y: 0, w: 1600, h: 1000 })).toEqual({ x: 1600 - (1200 - 1100 - BADGE) - BADGE, y: 100 });
  });
  it('왼쪽 아래도 — 화면 어디든(귀퉁이로 안 끌려감)', () => {
    const a = anchorOf({ x: 300, y: 500 }, box);
    expect(a).toEqual({ h: 'l', dx: 300, v: 'b', dy: 800 - 500 - BADGE });
    expect(placeOf(a, box)).toEqual({ x: 300, y: 500 });
  });
  it('창이 줄어 밖으로 나가면 가장 가까운 안쪽(여백 8px)으로 당긴다 — 다시 키우면 기억한 자리로', () => {
    const a = anchorOf({ x: 100, y: 700 }, box); // 왼쪽 아래
    const small = { x: 0, y: 0, w: 500, h: 300 };
    expect(placeOf({ h: 'l', dx: 900, v: 't', dy: 700 }, small)).toEqual({ x: 500 - BADGE - 8, y: 300 - BADGE - 8 });
    expect(placeOf(a, box)).toEqual({ x: 100, y: 700 });
  });
  it('창보다 배지가 크면 왼쪽 위 여백에 붙인다(음수 자리 없음)', () => {
    expect(placeOf(null, { x: 0, y: 0, w: 30, h: 30 })).toEqual({ x: 8, y: 8 });
  });
  it('기억 읽기 — 모양이 틀리거나 숫자가 아니면 버린다', () => {
    expect(readAnchor('{"h":"r","dx":10,"v":"b","dy":20}')).toEqual({ h: 'r', dx: 10, v: 'b', dy: 20 });
    expect(readAnchor('{"h":"x","dx":10,"v":"b","dy":20}')).toBeNull();
    expect(readAnchor('{"h":"r","dx":"10","v":"b","dy":20}')).toBeNull();
    expect(readAnchor('깨짐')).toBeNull();
    expect(readAnchor(null)).toBeNull();
  });
});

describe('끌기와 누르기', () => {
  it('5px 넘게 움직여야 끌기 — 그 밑은 누르기', () => {
    expect(isDrag(3, 4)).toBe(false); // 정확히 5
    expect(isDrag(4, 4)).toBe(true);
    expect(isDrag(0, 0)).toBe(false);
    expect(isDrag(-6, 0)).toBe(true);
  });
});

describe('대화창 펼치는 쪽 — 화면 밖으로 안 나간다', () => {
  const pop = { w: 360, h: 470 };
  it('배지가 오른쪽 아래면 위로, 오른쪽 끝을 배지에 맞춰', () => {
    const b = { x: 1200 - BADGE - 22, y: 800 - BADGE - 22, w: BADGE, h: BADGE };
    const p = popPlace(b, box, pop);
    expect(p).toEqual({ x: b.x + BADGE - 360, y: b.y - 12 - 470, w: 360, h: 470 });
  });
  it('배지가 왼쪽 위면 아래로, 왼쪽 끝을 배지에 맞춰', () => {
    const b = { x: 40, y: 30, w: BADGE, h: BADGE };
    expect(popPlace(b, box, pop)).toEqual({ x: 40, y: 30 + BADGE + 12, w: 360, h: 470 });
  });
  it('위아래 어느 쪽도 다 안 들어가면 넓은 쪽에 두고 창 안으로 민다(높이는 창 안 여백까지 줄인다)', () => {
    const b = { x: 600, y: 200, w: BADGE, h: BADGE };
    const p = popPlace(b, { x: 0, y: 0, w: 1200, h: 500 }, pop);
    expect(p.y).toBeGreaterThanOrEqual(8);
    expect(p.y + p.h).toBeLessThanOrEqual(500 - 8);
    expect(p.h).toBe(Math.min(470, 500 - 16));
  });
  it('좁은 창이면 폭도 줄여 창 안에', () => {
    const p = popPlace({ x: 10, y: 10, w: BADGE, h: BADGE }, { x: 0, y: 0, w: 300, h: 800 }, pop);
    expect(p.x).toBe(8);
    expect(p.w).toBe(300 - 16);
  });
  it('키우기 = 창 높이 꽉(여백 8), 폭 480 — 배지 쪽 가장자리에 붙인다', () => {
    const b = { x: 1200 - BADGE - 22, y: 800 - BADGE - 22, w: BADGE, h: BADGE };
    expect(popPlace(b, box, pop, true)).toEqual({ x: 1200 - 8 - 480, y: 8, w: 480, h: 800 - 16 });
    expect(popPlace({ x: 30, y: 400, w: BADGE, h: BADGE }, box, pop, true)).toEqual({ x: 8, y: 8, w: 480, h: 800 - 16 });
  });
});

describe('배지 얼굴 — 마지막에 말한 참모, 묻는 참모가 있으면 그 참모가 앞으로', () => {
  const o = (id: string, pip: 'ask' | 'new' | 'run' | 'rest' | null = null) => ({ id, pip });
  it('지금 채팅 탭 참모', () => {
    expect(bubbleFace([o('a'), o('b')], 'b')?.id).toBe('b');
  });
  it('없으면 첫 참모, 아무도 없으면 없음', () => {
    expect(bubbleFace([o('a'), o('b')], 'zz')?.id).toBe('a');
    expect(bubbleFace([], 'a')).toBeNull();
  });
  it('다른 참모가 묻는 중이면 그 참모 얼굴로(지금 참모가 묻는 중이면 그대로)', () => {
    expect(bubbleFace([o('a'), o('b', 'ask')], 'a')?.id).toBe('b');
    expect(bubbleFace([o('a', 'ask'), o('b', 'ask')], 'a')?.id).toBe('a');
  });
});

describe('바탕 배지 — 모니터별 자리(어느 화면·그 안 비율)', () => {
  const mac: Screen = { id: 'mac', x: 0, y: 0, w: 1512, h: 982 };
  const ext: Screen = { id: 'ext', x: 1512, y: -200, w: 2560, h: 1440 };
  it('놓은 자리 = 배지 가운데가 있는 화면 + 그 안 비율', () => {
    const s = screenSave({ x: 1512 + 1280 - BADGE / 2, y: -200 + 720 - BADGE / 2 }, [mac, ext]);
    expect(s.screen).toBe('ext');
    expect(s.fx).toBeCloseTo(0.5);
    expect(s.fy).toBeCloseTo(0.5);
  });
  it('모니터 한 대 — 비율로 되살린다', () => {
    const s = screenSave({ x: 100, y: 200 }, [mac]);
    expect(screenPlace(s, [mac], 'mac')).toEqual({ screen: 'mac', x: 100, y: 200 });
  });
  it('그 모니터를 빼면 앱 창이 있는 화면 같은 비율 자리로', () => {
    const s = screenSave({ x: 1512 + 2560 - BADGE - 20, y: -200 + 40 }, [mac, ext]);
    const p = screenPlace(s, [mac], 'mac');
    expect(p.screen).toBe('mac');
    expect(p.x).toBe(Math.round(s.fx * (1512 - BADGE)));
    expect(p.y).toBe(Math.round(s.fy * (982 - BADGE)));
  });
  it('앱 창 화면도 모르면 첫 화면', () => {
    const s = { screen: 'gone', fx: 0, fy: 0 };
    expect(screenPlace(s, [mac, ext], 'gone2').screen).toBe('mac');
  });
  it('해상도가 바뀌어도 비율 그대로 — 화면 안으로', () => {
    const s = screenSave({ x: 1512 - BADGE, y: 982 - BADGE }, [mac]); // 오른쪽 아래 끝
    const smaller = { ...mac, w: 1280, h: 800 };
    expect(screenPlace(s, [smaller], 'mac')).toEqual({ screen: 'mac', x: 1280 - BADGE, y: 800 - BADGE });
  });
  it('저장된 게 없으면 앱 창 화면 오른쪽 아래', () => {
    expect(screenPlace(null, [mac, ext], 'ext')).toEqual({ screen: 'ext', x: 1512 + 2560 - BADGE - 22, y: -200 + 1440 - BADGE - 22 });
  });
  it('화면 목록이 비면 (0,0) 근처 — 죽지 않는다', () => {
    expect(screenPlace(null, [], null)).toEqual({ screen: '', x: 22, y: 22 });
  });
  it('끝에 걸쳐(반쯤 화면 밖) 놓아도 저장은 끝까지만 — 되살리면 다 보인다(사용자 353 잘림, 88px 바탕 배지 창)', () => {
    const r = screenSave({ x: 1512 - 40, y: 982 - 30 }, [mac], 88); // 오른쪽 아래로 반쯤 나감
    expect(r).toEqual({ screen: 'mac', fx: 1, fy: 1 });
    expect(screenPlace(r, [mac], 'mac', 88)).toEqual({ screen: 'mac', x: 1512 - 88, y: 982 - 88 });
    const l = screenSave({ x: -50, y: -20 }, [mac], 88); // 왼쪽 위로 나감
    expect(screenPlace(l, [mac], 'mac', 88)).toEqual({ screen: 'mac', x: 0, y: 0 });
  });
  it('모니터가 바뀌어(빠짐·해상도) 기억한 비율이 이상해도 화면 안 — 비율이 0~1 밖이면 끝으로', () => {
    const p = screenPlace({ screen: 'ext', fx: 1.7, fy: -0.4 }, [mac], 'mac', 88);
    expect(p).toEqual({ screen: 'mac', x: 1512 - 88, y: 0 });
    const small = { ...ext, w: 1280, h: 720 };
    const q = screenPlace({ screen: 'ext', fx: 1, fy: 1 }, [mac, small], 'mac', 88);
    expect(q).toEqual({ screen: 'ext', x: 1512 + 1280 - 88, y: -200 + 720 - 88 });
  });
  it('어느 화면에도 안 걸친 자리면 가장 가까운 화면으로 저장', () => {
    expect(screenSave({ x: 5000, y: 100 }, [mac, ext]).screen).toBe('ext');
  });
  it('대화창은 배지가 있는 그 모니터 안에서만', () => {
    const b = { x: 1512 + 10, y: -200 + 10, w: BADGE, h: BADGE };
    const p = popPlace(b, ext, { w: 360, h: 470 });
    expect(p.x).toBeGreaterThanOrEqual(ext.x);
    expect(p.y).toBeGreaterThanOrEqual(ext.y);
    expect(p.x + p.w).toBeLessThanOrEqual(ext.x + ext.w);
  });
});

describe('바탕 배지 창(72px — 배지 + 고리 자리)', () => {
  const mac: Screen = { id: 'mac', x: 0, y: 0, w: 1512, h: 982 };
  const ext: Screen = { id: 'ext', x: 1512, y: -200, w: 2560, h: 1440 };
  it('창 크기를 주면 그 크기로 화면 안 — 오른쪽 아래 끝도 넘치지 않는다', () => {
    const s = screenSave({ x: 1512 - 72, y: 982 - 72 }, [mac], 72);
    expect(screenPlace(s, [mac], 'mac', 72)).toEqual({ screen: 'mac', x: 1512 - 72, y: 982 - 72 });
    expect(screenPlace(null, [mac], 'mac', 72)).toEqual({ screen: 'mac', x: 1512 - 72 - 22, y: 982 - 72 - 22 });
  });
  it('기억 읽기 — 모양이 틀리면 버린다', () => {
    expect(readSpot('{"screen":"ext","fx":0.5,"fy":1}')).toEqual({ screen: 'ext', fx: 0.5, fy: 1 });
    expect(readSpot('{"screen":3,"fx":0.5,"fy":1}')).toBeNull();
    expect(readSpot('{"screen":"a","fx":"0.5","fy":1}')).toBeNull();
    expect(readSpot('깨짐')).toBeNull();
    expect(readSpot(null)).toBeNull();
  });
  it('대화창은 배지가 있는 모니터 안에서만 — 외장 모니터 왼쪽 위 배지면 그 모니터 아래·오른쪽으로', () => {
    const p = deskPop({ x: 1512 + 20, y: -200 + 20, w: 72, h: 72 }, [mac, ext], { w: 360, h: 470 })!;
    expect(p.x).toBeGreaterThanOrEqual(ext.x);
    expect(p.y).toBe(-200 + 20 + 72 + 12);
    expect(p.x + p.w).toBeLessThanOrEqual(ext.x + ext.w);
  });
  it('맥북 오른쪽 아래 배지면 맥북 안에서 위로', () => {
    const p = deskPop({ x: 1512 - 94, y: 982 - 94, w: 72, h: 72 }, [mac, ext], { w: 360, h: 470 })!;
    expect(p.x + p.w).toBeLessThanOrEqual(1512);
    expect(p.y + p.h).toBeLessThanOrEqual(982 - 94);
  });
  it('모니터를 모르면 없음', () => {
    expect(deskPop({ x: 0, y: 0, w: 72, h: 72 }, [], { w: 360, h: 470 })).toBeNull();
  });
});

describe('바탕 배지 무대 — 올림·뺌·배너에 창 크기·자리를 안 바꾼다(10-28 사용자 "호버하면 깜빡이면서 잠깐 위치가 바뀜")', () => {
  const mac: Screen = { id: 'mac', x: 0, y: 0, w: 1512, h: 982 };
  const ext: Screen = { id: 'ext', x: 1512, y: -200, w: 2560, h: 1440 };
  const EXT = { w: 236, h: 150 };
  it('오른쪽 아래 배지면 창이 왼쪽 위로 펼칠 자리를 미리 품는다 — 배지 상자는 창 오른쪽 아래', () => {
    const st = deskStage({ x: 1400, y: 870, w: 88, h: 88 }, [mac, ext], EXT);
    expect(st.side).toEqual({ x: -1, y: -1 });
    expect(st.win).toEqual({ x: 1400 - 236 - 10, y: 870 - 150 - 10, w: 88 + 236 + 20, h: 88 + 150 + 20 });
    expect(st.box).toEqual({ x: 10 + 236, y: 10 + 150 });
  });
  it('왼쪽 위 배지면 오른쪽 아래로 — 배지 상자는 창 왼쪽 위(여백만)', () => {
    const st = deskStage({ x: 1512 + 40, y: -150, w: 88, h: 88 }, [mac, ext], EXT);
    expect(st.side).toEqual({ x: 1, y: 1 });
    expect(st.win).toEqual({ x: 1512 + 40 - 10, y: -150 - 10, w: 344, h: 258 });
    expect(st.box).toEqual({ x: 10, y: 10 });
  });
  it('배지의 화면 자리 = 창 자리 + 상자 자리 — 어느 쪽이든 배지는 바탕에서 안 움직인다', () => {
    for (const b of [{ x: 30, y: 40 }, { x: 1400, y: 40 }, { x: 30, y: 870 }, { x: 1400, y: 870 }, { x: 3000, y: 900 }]) {
      const st = deskStage({ ...b, w: 88, h: 88 }, [mac, ext], EXT);
      expect({ x: st.win.x + st.box.x, y: st.win.y + st.box.y }).toEqual(b);
      expect(st.box).toEqual(stageBox(st.side, EXT));
    }
  });
  it('창은 배지가 있는 화면 안으로만 펼친다(옆 모니터로 안 넘어간다 — 넘어가면 맥이 창을 그쪽 화면에만 그린다)', () => {
    for (const b of [{ x: 0, y: 0 }, { x: 1512 - 88, y: 0 }, { x: 0, y: 982 - 88 }, { x: 1512 - 88, y: 982 - 88 }]) {
      const st = deskStage({ ...b, w: 88, h: 88 }, [mac, ext], EXT, 0);
      expect(st.win.x).toBeGreaterThanOrEqual(mac.x);
      expect(st.win.y).toBeGreaterThanOrEqual(mac.y);
      expect(st.win.x + st.win.w).toBeLessThanOrEqual(mac.x + mac.w);
      expect(st.win.y + st.win.h).toBeLessThanOrEqual(mac.y + mac.h);
    }
  });
  it('펼치는 쪽은 부채(fanSide)와 같은 기준 — 화면 가운데 쪽, 외장 모니터면 그 모니터 기준(배너도 이 쪽)', () => {
    const box = { x: 1400, y: 100, w: 88, h: 88 };
    expect(deskStage(box, [mac, ext], EXT).side).toEqual(fanSide({ x: box.x + 18, y: box.y + 10, w: 52, h: 52 }, mac));
    expect(deskStage({ x: 1512 + 30, y: 100, w: 88, h: 88 }, [mac, ext], EXT).side).toEqual({ x: 1, y: 1 });
  });
  it('모니터를 모르면 오른쪽 아래 기준(왼쪽 위로) — 죽지 않는다', () => {
    expect(deskStage({ x: 0, y: 0, w: 88, h: 88 }, [], EXT).side).toEqual({ x: -1, y: -1 });
  });
});

describe('v3 N — 숫자 알약 + 부채(사용자 10-28 "이게 맞는 듯")', () => {
  const o = (id: string, pip: 'ask' | 'new' | 'run' | 'rest' | null = null) => ({ id, pip });
  it('숫자 = 물어봄·일함만(쉼·새 것은 안 셈)', () => {
    expect(badgeCounts([o('a', 'ask'), o('b', 'run'), o('c', 'run'), o('d', 'rest'), o('e', 'new'), o('f')])).toEqual({ ask: 1, work: 2 });
  });
  it('부채 = 얼굴 참모 빼고 급한 참모(물어봄·새 것) → 일함 → 쉼 순서, 7명까지', () => {
    const list = [o('a', 'rest'), o('b', 'run'), o('c', 'ask'), o('d'), o('e', 'new')];
    expect(fanPlan(list, 'b')).toEqual({ shown: ['c', 'e', 'a', 'd'], more: [] });
  });
  it('8명 넘으면 6명 + 나머지는 +N(나머지도 같은 순서)', () => {
    const list = Array.from({ length: 13 }, (_, i) => o(`p${i}`, i === 9 ? 'ask' : i % 2 ? 'run' : 'rest'));
    const p = fanPlan(list, 'p0');
    expect(p.shown).toHaveLength(6);
    expect(p.shown[0]).toBe('p9');
    expect(p.more).toHaveLength(6);
    expect([...p.shown, ...p.more].sort()).toEqual(list.map((x) => x.id).filter((x) => x !== 'p0').sort());
  });
  it('딱 8명이면(얼굴 + 7) 다 보인다', () => {
    const list = Array.from({ length: 8 }, (_, i) => o(`p${i}`));
    expect(fanPlan(list, 'p0')).toEqual({ shown: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'], more: [] });
  });
  it('부채 방향 = 화면 가운데 쪽(오른쪽 아래 배지면 왼쪽 위)', () => {
    const box = { x: 0, y: 0, w: 1200, h: 800 };
    expect(fanSide({ x: 1100, y: 700, w: BADGE, h: BADGE }, box)).toEqual({ x: -1, y: -1 });
    expect(fanSide({ x: 20, y: 20, w: BADGE, h: BADGE }, box)).toEqual({ x: 1, y: 1 });
  });
  it('부채 자리 = 반원 1/4(가로 → 세로), 배지 가운데에서 R', () => {
    const p = fanPoints(3, 100, { x: -1, y: -1 });
    expect(p[0]).toEqual({ x: -100, y: 0 });
    expect(p[2]!.x).toBeCloseTo(0);
    expect(p[2]!.y).toBeCloseTo(-100);
    expect(Math.hypot(p[1]!.x, p[1]!.y)).toBeCloseTo(100);
    expect(fanPoints(1, 80, { x: 1, y: 1 })).toEqual([{ x: 80, y: 0 }]);
  });
});

describe('부채 두 줄(안쪽 3·바깥 4) — 7개를 한 줄 1/4 원에 놓으면 겹쳤다(하네스 10-28)', () => {
  it('안쪽 고리부터 3개, 나머지 바깥 고리(최대 4)', () => {
    const p = fanRings(7, { x: -1, y: -1 });
    expect(p).toHaveLength(7);
    expect(p.slice(0, 3).every((q) => Math.round(Math.hypot(q.x, q.y)) === 72)).toBe(true);
    expect(p.slice(3).every((q) => Math.round(Math.hypot(q.x, q.y)) === 130)).toBe(true);
  });
  it('이웃끼리 안 겹친다(지름 38 + 틈)', () => {
    for (const k of [1, 2, 3, 4, 5, 6, 7]) {
      const p = fanRings(k, { x: -1, y: -1 });
      for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) expect(Math.hypot(p[i]!.x - p[j]!.x, p[i]!.y - p[j]!.y)).toBeGreaterThanOrEqual(40);
    }
  });
  it('왼쪽 위 쪽으로만(배지 오른쪽 아래)', () => {
    expect(fanRings(7, { x: -1, y: -1 }).every((q) => q.x <= 0 && q.y <= 0)).toBe(true);
  });
});

describe('대화창 톡 — 배지 자리에서 자라 나오고 배지로 줄어든다(10-28 사용자 "작은 창 애니메이션으로 팝업")', () => {
  it('열기: 접힌 채 창 크기를 바꾸고(from) 그다음 펼친다(in) — 창이 튀는 순간을 가리는 것이라 움직임 줄이기여도 같은 단계(전환만 0)', () => {
    expect(popSteps(true, true)).toEqual(['from', 'in']);
    expect(popSteps(true, false)).toEqual(['from', 'in']);
  });
  it('닫기: 배지 쪽으로 접고(out) 안 보이게 한 뒤(gone) 창을 배지로 — 움직임 줄이기면 접기 없이 바로', () => {
    expect(popSteps(false, true)).toEqual(['out', 'gone']);
    expect(popSteps(false, false)).toEqual(['gone']);
  });
  it('펼치기는 살짝 튀는 0.25~0.35초, 접기는 그보다 짧게', () => {
    expect(POP_MS.open).toBeGreaterThanOrEqual(250);
    expect(POP_MS.open).toBeLessThanOrEqual(350);
    expect(POP_MS.close).toBeLessThan(POP_MS.open);
  });
  it('자라 나오는 점 = 배지 가운데를 대화창 안으로 당긴 점(대화창 기준 px) — 배지 쪽 모서리', () => {
    const pop = { x: 100, y: 100, w: 360, h: 470 };
    expect(popOrigin({ x: 400, y: 582, w: 52, h: 52 }, pop)).toEqual({ x: 326, y: 470 }); // 배지가 오른쪽 아래 → 아래 변 오른쪽
    expect(popOrigin({ x: 80, y: 600, w: 52, h: 52 }, pop)).toEqual({ x: 6, y: 470 }); // 왼쪽 아래 → 아래 변 왼쪽 끝
    expect(popOrigin({ x: 100, y: 20, w: 52, h: 52 }, pop)).toEqual({ x: 26, y: 0 }); // 위 → 위 변
  });
  it('실제 자리(deskPop)로 열면 — 오른쪽 아래 배지는 대화창 아래 변 오른쪽에서 자란다', () => {
    const mac: Screen = { id: 'm', x: 0, y: 25, w: 1512, h: 887 };
    const win = { x: 1512 - 88 - 22, y: 25 + 887 - 88 - 22, w: 88, h: 88 };
    const r = deskPop(win, [mac], { w: 360, h: 470 })!;
    const o = popOrigin({ x: win.x + 18, y: win.y + 10, w: 52, h: 52 }, r);
    expect(o.y).toBe(r.h);
    expect(o.x).toBeGreaterThan(r.w / 2);
  });
});

describe('바탕 배지 창 여백 — 자리는 배지 상자 그대로, 맥 창만 넓혀 물결·그림자가 안 잘리게(10-28 사용자 캡처 "위가 납작")', () => {
  it('네 방향으로 같은 만큼 넓히고, 되돌리면 상자 그대로', () => {
    expect(padRect({ x: 100, y: 200, w: 88, h: 88 })).toEqual({ x: 100 - DESK_PAD, y: 200 - DESK_PAD, w: 88 + DESK_PAD * 2, h: 88 + DESK_PAD * 2 });
    expect(padRect(padRect({ x: 1, y: 2, w: 88, h: 88 }), -DESK_PAD)).toEqual({ x: 1, y: 2, w: 88, h: 88 });
  });
});

describe('열린 동안 배지는 제자리 — 접힐 자리가 보인다(10-28 사용자 "최소화할 때 위치가 불분명")', () => {
  const box = { x: 1000, y: 700, w: 88, h: 88 };
  const badge = { x: 1018, y: 710, w: 52, h: 52 };
  it('창 = 배지 상자(여백 포함)와 대화창을 다 덮는 사각형, 대화창은 배지 가운데에서 자란다(대화창 밖 점이어도)', () => {
    const pop = { x: 728, y: 218, w: 360, h: 470 }; // 배지 위·오른쪽 끝 맞춤
    const l = popLayout(box, badge, pop);
    expect(l.badge).toBe(true);
    expect(l.win).toEqual({ x: 728, y: 218, w: 1088 + DESK_PAD - 728, h: 788 + DESK_PAD - 218 });
    expect(l.pop).toEqual({ x: 0, y: 0, w: 360, h: 470 });
    expect(l.box).toEqual({ x: 1000 - 728, y: 700 - 218 });
    expect(l.origin).toEqual({ x: 1044 - 728, y: 736 - 218 }); // 대화창 아래로 벗어난 배지 가운데
  });
  it('대화창이 배지를 덮으면(키우기) 창 = 대화창, 배지는 안 그리고 자라는 점은 대화창 안으로 당긴다', () => {
    const pop = { x: 600, y: 8, w: 480, h: 780 };
    const l = popLayout(box, badge, pop);
    expect(l.badge).toBe(false);
    expect(l.win).toEqual(pop);
    expect(l.origin).toEqual(popOrigin(badge, pop));
  });
});

describe('대화창 크기 — 사람이 끌어 바꾸고 기억(10-28 사용자 "늘렸다 줄였다")', () => {
  it('손잡이는 배지 반대쪽 두 변·그 모서리 — 배지가 오른쪽 아래면 왼쪽·위', () => {
    expect(farEdges({ x: 330, y: 500 }, { w: 360, h: 470 })).toEqual({ x: 'left', y: 'top' });
    expect(farEdges({ x: 10, y: -30 }, { w: 360, h: 470 })).toEqual({ x: 'right', y: 'bottom' });
  });
  it('끈 만큼 커지고(반대쪽 변은 끄는 방향 반대), 최소 320×400·최대 작업 영역 안', () => {
    const far = { x: 'left' as const, y: 'top' as const };
    expect(resizedPop({ w: 360, h: 470 }, -40, -30, far, 'xy')).toEqual({ w: 400, h: 500 });
    expect(resizedPop({ w: 360, h: 470 }, 40, 0, far, 'x')).toEqual({ w: 320, h: 470 }); // 최소
    expect(fitPopSize({ w: 2000, h: 2000 }, { x: 0, y: 25, w: 1512, h: 887 })).toEqual({ w: 1512 - 16, h: 887 - 16 });
    expect(fitPopSize({ w: 100, h: 100 }, { x: 0, y: 25, w: 1512, h: 887 })).toEqual({ w: 320, h: 400 });
  });
});

describe('부채 머물기 — 시간보다 자리(10-28 밤 사용자 "마우스 빼도 애들이 너무 오래 떠 있음")', () => {
  const c = { x: 200, y: 200 };
  const up = { x: -1 as const, y: -1 as const };
  it('배지 원 위·배지에서 얼굴로 옮겨 가는 길(고리 사이 틈)은 머문다', () => {
    expect(fanKeep(c, c, up, 7)).toBe(true);
    for (const p of fanRings(7, up)) {
      expect(fanKeep({ x: c.x + p.x, y: c.y + p.y }, c, up, 7)).toBe(true); // 얼굴 위
      expect(fanKeep({ x: c.x + p.x / 2, y: c.y + p.y / 2 }, c, up, 7)).toBe(true); // 배지→얼굴 길 한가운데
    }
    const [a, b] = fanRings(7, up).slice(3, 5);
    expect(fanKeep({ x: c.x + (a!.x + b!.x) / 2, y: c.y + (a!.y + b!.y) / 2 }, c, up, 7)).toBe(true); // 바깥 얼굴 사이
  });
  it('축 위 얼굴(가로·세로 끝)은 반쯤 축 너머로 나와 있어도 그 얼굴 위면 머문다', () => {
    expect(fanKeep({ x: c.x - 72, y: c.y + 15 }, c, up, 3)).toBe(true);
    expect(fanKeep({ x: c.x + 15, y: c.y - 72 }, c, up, 3)).toBe(true);
  });
  it('부채 반대쪽·바깥 고리 너머·예전 네모 올림 칸의 빈 모서리는 밖 — 거기서 접힘 시간이 간다', () => {
    expect(fanKeep({ x: c.x + 60, y: c.y + 60 }, c, up, 7)).toBe(false); // 반대쪽
    expect(fanKeep({ x: c.x - 190, y: c.y }, c, up, 7)).toBe(false); // 바깥 고리 너머
    expect(fanKeep({ x: c.x - 150, y: c.y - 150 }, c, up, 7)).toBe(false); // 네모 칸 모서리(예전엔 여기서도 안 접혔다)
  });
  it('얼굴이 3명 이하(안쪽 고리만)면 둘레도 작다', () => {
    expect(fanKeep({ x: c.x - 120, y: c.y - 30 }, c, up, 7)).toBe(true);
    expect(fanKeep({ x: c.x - 120, y: c.y - 30 }, c, up, 3)).toBe(false);
  });
  it('쪽이 바뀌면 둘레도 그쪽(오른쪽 아래로 펴진 부채)', () => {
    const down = { x: 1 as const, y: 1 as const };
    expect(fanKeep({ x: c.x + 90, y: c.y + 90 }, c, down, 7)).toBe(true);
    expect(fanKeep({ x: c.x - 90, y: c.y - 90 }, c, down, 7)).toBe(false);
  });
  it('마우스가 창 밖(자리 모름)이면 밖', () => {
    expect(fanKeep(null, c, up, 7)).toBe(false);
  });
  it('뺀 뒤 여유 250~350ms(예전 450), 접힘 0.18~0.22초', () => {
    expect(FAN_LEAVE_MS).toBeGreaterThanOrEqual(250);
    expect(FAN_LEAVE_MS).toBeLessThanOrEqual(350);
    expect(FAN_OUT_MS).toBeGreaterThanOrEqual(180);
    expect(FAN_OUT_MS).toBeLessThanOrEqual(260); // 엇갈림 포함 끝까지
  });
});
