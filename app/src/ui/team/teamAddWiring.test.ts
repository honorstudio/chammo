// 팀 여러 개 화면 연결(11-02, 시안 team-add v1 — PC A 레일 + 두 줄 메뉴 + C 목록 머리 칩 ▾, 폰 B2 머리 팀 줄 +) — DOM 없이 소스로 지킨다
import { describe, expect, it } from 'vitest';
import rail from './TeamRail.tsx?raw';
import mode from './useTeamMode.tsx?raw';
import start from './TeamStart.tsx?raw';
import profiles from './useProfiles.ts?raw';

describe('데스크톱 레일 — 팀 줄 + 맨 아래 +', () => {
  it('팀은 teamStack 순서 그대로 쌓는다(바꿔도 자리가 안 움직인다)', () => {
    expect(rail).toContain('stack.map(');
    expect(mode).toContain('teamStack(view)');
  });
  it('맨 아래 + 는 아이콘만(이름은 aria-label·툴팁) — 참모 + 와 같은 rail-new 모양, .lk-av 가 아니라 참모 순서 바꾸기에 안 낀다', () => {
    expect(rail).toMatch(/<IconButton size="l" className="rail-new tmx-rail-add" label=\{tr\('팀 추가', 'Add a team'\)\}/);
    expect(rail).toContain('<IconPlus />');
  });
  it('팀이 없어도 레일엔 구분선 + 하나 — rail 이 팀 있을 때만 그려지지 않는다', () => {
    expect(mode).not.toMatch(/rail: team \? \(/);
    expect(mode).toMatch(/rail: \(\s*<ProfilesCtx\.Provider/);
  });
  it('+ 메뉴는 새 팀 만들기·초대 링크로 들어가기 두 줄(글자만)', () => {
    expect(mode).toContain('addMenu(');
    expect(rail).toContain("tr('새 팀 만들기', 'Create a team')");
    expect(rail).toContain("tr('초대 링크로 들어가기', 'Join with an invite link')");
  });
});

describe('목록 머리 팀 이름 칩 ▾(보조) — 같은 목록·같은 두 줄', () => {
  it('팀 이름이 누를 수 있는 단추고 메뉴는 teamListMenu', () => {
    expect(mode).toMatch(/className="tmx-list-chip"[^>]*aria-haspopup="menu"/);
    expect(mode).toContain('teamListMenu(');
    expect(rail).toContain('export function teamListMenu(');
  });
});

describe('만들기·들어가기 창 — 팀이 있어도 열리고 내 이름 칸', () => {
  it('겹창 종류 make·join 은 TeamStart want 로 — 팀이 있어도 만들기(wantMake)', () => {
    expect(mode).toMatch(/kind\?: 'start' \| 'link' \| 'settings' \| 'room' \| 'make' \| 'join'/);
    expect(start).toContain("wantMake: want === 'make'");
  });
  it('이 팀에서 보일 내 이름 칸 — 기본값 defaultMe, 만들기·들어가기 둘 다 넘긴다', () => {
    expect(start).toContain('defaultMe(view)');
    expect(start).toContain('teamCreate(name, me)');
    expect(start).toContain('teamJoin(code, me)');
  });
  it('같은 이름은 막지 않고 경고 한 줄', () => {
    expect(start).toContain('sameTeamName(name, view?.teams)');
  });
  it('만든 직후 제목·나중에 보내기', () => {
    expect(start).toContain('팀을 만들었어요');
    expect(start).toContain("tr('나중에 보내기', 'Send later')");
  });
});

describe('팀 바꿀 때 섞이지 않게(데스크톱) — 늦게 온 앞 팀 응답', () => {
  it('프로필판: 읽는 사이 팀이 바뀌었으면 앞 팀 이름·사진·팀 아이콘·판 번호를 안 앉힌다(그 판 번호로 새 팀을 물으면 그대로로 굳는다)', () => {
    expect(profiles).toContain('const cur = useRef(teamId);');
    expect(profiles).toContain('cur.current = teamId;');
    expect(profiles).toMatch(/if \(b\.team !== teamId \|\| cur\.current !== teamId\) return;/);
  });
  it('팀 홈은 팀마다 새로 그린다(key) — 앞 팀 글판·판 읽기가 늦게 와도 새 팀 화면에 안 앉는다', () => {
    expect(mode).toMatch(/home=\{<TeamHomeDesktop key=\{view\.teamId\}/);
  });
});
