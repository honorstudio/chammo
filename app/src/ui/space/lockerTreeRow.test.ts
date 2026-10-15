import { describe, expect, it } from 'vitest';
import side from './LockerSide.tsx?raw';
import css from './locker.css?raw';

// 2026-10-12 사용자(참모-2 전달, 189.png): 나무 폴더 줄에 올리면 오른쪽 새 폴더·휴지통 단추가 긴 이름('거래처 10월 보낼 것') 위에 겹쳤다
describe('나무 폴더 줄 — 단추가 이름을 안 덮는다', () => {
  it('css 를 읽었다', () => expect(css.length).toBeGreaterThan(1000));
  it('이름은 한 줄 말줄임', () => expect(css).toMatch(/\.lk-row-nm \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/));
  it('단추가 뜰 때(올림·포커스)는 그만큼 이름 칸 오른쪽을 비운다', () => expect(css).toMatch(/\.lk-row:hover \.lk-row-btn, \.lk-row:focus-within \.lk-row-btn \{ padding-right: 54px; \}/));
  it('전체 이름은 title 로', () => expect(side).toMatch(/title=\{`\$\{f\.name\}\\n\$\{tr\('두 번 눌러 이름 바꾸기'/));
});
