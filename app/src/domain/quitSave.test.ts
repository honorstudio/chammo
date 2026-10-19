import { describe, expect, it } from 'vitest';
import { savingText } from './quitSave';

// 2026-10-19 끄기 QA — ⌥⌘Q 뒤 Craft 저장(433MB PSD 같은)을 말없이 붙잡고 있었다. 무엇을 몇 초째 저장하는지 보여 주고 건너뛸 수 있게
describe('끌 때 Craft 저장 글', () => {
  it('앱 이름과 지난 초', () => {
    expect(savingText(['참모 포토'], 4)).toBe('참모 포토 저장 중 · 4초');
    expect(savingText(['참모 포토', 'GridCraft'], 12)).toBe('참모 포토·GridCraft 저장 중 · 12초');
  });
  it('0초는 안 붙인다', () => {
    expect(savingText(['참모 포토'], 0)).toBe('참모 포토 저장 중');
  });
});
