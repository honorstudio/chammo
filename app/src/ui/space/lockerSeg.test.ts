import { describe, expect, it } from 'vitest';
import css from './locker.css?raw';
import page from './LockerPage.tsx?raw';
import tools from './tools.css?raw';

// 2026-10-11 사용자: 프로젝트 폴더 머리 '결과물 | 전체 파일' 켜기가 어색 — 고른 쪽은 회색 면에 테두리가 없고
// 안 고른 쪽만 테두리가 있어 획과 면 색이 따로 놀았다(안쪽 그림자 테두리를 고른 쪽 면이 덮음).
// 앱에 이미 있는 두 갈래 켜기(.tl-seg — 바깥 테두리 하나 + 고른 쪽만 흰 면·그림자)를 그대로 쓴다.
// 홈·모드 ⑨부터 그 자리는 카드/목록 바꾸기(프로젝트 폴더 머리는 없어졌다) — 같은 세그먼트를 쓴다
describe('보관함 머리 — 두 갈래 켜기', () => {
  it('앱 공용 세그먼트(.tl-seg)가 있다', () => expect(tools).toMatch(/\.tl-seg button\.on \{[^}]*background:\s*var\(--surface\)/));
  it('LockerPage 는 그 세그먼트를 쓰고 따로 만든 .lk-seg 는 없다', () => {
    expect(page).toMatch(/className="tl-seg[ "]/);
    expect(page).toMatch(/import '\.\/tools\.css'/);
    expect(page).not.toMatch(/lk-seg/);
    expect(css).not.toMatch(/\.lk-seg/);
  });
});
