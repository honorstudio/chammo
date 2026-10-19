import { describe, expect, it } from 'vitest';
import { boxOf, coveredAt, craftAppOf, craftKey, sameBox, shown, wantStill, leftCraft } from './craftTab';

describe('Craft 스페이스 탭', () => {
  it('탭 열쇠 k:<앱>', () => {
    expect(craftKey('photocraft')).toBe('k:photocraft');
    expect(craftAppOf('k:photocraft')).toBe('photocraft');
    expect(craftAppOf('d:/x.png')).toBe('');
  });

  it('칸 자리는 정수로, 같으면 안 보낸다', () => {
    const b = boxOf({ left: 10.4, top: 80.6, width: 900.2, height: 600 });
    expect(b).toEqual([10, 81, 900, 600]);
    expect(sameBox(b, [10, 81, 900, 600])).toBe(true);
    expect(sameBox(null, b)).toBe(false);
  });

  it('덮였거나 칸이 없으면 숨긴다', () => {
    expect(shown([0, 0, 900, 600], false)).toBe(true);
    expect(shown([0, 0, 900, 600], true)).toBe(false);
    expect(shown([0, 0, 0, 600], false)).toBe(false);
  });

  it('목록에 없는 팝오버도 칸 안 9점으로 잡는다', () => {
    const stage = { id: 'stage' };
    const pop = { id: 'pop' };
    const inside = (el: unknown) => el === stage;
    expect(coveredAt([0, 0, 1000, 600], () => stage, inside)).toBe(false);
    // 오른쪽 위 구석(900,60)만 결정 대기함 팝오버가 덮음
    expect(coveredAt([0, 0, 1000, 600], (x, y) => (x > 800 && y < 100 ? pop : stage), inside)).toBe(true);
    expect(coveredAt([0, 0, 0, 0], () => pop, inside)).toBe(false);
  });
});

describe('덮일 때 마지막 프레임(2026-10-19 실사용 — 결정 대기함이 뜨면 칸이 통째로 검게)', () => {
  it('칸이 보일 크기인데 덮였을 때만 그림을 깐다 — 탭이 내려간(크기 0) 건 아니다', () => {
    expect(wantStill([0, 0, 800, 600], true)).toBe(true);
    expect(wantStill([0, 0, 800, 600], false)).toBe(false);
    expect(wantStill([0, 0, 0, 0], true)).toBe(false);
    expect(wantStill([0, 0, 30, 600], true)).toBe(false);
  });
});

describe('Craft 글자 탭 없이 — 다른 탭으로 옮기면 숨기기(2026-10-19 사용자 "스페이스 탭이 겹친다")', () => {
  it('Craft 칸에서 다른 데로 옮기면 그 앱', () => {
    expect(leftCraft('k:vectorcraft', 'k:@apps')).toBe('vectorcraft');
    expect(leftCraft('k:vectorcraft', '')).toBe('vectorcraft');
    expect(leftCraft('k:gridcraft', 'k:vectorcraft')).toBe('gridcraft');
  });
  it('같은 칸이거나 Craft 칸이 아니었으면 없음 — 앱 서랍(k:@apps)도 Craft 앱 칸이 아니다', () => {
    expect(leftCraft('k:vectorcraft', 'k:vectorcraft')).toBeNull();
    expect(leftCraft('/a/b.md', 'k:vectorcraft')).toBeNull();
    expect(leftCraft('k:@apps', '/a/b.md')).toBeNull();
  });
});
