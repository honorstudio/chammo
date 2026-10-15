import { describe, expect, it } from 'vitest';
import bar from './ActivityBar.tsx?raw';
import css from './locker.css?raw';

const rule = (sel: string) => css.match(new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))?.[2] ?? '';

// 2026-10-11 사용자(184.png): 세션 이름이 길면 옆 항목과 글자가 겹쳤다('sheet-demo / sheet-demo-run' 이 다음 칸을 덮음) —
// 이름(b)이 nowrap 인데 안 잘려서, 칸이 줄면 칸 밖으로 삐져나왔다
describe('보관함 아래 활동 줄 — 긴 이름', () => {
  it('항목은 안 눌리고 최대 폭까지, 넘치면 항목 줄만 가로로 민다(오른쪽 대화 %·펼치기는 제자리)', () => {
    expect(css.length).toBeGreaterThan(0);
    expect(rule('.lk-act-list')).toMatch(/overflow-x: auto/);
    expect(rule('.lk-act-list')).toMatch(/min-width: 0/);
    expect(rule('.lk-act-s')).toMatch(/flex: none/);
    expect(rule('.lk-act-s')).toMatch(/max-width: \d+px/);
  });
  it('이름도 말줄임(…) — 칸 밖으로 안 나간다', () => {
    const b = rule('.lk-act-s b');
    expect(b).toMatch(/overflow: hidden/);
    expect(b).toMatch(/text-overflow: ellipsis/);
    expect(b).toMatch(/min-width: 0/);
  });
  it('마우스를 올리면 전체 이름(+ 마지막 한 줄)', () => {
    expect(bar).toMatch(/title=\{l\.line \? `\$\{l\.name\} — \$\{l\.line\}` : l\.name\}/);
    expect(bar).toMatch(/<div className="lk-act-list" onWheel=/); // 마우스 휠도 옆으로
  });
});
