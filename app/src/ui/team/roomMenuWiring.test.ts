// 대화 목록 우클릭(10-26 사용자) — DOM 없이 소스로 지키는 규칙(앱 테스트엔 jsdom 이 없다). 판단은 domain/teamRoomMenu
import { describe, expect, it } from 'vitest';
import list from './TeamList.tsx?raw';
import mode from './useTeamMode.tsx?raw';
import menu from './useRoomMenu.tsx?raw';

describe('팀챗·DM 줄 우클릭', () => {
  it('우클릭은 메뉴만 — 기본 메뉴·바깥 클릭을 막고, 맥 ctrl+클릭이 열기(왼클릭)를 같이 부르지 않는다', () => {
    expect(list).toContain('onContextMenu={onMenu ? (e) => { e.preventDefault(); e.stopPropagation(); onMenu(e, c); } : undefined}');
    expect(list).toContain('onClick={(e) => { if (e.ctrlKey) return; onPick(c); }}');
  });
  it('팀 모드 목록이 메뉴를 넘기고, 숨긴 DM 은 목록에서 뺀다', () => {
    expect(mode).toContain('onMenu={roomMenu.open}');
    expect(mode).toContain('convos={shownDms(people, roomMenu.hidden)}');
  });
  it('나가기·지우기는 글자 확인 창 뒤에만, 지우기는 위험 표시', () => {
    expect(menu).toContain("ok={tr('정말 나가기', 'Leave')} danger");
    expect(menu).toContain("ok={tr('정말 지우기', 'Delete')} danger");
    expect(menu).toContain('teamRoomDelete(');
    expect(menu).toContain('teamRoomLeave(');
  });
});

describe('팀 모드에 들어가면 아무 대화도 안 고른다(10-26 사용자 — 처음 켰을 때 방을 안 누르고 싶을 수 있다)', () => {
  it('고른 게 없으면 맨 위 대화로 메우지 않는다 — 사람이 고르거나 알림·딥링크·대화로만 연다', () => {
    expect(mode).not.toContain('?? cs[0]');
    expect(mode).toContain('const cur = cs.find((c) => c.key === sel) ?? null;');
  });
  it('가운데 빈 자리는 고르라는 한 줄(대화가 아예 없을 때와 다르게)', () => {
    expect(mode).toContain("tr('대화를 고르면 여기에 열려요', 'Pick a chat to open it here')");
  });
});
