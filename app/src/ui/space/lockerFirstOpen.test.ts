import { describe, expect, it } from 'vitest';
import { isLockerOpen, parseLkPick } from '../../domain/lockerTree';
import space from './SpaceView.tsx?raw';
import hook from './useLocker.ts?raw';

// 0.3.0 2차 검증 — 앱을 켜자마자 ~/Documents/Chammo 를 만들고 바탕화면을 '스크린샷'으로 이어 맥 권한 창이 설명 없이 떴다.
// 보관함은 사람이 처음 열 때 만든다(Rust tree_at·migrate_all 이 표식으로 지킨다). 이미 쓰던 사람은 표식이 있어 그대로
describe('보관함 처음 열기', () => {
  it('홈은 보관함을 연 게 아니다, 보관함 맨 위·폴더는 연 것', () => {
    expect(isLockerOpen(parseLkPick('l:o1#h'))).toBe(false);
    expect(isLockerOpen(null)).toBe(false);
    expect(isLockerOpen(parseLkPick('l:o1'))).toBe(true);
    expect(isLockerOpen(parseLkPick('l:o1#d:자료'))).toBe(true);
    expect(isLockerOpen(parseLkPick('l:o1#p:shop'))).toBe(true);
  });
  it('나무 읽기가 open 을 넘긴다', () => {
    expect(hook).toMatch(/invoke<LkTree>\('locker_tree', \{ id, name, open \}\)/);
  });
  it('옮기기(스크린샷 연결)는 보관함이 시작된 뒤에만', () => {
    expect(space).toMatch(/if \(migrated\.current \|\| !orchs\.length \|\| !lockerTree\.started\) return;/);
    expect(space).toMatch(/useLockerTree\(lockerOrch \? lockerOwner\(lockerOrch\) : null, 5000, isLockerOpen\(lp\)\)/);
  });
});
