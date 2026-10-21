import { describe, expect, it } from 'vitest';
import desk from './AgentBrowser.tsx?raw';
import phone from './mobile/BrowserView.tsx?raw';

// 가지 검토(2026-10-21): 일꾼이 다시 뜨면(같은 프로필로 브라우저 다시 뜸·다시 시도·창이 가려져 3초 넘게 안 물음) 순번이 0부터라
// 칸이 든 옛 순번보다 작아져, '더 크면 새 그림'만 받던 칸은 옛 그림에 멈췄다(Rust frame_due 와 짝)
describe('세션 브라우저 그림은 순번이 다르면 받는다', () => {
  it('데스크톱 칸·폰 보기 둘 다', () => {
    for (const src of [desk, phone]) {
      expect(src).toMatch(/f\.seq !== seq\.current/);
      expect(src).not.toMatch(/f\.seq > seq\.current/);
    }
  });
});
