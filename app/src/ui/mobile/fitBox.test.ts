// 입력칸 자동 높이 — 재는 동안 카드 높이를 붙들어 대화 목록이 잠깐도 안 커지게(11-08 사용자 폰: 글자마다 글 칸을 접었다 펴는 사이
// 목록이 커지며 사파리가 스크롤을 1줄 기준 끝으로 깎아 마지막 말이 입력칸에 가렸다 — 하네스 6줄 91px·칩 141px)
import { describe, expect, it } from 'vitest';
import { fitBox } from './fitBox';

/** 가짜 글 칸·카드 — 글 칸 높이를 읽는 순간(접힌 채) 카드를 붙들고 있었는지 적는다 */
function fake(content: number, card: number) {
  const holds: string[] = [];
  const hold = { style: { minHeight: '' }, offsetHeight: card };
  const box = {
    style: { height: '34px', overflowY: '' },
    get scrollHeight() { holds.push(`${this.style.height}|${hold.style.minHeight}`); return content; },
  };
  return { box, hold, holds };
}

describe('fitBox — 글 칸 높이 맞추기', () => {
  it('글만큼 늘고, 한도를 넘으면 한도에서 멈추고 안에서 스크롤', () => {
    const a = fake(82, 140);
    fitBox(a.box, a.hold, 139);
    expect(a.box.style.height).toBe('82px');
    expect(a.box.style.overflowY).toBe('hidden');
    const b = fake(300, 140);
    fitBox(b.box, b.hold, 139);
    expect(b.box.style.height).toBe('139px');
    expect(b.box.style.overflowY).toBe('auto');
  });
  it('글 칸을 접어 재는 동안 카드는 지금 높이로 붙들려 있다 — 그 아래 대화 목록이 커졌다 줄며 스크롤을 깎지 않게', () => {
    const f = fake(106, 186);
    fitBox(f.box, f.hold, 139);
    expect(f.holds.length).toBeGreaterThan(0);
    for (const h of f.holds) expect(h).toBe('auto|186px');
  });
  it('다 재고 나면 붙든 걸 푼다 — 글을 지우면 카드가 다시 줄 수 있게', () => {
    const f = fake(34, 186);
    fitBox(f.box, f.hold, 139);
    expect(f.hold.style.minHeight).toBe('');
  });
});
