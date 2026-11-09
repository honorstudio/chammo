// 고정 탭은 아이콘만 있는 탭 — 글자 탭 여백을 받으면 아이콘이 한쪽으로 쏠린다(11-04)
import { describe, expect, it } from 'vitest';
import css from '../space/locker.css?raw';

describe('팀 스페이스 아이콘 탭', () => {
  it('메모리 탭도 아이콘 탭 여백·켜짐 색을 받는다', () => {
    expect(css).toContain('.lk-tab.home, .lk-tab.folder, .lk-tab.cal, .lk-tab.memory { position: relative; flex: none; padding: 0 11px; }');
    expect(css).toContain('.lk-tab.cal.on svg, .lk-tab.memory.on svg { color: var(--text); }');
  });
});
