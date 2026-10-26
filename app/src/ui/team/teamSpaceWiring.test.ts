// 팀 모드(시안 team-space v1 A, 10-26 사용자 "추천대로") — DOM 없이 소스로 지키는 규칙(앱 테스트엔 jsdom 이 없다)
import { describe, expect, it } from 'vitest';
import mode from './useTeamMode.tsx?raw';
import rail from './TeamRail.tsx?raw';
import space from './TeamSpace.tsx?raw';
import view from '../space/SpaceView.tsx?raw';
import app from '../../App.tsx?raw';
import home from './TeamHome.tsx?raw';
import messenger from './MessengerApp.tsx?raw';
import openChat from '../chat/openChatFile.ts?raw';
import css from './team.css?raw';
import teamSpace from './TeamSpace.tsx?raw';

describe('팀 모드 = 띠에서 고른 것이 화면 전체의 주인', () => {
  it('띠 팀 표를 누르면 팀 모드 — 방·DM 프사를 띠에 펼치지 않는다', () => {
    expect(rail).toContain('onClick={onTeam}');
    expect(mode).toContain('onTeam={() => setOn(true)}');
    expect(rail).not.toContain('convos.map');
  });
  it('가운데는 팀 모드일 때만 — 대화 목록(TeamList) + 대화(TeamConvo)', () => {
    expect(mode).toMatch(/chat: on && team && view && feed \? \(/);
    expect(mode).toContain('<TeamList convos={shownDms(people, roomMenu.hidden)} rooms={rooms}');
    expect(mode).toContain('<TeamConvo key={`${cur.key}:${seed?.n ?? 0}`} seed={seed?.text}'); // 팀 홈 글 '대화로' — 입력칸 첫 글
  });
  it('팀 스페이스 탭 줄 = 팀 홈·팀 보관함·연 파일 + 팀 설정 — Craft·참모 보관함 탭은 없다', () => {
    expect(space).toContain('<IconHome />');
    expect(space).toContain('<IconFolder />');
    expect(space).toContain('<IconSettings />');
    expect(space).not.toMatch(/IconApps|APPS_KEY|CraftPane|craft_/);
  });
  it('스페이스는 팀 모드면 팀 것만 그린다(참모 탭 줄·독 없음), 참모 탭 줄엔 팀 탭이 없다', () => {
    expect(view).toContain('if (teamOn && team?.space) { main = team.space.view((p) => filePage(p, {})); framed = true; }');
    expect(view).not.toContain('tmx-ttab');
    expect(view).not.toContain("'tm:'");
  });
  it('팀 모드에서 누른 파일(팀 대화 풍선·팀 보관함)은 팀 탭 줄에, 참모가 띄운 것은 참모 화면으로 돌아가 보인다', () => {
    expect(view).toContain('if (team?.on && team.space) { team.space.open(d.path); return; }');
    expect(view).toMatch(/const present = \(f: DashFile\) => \{\n\s*if \(team\?\.on\) team\.onLeave\(\);/);
  });
  it('참모로 돌아가기 = 띠의 참모 프사·홈·도우미·기능 화면', () => {
    expect(view).toContain('team?.onLeave(); // 메신저 대화를 보던 중이면');
    expect(view).toContain("onOpen: () => { team?.onLeave(); setPick(HOME, 'home'); }");
    expect(view).toContain("if (req !== 'close' && team?.on) team.onLeave();");
  });
  it('앱은 팀 모드를 스페이스에 넘기고, 팀 모드면 채팅 칸 = 목록 + 대화', () => {
    expect(app).toContain('on: teamMode.on,');
    expect(app).toContain('flex: `0 0 ${chatW}px`');
  });
});

describe('팀 홈 글·고정 공지(시안 team-space H)', () => {
  it('글은 teamPostApi(보관함 봉투 길)로만 — 화면이 invoke 를 직접 안 부른다', () => {
    expect(home).toContain("from '../../data/teamPostApi'");
    expect(home).not.toMatch(/invoke\(/);
  });
  it('고정 공지 단추·스위치는 팀장만, 고치기는 글쓴이만, 지우기는 글쓴이·팀장', () => {
    expect(home).toContain('{b?.owner && <IconButton label={b.pinned === cur.id');
    expect(home).toContain('{b?.owner && <label className="tmp-sw tmh-sw">');
    expect(home).toContain("{cur.mine && <IconButton label={tr('고치기', 'Edit')}");
    expect(home).toContain('{(cur.mine || b?.owner) && <IconButton');
  });
  it('지우기는 Confirm 의 onOk 안에서만', () => {
    const at = home.indexOf('teamPostRemove(teamId');
    expect(at).toBeGreaterThan(0);
    expect(home.slice(Math.max(0, at - 300), at)).toContain('onOk=');
  });
  it("팀 모두에게 바로 보이는 '올리기'는 글자 단추", () => {
    expect(home).toContain("tr('올리기', 'Post')");
  });
});

describe('메신저 따로 창 = 팀 모드와 같은 조각(10-26 사용자 "참모만 안 뜨면 돼")', () => {
  it('c=all 은 useTeamMode(alone) 의 가운데·팀 칸·팝업을 그대로 — 참모 띠·채팅은 없다', () => {
    expect(messenger).toContain("useTeamMode({ handoff: () => handoff, wide: false, alone: true, room })");
    expect(messenger).toContain('{tm.chat ??');
    expect(messenger).toContain('tm.space.view((p) => <TeamFile');
    expect(messenger).not.toMatch(/SessionGrid|OrchRail|ChatView/);
  });
  it('alone 창은 창 다시 열기·딥링크를 안 하고(메인 창 일), 누른 파일은 리더 대신 그 창 팀 탭에', () => {
    expect(mode.match(/if \(alone\) return;/g)?.length).toBe(2);
    expect(mode).toContain('fileHere.open = (p) => openRef.current(p);');
    expect(openChat).toContain('if (fileHere.open) { fileHere.open(path); return; }');
  });
  it('좁은 창이면 팀 칸을 접고 아이콘으로 연다 — 파일을 열면 저절로 펼친다', () => {
    expect(messenger).toContain('const showSide = !narrow || side;');
    expect(messenger).toContain('if (files > seenFiles) setSide(true);');
  });
});

describe("'전체' 팀챗 자동(domain/teamAllRoom)", () => {
  it('메인 창(alone 아님)에서만, 같은 계획은 한 번만 시도한다', () => {
    expect(mode).toContain('if (alone || !view?.joined) return;\n    const plan = allRoomPlan(view);');
    expect(mode).toContain('if (tried.current === key) return;');
  });
});

/** App 안 한 함수 몸통(다음 `const 이름 =` 또는 `runRef.current` 전까지) — 그 안에 무엇이 있나만 본다 */
const body = (src: string, start: string) => { const i = src.indexOf(start); expect(i).toBeGreaterThan(-1); const rest = src.slice(i + start.length); const j = rest.search(/\n {2}const [a-zA-Z]+ = |\n\s+\/\/ ⌃⇧PageUp/); return rest.slice(0, j < 0 ? undefined : j); };

describe('팀 모드에서 참모로 가는 길은 팀 모드부터 끈다(10-26 사용자 — ⌘1·⌘2·종 열기가 안 먹었다)', () => {
  it('⌘1~9(참모 N번) — 팀 대화가 덮은 채 밑 채팅만 바뀌지 않게', () => {
    const num = body(app, "if (sc.type === 'num') {");
    expect(num).toContain('teamMode.leave();');
    expect(num.indexOf('teamMode.leave();')).toBeLessThan(num.indexOf("'chat-tab-pick'"));
  });
  it('결정 대기함·알림의 열기(↗) = openTarget — 그 참모·세션으로 가기 전에 팀 모드를 끈다', () => {
    expect(body(app, 'const openTarget = (target: string) => {')).toContain('teamMode.leave();');
  });
  it('새로 만든·홈에서 고른 참모로 가기(goOrch)도', () => {
    expect(body(app, 'const goOrch = (id: string) => {')).toContain('teamMode.leave();');
  });
});

describe('팀 모드 폭 — 채팅 작게·스페이스 넓게, 경계를 끌어 바꾸고 기억(10-26 사용자)', () => {
  it('메인 창: 팀 모드 채팅 칸은 참모 채팅 폭과 따로(teamMode.convo) — 같은 Grip 하나로 끈다', () => {
    expect(app).toContain('const chatW = teamMode.chat ? teamMode.convo + teamMode.listW : chatWidth;');
    expect(app).toContain('onWidth={(w) => (teamMode.chat ? teamMode.setConvo(w - teamMode.listW) : setChatWidth(w))}');
    expect(app.match(/<Grip /g)?.length).toBe(2); // 새 손잡이를 짜지 않는다 — 채팅 칸·작업 패널 둘 그대로
  });
  it('따로 창: 고정 clamp 폭 대신 같은 Grip, 오른쪽 칸 최소는 domain/teamLayout winFit', () => {
    expect(css).not.toContain('clamp(560px, 48%, 760px)');
    expect(messenger).toContain("import { Grip } from '../TaskPanel';");
    expect(messenger).toContain('winFit(');
  });
});

describe('메신저 접기 — 팀 홈·보관함만 크게(10-26 사용자)', () => {
  it('접기는 대화 목록 머리, 펴기는 팀 스페이스 탭 줄 앞 — 둘 다 같은 아이콘(직접 그린 SVG)', () => {
    expect(mode).toContain("label={tr('메신저 접기', 'Collapse the messenger')}");
    expect(teamSpace).toContain("label={tr('메신저 펴기', 'Expand the messenger')}");
    expect(mode).toContain('<IconPanelLeft />');
    expect(teamSpace).toContain('<IconPanelLeft />');
  });
  it('메인 창은 채팅 칸을 숨기기만(참모 터미널 붙임 그대로) — 지우지 않는다', () => {
    expect(view).toContain('hidden={(atHomePick && !teamOn) || (teamOn && !!team?.fold)}');
    expect(app).toContain('fold: teamMode.fold }}');
  });
  it('따로 창은 접으면 가운데를 안 그리고 오른쪽 칸이 창 전체', () => {
    expect(messenger).toContain('tm.fold');
  });
});

describe('좁은 팀 보관함 칸 — 이름이 "20..."으로 잘리고 머리 단추가 칸 밖으로 나가던 것', () => {
  it('머리 줄은 줄바꿈되고, 줄의 올린 사람·시각·크기는 이름보다 먼저 줄어든다', () => {
    expect(css).toMatch(/\.tmx-lk-h \{[^}]*flex-wrap: wrap/);
    expect(css).toMatch(/\.tmx-lk-row \.d \{[^}]*min-width: 0/);
  });
  it('좁으면(컨테이너 쿼리) 올린 사람·시각·크기를 이름 아래 줄로', () => {
    expect(css).toMatch(/@container \(max-width: \d+px\) \{[^@]*\.tmx-lk-row/);
  });
});
