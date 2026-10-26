import { describe, expect, it } from 'vitest';
import { CONVO, SIDE_MIN, TEAM_LIST_W, TEAMS_W, clampConvo, convoKey, foldKey, winFit } from './teamLayout';

describe('팀 모드 대화 폭 — 채팅은 작게, 스페이스는 넓게(10-26 사용자)', () => {
  it('기본은 참모 채팅 기본(420)보다 좁다', () => {
    expect(CONVO.def).toBeLessThan(420);
    expect(clampConvo(CONVO.def)).toBe(CONVO.def);
  });
  it('끌어서 바꾼 폭은 범위 안으로, 숫자가 아니면 기본', () => {
    expect(clampConvo(10)).toBe(CONVO.min);
    expect(clampConvo(5000)).toBe(CONVO.max);
    expect(clampConvo(Number.NaN)).toBe(CONVO.def);
    expect(clampConvo('x' as unknown as number)).toBe(CONVO.def);
    expect(clampConvo(333.6)).toBe(334);
  });
  it('메인 창과 따로 창은 폭·접기를 따로 기억한다', () => {
    expect(convoKey(false)).not.toBe(convoKey(true));
    expect(foldKey(false)).not.toBe(foldKey(true));
  });
});

describe('따로 창 — 오른쪽 팀 칸이 늘 SIDE_MIN 이상(좁아서 깨지던 것)', () => {
  const room = (win: number) => win - TEAMS_W - TEAM_LIST_W - SIDE_MIN;
  it('넓은 창은 기억한 폭 그대로, 오른쪽 칸이 더 넓다', () => {
    const f = winFit(1440, CONVO.def, false);
    expect(f).toEqual({ convo: CONVO.def, max: Math.min(CONVO.max, room(1440)), narrow: false });
    expect(1440 - TEAMS_W - TEAM_LIST_W - f.convo).toBeGreaterThan(TEAM_LIST_W + f.convo);
  });
  it('창을 줄이면 대화 폭이 먼저 줄어 오른쪽 칸 SIDE_MIN 을 지킨다', () => {
    const f = winFit(1100, 600, false);
    expect(f.convo).toBe(room(1100));
    expect(1100 - TEAMS_W - TEAM_LIST_W - f.convo).toBe(SIDE_MIN);
    expect(f.narrow).toBe(false);
  });
  it('대화 최소 폭으로도 SIDE_MIN 이 안 되면 좁은 창 — 오른쪽 칸은 접고 아이콘으로', () => {
    const edge = TEAMS_W + TEAM_LIST_W + CONVO.min + SIDE_MIN;
    expect(winFit(edge, CONVO.def, false).narrow).toBe(false);
    expect(winFit(edge - 1, CONVO.def, false).narrow).toBe(true);
    expect(winFit(edge, CONVO.def, false).convo).toBe(CONVO.min);
  });
  it('메신저를 접으면 좁은 창이 아니다(오른쪽 칸이 창 전체)', () => {
    expect(winFit(700, CONVO.def, true).narrow).toBe(false);
  });
  it('끌기 최대는 창 폭에서 나오고 최소 아래로 안 내려간다', () => {
    expect(winFit(900, CONVO.def, false).max).toBe(CONVO.min);
    expect(winFit(4000, CONVO.def, false).max).toBe(CONVO.max);
  });
});
