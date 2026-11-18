import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bothShown, flagVis, makeEvery } from '../../domain/pollEvery';
import { spaceMainCovered } from '../../domain/space';

// 11-17 perf S(보인 판 ipc 4,825 > 예산): 팀 화면이 스페이스 본문을 덮어도 밑 대시보드 세션 꼬리(3초)·홈 노트·세션 탭 목록(5초)이
// 제 속도로 돌았다(read_transcript_tails ≈200·read_session_tasks·read_doc_text 각 ≈120 /10분). 덮인 동안만 5배 느리게, 걷히면 밀린 한 번을 바로.
// 사람을 부르는 길(세션 목록·결정 카드·질문 넘기기)과 '띄운 걸 꺼내 보여 주기'(craft_dock·show 기록)는 그대로 — 참모-2 11-17
const space = readFileSync(new URL('./SpaceView.tsx', import.meta.url), 'utf8');

describe('스페이스 본문이 덮였나', () => {
  it('팀 화면(팀 모드 + 팀 스페이스)이나 다른 기기 보기면 덮임', () => {
    expect(spaceMainCovered({ on: true, space: {} }, undefined)).toBe(true);
    expect(spaceMainCovered(undefined, { main: null })).toBe(true);
  });
  it('팀 모드라도 팀 스페이스가 없으면(레일만) 참모 스페이스가 보인다', () => {
    expect(spaceMainCovered({ on: true }, undefined)).toBe(false);
    expect(spaceMainCovered({ on: false, space: {} }, undefined)).toBe(false);
    expect(spaceMainCovered(undefined, undefined)).toBe(false);
  });
});

describe('덮인 동안 3초 꼬리 읽기', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('덮이면 15초, 걷히면 밀린 한 번을 바로', () => {
    const app = flagVis(true), cover = flagVis(true);
    let n = 0;
    makeEvery(bothShown(app, cover), () => Date.now())(() => n++, 3000);
    vi.advanceTimersByTime(3000);
    expect(n).toBe(1);
    cover.set(false); // 팀 화면을 열었다
    vi.advanceTimersByTime(14_999);
    expect(n).toBe(1);
    vi.advanceTimersByTime(1);
    expect(n).toBe(2);
    vi.advanceTimersByTime(4000); // 3초가 지났다 — 걷히면 바로
    cover.set(true);
    vi.advanceTimersByTime(0);
    expect(n).toBe(3);
    vi.advanceTimersByTime(3000); // 다시 원래 주기
    expect(n).toBe(4);
  });
});

describe('SpaceView 배선', () => {
  it('덮임 주기는 스페이스 본문이 덮였나로 만든다', () => {
    expect(space).toMatch(/const everyMain = useCoverEvery\(spaceMainCovered\(team, far\)\)/);
  });
  it('대시보드 세션 꼬리·홈 노트·세션 탭 목록은 덮임 주기로', () => {
    expect(space).toMatch(/const stop = everyMain\(tick, 3000\)/);
    expect(space.match(/const stop = everyMain\(\(\) => void tick\(\), 5000\)/g)?.length).toBe(2);
  });
  it('띄운 걸 팀 모드에서 꺼내 보여 주는 craft_dock 은 원래 주기 그대로', () => {
    expect(space).toMatch(/const stop = every\(tick, 2000\); \/\/ 앱이 뒤면 5배 느리게/);
  });
});
