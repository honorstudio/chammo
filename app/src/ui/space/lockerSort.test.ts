// 참모 보관함 줄(295.png — '10/25 18:00' 이 종류 딱지와 겹쳐 잘림)·정렬 단추
import { describe, expect, it } from 'vitest';
import page from './LockerPage.tsx?raw';
import css from './locker.css?raw';

describe('참모 보관함 줄 — 시각은 오른쪽 끝 칸', () => {
  it('시각 칸이 맨 뒤, 날짜까지 들어가는 폭(84px)·오른쪽 맞춤', () => {
    expect(css.length).toBeGreaterThan(0);
    const row = css.split('\n').find((l) => l.startsWith('.lk-lrow {')) ?? '';
    expect(row).toContain('grid-template-columns: 40px minmax(0, 1fr) minmax(0, 200px) minmax(0, 110px) 84px;');
    expect(css).toMatch(/\.lk-ltime \{[^}]*text-align: right;/);
    const cells = page.slice(page.indexOf('const cells = (title'), page.indexOf('if (naming !== null)'));
    expect(cells.indexOf('lk-ltime')).toBeGreaterThan(cells.indexOf('lk-lwhat'));
  });
  it('폴더 안 정렬은 팀 보관함과 같은 SortButton(이름·날짜·크기), 고른 건 기억', () => {
    expect(page).toContain("const LK_SORTS = ['name', 'at', 'size'] as const;");
    expect(page).toContain('<SortButton keys={LK_SORTS} value={sort} onChange={(x) => { setSort(x); saveLkSort(x); }} />');
    expect(page).toContain('const files = sortList(kids.filter((e) => !e.dir), sort, lkVals);');
  });
});
