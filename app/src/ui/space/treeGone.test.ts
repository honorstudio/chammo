import { describe, expect, it } from 'vitest';
import view from './SpaceView.tsx?raw';
import page from './LockerPage.tsx?raw';
import items from './lockerMenuItems.ts?raw';

// 2026-10-12 사용자 "나무 칸(참모 이름 머리 + 폴더 줄)은 이제 필요 없겠다" — 홈·보관함 고정 탭이 그 일을 한다.
// 길 찾기는 표준 파일 앱처럼 가운데 경로 줄(보관함 › 자료 › 10월) + 폴더 카드, 옮기기는 끌기(폴더 카드·경로 칸) + 우클릭 '옮기기'
describe('나무 칸 없음 → 경로 줄', () => {
  it('왼쪽은 띠만(나무를 안 그린다 — LockerSide 파일은 되돌리기 쉽게 남김)', () => {
    expect(view).not.toMatch(/\{lockerSide\?\.node\}/);
    expect(view).not.toMatch(/<LockerSide /);
  });
  it('보관함 맨 위에서도 경로 줄', () => {
    const root = page.slice(page.indexOf("if (place.kind === 'root') {"), page.indexOf('const kids = kidsOf(entries, place.rel);'));
    expect(root).toMatch(/<Crumbs /);
  });
  it('경로 칸 = 누르면 거기로, 끌어 놓으면 그 폴더로(data-locker-folder·drop), 끝에 새 폴더 +', () => {
    // 읽기 전용 칸(맥 폴더 연결 안)만 빼고 — drop() 이 data-locker-folder·drop 을 건다
    expect(page).toMatch(/'data-locker-folder': r, 'data-locker-drop': r/);
    expect(page).toMatch(/\{\.\.\.drop\(c\.rel\)\}/);
    expect(page).toMatch(/label=\{tr\('여기에 새 폴더', 'New folder here'\)\}/);
  });
  it('우클릭 옮기기 → 폴더 고르기(moveTargets)', () => {
    expect(page).toMatch(/const moveItems = \(rel: string\) => moveTargets\(rel, folders\)/);
    expect(page).toMatch(/move: e && acts\.onMove && \{ sub: \(\) => moveItems\(e\.rel\)/);
    expect(items).toMatch(/move: \(\) => tr\('옮기기', 'Move to'\)/);
  });
});

// 하네스 실측: 카드를 경로 줄 '보관함'(맨 위, data-locker-folder="")에 끌어 놓으면 강조는 되는데 안 옮겨졌다 — 빈 글을 거짓으로 걸렀다
import drag from './dragPath.ts?raw';
describe('맨 위(보관함)에 끌어 놓기', () => {
  it('폴더 자리가 빈 글(맨 위)이어도 옮긴다', () => {
    expect(drag).toMatch(/if \(folder !== undefined\)/); // 묶음 끌기(paths, 2026-10-12)도 같은 검사 — 빈 글을 거짓으로 거르지 않는다
  });
});
