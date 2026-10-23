// 폰 세로 스크롤 목록(세로 flex + overflow-y:auto) 바로 아래 줄은 눌리지 않아야 한다 — 참모 시트 맨 위 기기 줄(.m-far-pills, overflow-x:auto)이
// 참모가 많아 목록이 넘치면 min-height 0 으로 잡혀 12px 로 납작해졌다(있는 줄도 몰랐다, 2026-10-23 사용자 폰). chatRowClip.test 의 .m-log 와 같은 함정
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rule = (sel: string) => [...css.matchAll(new RegExp(`(?:^|\\n|\\})\\s*${esc(sel)}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]!).join(';');
const selectorsOf = (body: RegExp) => [...css.matchAll(/(?:^|\n|\})\s*([^{}@\n]+?)\s*\{([^}]*)\}/g)].filter((m) => body.test(m[2]!)).map((m) => m[1]!.trim());

describe('폰 세로 스크롤 목록의 줄 눌림', () => {
  it('CSS 를 읽었다', () => expect(css.length).toBeGreaterThan(1000));
  // 세로 flex 이면서 세로로 스크롤하는 칸 — 새로 생기면 아래 목록에 넣어야 시험이 통과한다
  const lists = selectorsOf(/flex-direction:\s*column/).filter((s) => /overflow(-y)?:\s*auto/.test(rule(s)) && !s.includes(' '));
  it('세로 스크롤 목록을 찾았다', () => expect(lists).toEqual(expect.arrayContaining(['.m-log', '.m-picker-list', '.m-home', '.m-far-body'])));
  for (const sel of ['.m-log', '.m-picker-list', '.m-home', '.m-far-body']) {
    it(`${sel} 바로 아래 줄은 flex-shrink 0`, () => expect(rule(`${sel} > *`)).toMatch(/flex:\s*none|flex-shrink:\s*0/));
  }
  it('목록에 없는 세로 스크롤 목록이 없다', () => {
    for (const s of lists) expect(rule(`${s} > *`), s).toMatch(/flex:\s*none|flex-shrink:\s*0/);
  });
});
