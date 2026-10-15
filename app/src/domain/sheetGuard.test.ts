// 폰 채팅 시트 박힘(2026-10-11 사용자 "이렇게 박히는 경우가 있음") — 하네스 재현: 손잡이를 끌다 손 떼는 사건 없이 앱이 가려지면
// 끌던 자리(살짝·반·전체 사이)에 그대로 남고 돌아와도 안 풀렸다(.shots/design-phone-dash/harness/stuck.cjs, before: sheetTop 437)
import { describe, expect, it } from 'vitest';
import { chatModel, dragStale, flickV, layoutOff, logShown, modalModel, nearestSnap, openTop, pullStep, stuckLine } from './sheetGuard';
import { releaseSnap, rubberTop, sheetTop } from './mobile';

const VH = 844, PEEK = 107;

describe('끌던 시트 놓아 주기', () => {
  it('손이 없는데 끌기가 남아 있고 잠깐 움직임이 없으면 박힌 것', () => {
    expect(dragStale({ dragging: true, touching: false, lastMoveAt: 0, now: 1500 })).toBe(true);
    expect(dragStale({ dragging: true, touching: false, lastMoveAt: 0, now: 1499 })).toBe(false);
    expect(dragStale({ dragging: true, touching: true, lastMoveAt: 0, now: 9000 }), '손가락을 대고 멈춘 채면 그대로').toBe(false);
    expect(dragStale({ dragging: false, touching: false, lastMoveAt: 0, now: 9000 })).toBe(false);
  });
  it('놓아 줄 땐 끈 자리에서 가장 가까운 자리로', () => {
    expect(nearestSnap(437, VH, PEEK)).toBe('half'); // 반 = 295, 살짝 = 737
    expect(nearestSnap(sheetTop('peek', VH, PEEK) - 20, VH, PEEK)).toBe('peek');
    expect(nearestSnap(60, VH, PEEK)).toBe('full');
  });
});

describe('입력줄이 화면 밖 — 진단 남기고 되돌릴 때', () => {
  it('입력줄 아래가 보이는 화면 아래보다 8px 넘게 내려가면', () => {
    expect(layoutOff({ compBottom: 870, visBottom: 844, frameTop: 0, editing: false, kb: false })).toBe('comp-below');
    expect(layoutOff({ compBottom: 850, visBottom: 844, frameTop: 0, editing: false, kb: false })).toBeNull();
  });
  it('쓰는 중이 아닌데 화면 틀이 아래로 밀려 있으면', () => {
    expect(layoutOff({ compBottom: 844, visBottom: 844, frameTop: 58, editing: false, kb: false })).toBe('frame-shift');
  });
  it('쓰는 중·키보드가 떠 있는 동안은 iOS 가 화면을 옮기니 안 본다', () => {
    expect(layoutOff({ compBottom: 900, visBottom: 844, frameTop: 58, editing: true, kb: false })).toBeNull();
    expect(layoutOff({ compBottom: 900, visBottom: 844, frameTop: 58, editing: false, kb: true })).toBeNull();
  });
});

describe('키보드가 떠 있을 때 시트 위 끝', () => {
  // UI 재조사(2026-10-11): 키보드에 반·전체 시트가 위 24px 에 서서 머리줄(프사·이름)이 시트 둥근 모서리에 22px 걸쳐 잘렸다
  it('반·전체는 보이는 화면 맨 위까지 — 머리줄을 반쯤 걸치지 않는다', () => {
    expect(openTop('half', 508, PEEK, true)).toBe(0);
    expect(openTop('full', 508, PEEK, true)).toBe(0);
  });
  it('살짝은 그대로, 키보드가 없으면 예전 자리', () => {
    expect(openTop('peek', 508, PEEK, true)).toBe(sheetTop('peek', 508, PEEK));
    expect(openTop('full', VH, PEEK, false)).toBe(sheetTop('full', VH, PEEK));
    expect(openTop('half', VH, PEEK, false)).toBe(sheetTop('half', VH, PEEK));
  });
});

