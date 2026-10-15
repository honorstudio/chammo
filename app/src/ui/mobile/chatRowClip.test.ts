// 폰 채팅 접힌 줄(세션끼리 온 말·도구 줄·알림 줄)이 위아래로 잘려 보이던 것 — 채팅 칸(.m-log)은 세로 flex 인데
// 줄 몇 개가 overflow:hidden 이라 min-height 가 0 으로 잡혀, 내용이 넘치면 flex-shrink 로 글줄보다 낮게 눌렸다(2026-10-11 사용자 폰)
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rule = (sel: string) => [...css.matchAll(new RegExp(`(?:^|\\n|\\})\\s*${esc(sel)}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]!).join(';');

describe('폰 채팅 줄 높이', () => {
  it('CSS 를 읽었다(빈 글이면 시험이 헛돈다)', () => expect(css.length).toBeGreaterThan(1000));
  it('채팅 칸은 세로 flex 다(이 전제가 바뀌면 아래 시험도 다시 본다)', () => {
    expect(rule('.m-log')).toMatch(/display:\s*flex/);
    expect(rule('.m-log')).toMatch(/flex-direction:\s*column/);
  });
  it('채팅 칸 바로 아래 줄은 눌리지 않는다 — flex-shrink 0', () => {
    expect(rule('.m-log > *')).toMatch(/flex:\s*none|flex-shrink:\s*0/);
  });
  it('overflow:hidden 인 접힌 줄이 줄 높이를 글줄보다 작게 고정하지 않는다', () => {
    for (const sel of ['.m-tools, .m-note', '.m-relay']) {
      expect(rule(sel)).not.toMatch(/(^|[;\s])height:\s*\d/);
    }
  });
});
