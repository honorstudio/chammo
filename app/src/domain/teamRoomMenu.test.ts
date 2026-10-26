import { describe, expect, it } from 'vitest';
import { hideDm, roomActs, shownDms } from './teamRoomMenu';

const dm = (peer: string, at?: number) => ({ key: `dm:${peer}`, peer, last: at == null ? null : { at } });

describe('팀챗·DM 우클릭 메뉴(10-26 사용자 "팀챗을 지울 수가 없다")', () => {
  it('팀챗 = 이름·사람 바꾸기·나가기, 지우기는 만든 사람·팀장만(맨 끝)', () => {
    expect(roomActs('group', false)).toEqual(['edit', 'leave']);
    expect(roomActs('group', true)).toEqual(['edit', 'leave', 'delete']);
  });
  it('DM 은 목록에서 숨기기만(DM 은 서버에서 못 지운다)', () => {
    expect(roomActs('dm', true)).toEqual(['hide']);
  });
});

describe('DM 숨기기 — 이 기기 목록에서만, 새 말이 오면 다시 보인다', () => {
  it('숨긴 뒤엔 안 보이고 그 뒤 온 말이 있으면 다시 보인다', () => {
    const h = hideDm({}, 'a', 100);
    expect(shownDms([dm('a', 90), dm('b')], h).map((c) => c.peer)).toEqual(['b']);
    expect(shownDms([dm('a', 120), dm('b')], h).map((c) => c.peer)).toEqual(['a', 'b']);
  });
  it('말이 없는 DM 도 숨긴다, 숨김 기록은 사람마다', () => {
    const h = hideDm(hideDm({}, 'a', 100), 'b', 100);
    expect(shownDms([dm('a'), dm('b'), dm('c')], h).map((c) => c.peer)).toEqual(['c']);
  });
});