// 공용 시트(ui/mobile/BottomSheet·useSheetDrag, 2026-10-11) — 채팅 시트·아래 시트가 같은 끌기 판단을 쓴다. 화면마다 따로 짜던 속도·목록 끌기·박힘 풀기를 한 벌로
describe('공용 끌기 판단', () => {
  it('놓는 속도는 놓기 직전 0.1초 동안(px/ms, 아래 +)', () => {
    const trail = [{ t: 0, y: 0 }, { t: 50, y: 10 }, { t: 900, y: 100 }, { t: 950, y: 140 }];
    expect(flickV(trail, 1000, 180)).toBeCloseTo(80 / 100); // 900→1000 사이
    expect(flickV([], 1000, 180)).toBe(0);
  });
  it('목록 맨 위에서 아래로 5px 넘게 = 시트 끌기, 위로·스크롤된 목록 = 목록 스크롤, 그 사이 = 기다림', () => {
    expect(pullStep({ dy: 6, scrollTop: 0 })).toBe('drag');
    expect(pullStep({ dy: 3, scrollTop: 0 })).toBe('wait');
    expect(pullStep({ dy: -6, scrollTop: 0 })).toBe('scroll');
    expect(pullStep({ dy: 30, scrollTop: 12 })).toBe('scroll');
  });
});

describe('아래 시트(열림·닫힘 두 자리)', () => {
  const m = modalModel(400);
  it('80px 넘게 내리거나 아래로 튕기면 닫고, 위로 튕기면 그대로', () => {
    expect(m.release(0, 100, 0.1)).toBe('closed');
    expect(m.release(0, 40, 0.1)).toBe('open');
    expect(m.release(0, 40, 0.8)).toBe('closed');
    expect(m.release(0, 120, -0.8)).toBe('open');
  });
  it('끄는 중 위로는 고무줄(35%), 아래로는 손가락 그대로', () => {
    expect(m.rubber(-100)).toBe(-35);
    expect(m.rubber(120)).toBe(120);
  });
  it('박혀서 놓아 줄 땐 시트 높이 반을 넘게 내려가 있었으면 닫힘', () => {
    expect(m.nearest(250)).toBe('closed');
    expect(m.nearest(150)).toBe('open');
    expect(m.rest).toBe(0);
  });
});

describe('채팅 시트(살짝·반·전체)도 같은 틀', () => {
  it('자리·고무줄·놓기·가까운 자리가 원래 판단과 같다', () => {
    const m = chatModel('half', VH, PEEK, false);
    expect(m.rest).toBe(openTop('half', VH, PEEK, false));
    expect(m.nearest(437)).toBe(nearestSnap(437, VH, PEEK));
    expect(m.release(295, 600, 0.1)).toBe(releaseSnap('half', 295, 600, 0.1, VH, PEEK));
    expect(m.rubber(-50)).toBe(rubberTop(-50, VH, PEEK));
    expect(chatModel('full', VH, PEEK, true).rest, '키보드가 떠 있으면 보이는 화면 맨 위').toBe(0);
  });
});

describe('박힘 풀기 진단 줄(phone-layout.jsonl) — 어느 시트였는지 같이', () => {
  it('숫자·짧은 낱말만, 시트 종류가 붙는다', () => {
    expect(stuckLine({ sheet: 'pick', why: 'hide', at: 212.4, to: 'closed', vh: 844 })).toBe('sheet=pick why=hide at=212 to=closed vh=844');
    expect(stuckLine({ sheet: 'chat', why: 'stale', at: 437, to: 'half', vh: 844, from: 'peek' })).toContain('sheet=chat');
  });
});

describe('logShown — 끄는 동안의 시트 몸(2026-10-12 사용자 "끌고 있을 때 그러는 거야")', () => {
  // 하네스(402×874): 살짝에서 손잡이를 80·250·450 끄는 동안 시트 아래는 874 그대로, 입력줄 아래만 794·624·424 — 빈 칸 = 끈 거리.
  // 살짝은 끄는 동안에도 snap=peek 라 대화 칸(flex:1)이 없어 늘어난 시트가 입력줄 밑에서 비었다
  it('살짝에서 끄는 중이면 대화 칸을 그린다', () => expect(logShown('peek', true)).toBe(true));
  it('살짝에 쉬고 있으면 안 그린다', () => expect(logShown('peek', false)).toBe(false));
  it('반·전체는 늘 그린다', () => {
    expect(logShown('half', false)).toBe(true);
    expect(logShown('full', true)).toBe(true);
  });
});
