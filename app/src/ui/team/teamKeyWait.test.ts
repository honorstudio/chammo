// 새로 든 팀원 기기(11-02 교육 시연) — 열쇠를 기다리는 글·파일·일정이 '없음·빈 칸'으로 안 보이게 홈·보관함(데스크톱·폰)·캘린더가 같은 keyWaitNote
import { describe, expect, it } from 'vitest';
import home from './TeamHome.tsx?raw';
import locker from './TeamLocker.tsx?raw';
import cal from './TeamCal.tsx?raw';
import phoneLocker from '../mobile/PhoneTeamLocker.tsx?raw';
import post from '../../../src-tauri/src/team_post.rs?raw';

describe('열쇠 기다림 안내 배선', () => {
  it('팀 홈 — 글판 locked 로, 글이 없을 땐 아직 글이 없어요 대신', () => {
    expect(post).toContain('locked: locked_posts(&c.v.items)');
    expect(home).toContain("const wait = keyWaitNote(b?.locked ?? 0, 'post');");
    expect(home).toContain("wait || tr('아직 글이 없어요', 'No posts yet')");
  });
  it('보관함 데스크톱·폰 — 잠긴 파일 수 한 줄', () => {
    expect(locker).toContain("keyWaitNote(lockedFiles(shown?.items ?? []), 'file')");
    expect(phoneLocker).toContain("keyWaitNote(lockedFiles(v.items), 'file')");
  });
  it('캘린더 — 못 연 일정 수 띠', () => {
    expect(cal).toContain("keyWaitNote(snap.items.filter((x) => x.why && !x.del).length, 'event')");
  });
});
