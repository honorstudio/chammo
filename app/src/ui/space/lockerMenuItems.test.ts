import { describe, expect, it } from 'vitest';
import { folderItems, menuItems } from './lockerMenuItems';

describe('menuItems — 묶음을 메뉴 줄로', () => {
  const run = () => {};
  it('실행이 없는 항목은 빠지고, 묶음 사이에 줄(sep)', () => {
    const m = menuItems([['open', 'big'], ['rename'], ['trash']], { open: { run }, rename: { run }, trash: { run } });
    expect(m.map((x) => [x.label, !!x.sep, !!x.danger])).toEqual([['열기', false, false], ['이름 바꾸기', true, false], ['휴지통으로', true, true]]);
  });
  it('빈 묶음은 줄도 안 남긴다', () => {
    const m = menuItems([['open'], ['alias'], ['reveal']], { open: { run }, reveal: { run } });
    expect(m.map((x) => !!x.sep)).toEqual([false, true]);
  });
  it('이름을 따로 줄 수 있다(참모 이름 보내기)', () => {
    expect(menuItems([['send']], { send: { run, label: '운영에게 보내기' } })[0]?.label).toBe('운영에게 보내기');
  });
  it('폴더 고르기 — 여러 층은 ›', () => {
    expect(folderItems([{ rel: '자료' }, { rel: '자료/10월' }], run).map((x) => x.label)).toEqual(['자료', '자료 › 10월']);
  });
});
