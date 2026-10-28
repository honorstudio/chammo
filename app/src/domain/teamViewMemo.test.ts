import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MEMO_STALE_MS, needFetch, teamViewMemo } from './teamViewMemo';

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('팀 화면 기억(teamViewMemo) — 탭을 바꿔 다시 붙어도 바로 그린다(10-28 사용자 "매번 새로 로드")', () => {
  it('팀마다 마지막 판을 기억하고, 다른 팀 것은 안 준다', () => {
    const m = teamViewMemo<{ rev: number }>();
    expect(m.get('t1')).toBeNull();
    m.put('t1', { rev: 3 }, 1000);
    expect(m.get('t1')).toEqual({ v: { rev: 3 }, at: 1000 });
    expect(m.get('t2')).toBeNull();
  });
  it('더 옛 판으로는 안 덮는다(느린 응답이 늦게 와도)', () => {
    const m = teamViewMemo<{ rev: number }>();
    m.put('t1', { rev: 5 }, 1000);
    m.put('t1', { rev: 4 }, 2000);
    expect(m.get('t1')?.v.rev).toBe(5);
    m.put('t1', { rev: 5 }, 3000);
    expect(m.get('t1')?.at).toBe(3000);
  });
  it('다시 열 때 망을 부르는 건 기억이 없거나·오래됐거나·알려진 판이 더 새로울 때만', () => {
    const at = 10_000;
    expect(needFetch(null, 0, at)).toBe(true);
    const memo = { v: { rev: 5 }, at };
    expect(needFetch(memo, 5, at + 1000)).toBe(false);
    expect(needFetch(memo, 0, at + 1000)).toBe(false); // 소켓 알림 전(0)은 모름 — 기억 그대로, 판이 오면 그때
    expect(needFetch(memo, 6, at + 1000)).toBe(true);
    expect(needFetch(memo, 5, at + MEMO_STALE_MS + 1)).toBe(true); // 소켓이 놓친 판 대비
  });
});

describe('배선 — 팀 홈·팀 보관함이 기억을 쓴다', () => {
  const locker = src('../ui/team/TeamLocker.tsx');
  const home = src('../ui/team/TeamHome.tsx');
  const cmd = src('../../src-tauri/src/team_locker_cmd.rs');
  it('보관함: 다시 붙으면 기억으로 바로 그리고(setV(null) 로 비우지 않는다), 망은 needFetch 일 때만', () => {
    expect(locker).toContain('lockerMemo.get(teamId)');
    expect(locker).toContain('lockerMemo.put(teamId');
    expect(locker).not.toMatch(/setV\(null\); setPlace/);
    expect(locker).toContain('needFetch(');
  });
  it('보관함 2초 확인은 자기가 본 판(seen)을 들고 묻는다 — 다른 화면이 판을 먹어도 놓치지 않게', () => {
    expect(locker).toMatch(/'team_locker_poll', \{ team: teamId, seen:/);
    expect(cmd).toMatch(/pub fn team_locker_poll\([^)]*seen: Option<u64>/);
    expect(cmd).toContain('app::changed_since(&team, s)');
  });
  it('팀 홈: 기억한 글판으로 바로 그리고 본 판을 들고 읽는다(그대로면 망 없음)', () => {
    expect(home).toContain('boardMemo.get(teamId)');
    expect(home).toContain('boardMemo.put(');
    expect(home).not.toMatch(/setB\(null\);\s*\n\s*setOpen\(null\);/);
  });
});
