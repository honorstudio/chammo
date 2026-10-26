// 메신저 화면 연결 — DOM 없이 소스로 지키는 규칙(앱 테스트엔 jsdom 이 없다)
import { describe, expect, it } from 'vitest';
import convo from './TeamConvo.tsx?raw';
import mode from './useTeamMode.tsx?raw';
import rail from './TeamRail.tsx?raw';
import orchRail from '../space/OrchRail.tsx?raw';

describe('메신저 연결', () => {
  it('보내기는 사람 문(teamHumanSay + 이 칸의 진짜 키·클릭 시각)만 — 앱이 저절로 보내는 길이 없다', () => {
    expect(convo).toContain('say = teamHumanSay');
    expect(convo).toContain('say(sayTarget(convo), t, trustedAt.current)');
    expect(convo).toContain('e.nativeEvent.isTrusted ? Date.now() : 0');
    expect(convo).not.toMatch(/invoke\(/);
  });
  it('떼기 아이콘은 모니터가 둘 이상일 때만(모니터 하나면 뗀 창이 스페이스를 가린다)', () => {
    expect(mode).toContain('const canDetach = screens > 1;');
    expect(mode).toContain(": canDetach && <IconButton label={tr('메신저 따로 창으로'"); // 따로 창(alone)이면 그 자리는 붙이기
    expect(mode).toContain('detach={canDetach && !alone ?'); // 따로 창(alone)에선 또 떼지 않는다
  });
  it('띠 칸은 .lk-strip 바로 아래 형제(.lk-av.tmx) 팀 표 하나 — 고른 자리 이음이 그 칸을 찾고, 참모 순서 바꾸기는 그 칸을 뺀다', () => {
    expect(rail).not.toMatch(/<div className="tmx/);
    expect(rail.match(/className=\{?[`"]lk-av tmx /g)?.length).toBe(1);
    expect(orchRail).toContain(":scope > .lk-av:not(.grp):not(.tmx)");
    expect(orchRail).toContain('{extra}');
  });
  it('팀 겹창(팀 설정·만들기·초대·팀챗)은 창 가운데 TeamDialog — 누른 자리에 띄우면 작은 창에서 잘리고(10-25) 뒤 글과 엉켰다(10-26)', () => {
    expect(mode).toContain('<TeamDialog label={popLabel(pop, !!team)}');
  });
  it('보고 있는 대화를 Rust 에 알리고 칸을 떠나면 지운다(그 대화 새 말엔 안 울린다)', () => {
    expect(convo).toContain('viewing = teamViewing');
    expect(convo).toContain('viewing(convo.room)');
    expect(convo).toContain("viewing('')");
  });
});

import phone from '../mobile/PhoneTeam.tsx?raw';
import web from '../../data/web.ts?raw';
describe('폰 팀 탭', () => {
  it('폰 보내기도 진짜 누름 뒤 1.5초 문을 지나고, 읽기·쓰기는 TeamPhoneApi 하나로만(중계 직결로 갈아끼울 자리)', () => {
    expect(phone).toContain('sendAllowed(at, Date.now()) && text.trim() ? api.say(to, text, cidFor(to, text)) : null');
    expect(phone).not.toMatch(/fetch\(|'\/api\/team/);
    expect(web).toContain("say: (to, text, cid) => post('/api/team-say', { to, text, cid })");
  });
});

import locker from './TeamLocker.tsx?raw';
describe('팀 보관함(중계 R2)', () => {
  it('목록·올리기·열기는 team_locker_* 명령으로만, 끌어 넣기는 [data-team-locker] 칸', () => {
    for (const c of ["'team_locker_list'", "'team_locker_put'", "'team_locker_poll'", "'team_locker_open'", "'team_locker_peek'"]) expect(locker).toContain(c);
    expect(locker).toContain('data-team-locker={teamId}');
    expect(teamDropSrc).toContain("closest<HTMLElement>('[data-team-locker]')"); // 메인 창·따로 창이 같이 쓰는 teamDrop
  });
  it('영구 지우기는 Confirm 의 onOk 안에서만', () => {
    const at = locker.indexOf("verb(p.id, 'purge')");
    expect(at).toBeGreaterThan(0);
    expect(locker.slice(Math.max(0, at - 300), at)).toContain('onOk=');
  });
  it('보기(목록·카드)는 기억하되 저장소가 막혀도 그린다', () => {
    expect(locker).toMatch(/const readView = \(\)[^\n]*try \{/);
  });
});
import teamDropSrc from './teamDrop.ts?raw';

import app from '../../App.tsx?raw';
import messenger from './MessengerApp.tsx?raw';
describe('보안 10-23: 넘기기 세 길은 team_handoff(거름 + 본문 없는 기록)로만', () => {
  it('메인 창·따로 창·폰 모두 team_handoff 길 — sendTextToSession(space-send 기록에 앞 80자)으로 안 간다', () => {
    const appHand = app.slice(app.indexOf('const teamMode = useTeamMode('), app.indexOf('const teamMode = useTeamMode(') + 900);
    expect(appHand).toContain("invoke<string>('team_handoff'");
    expect(appHand).not.toContain('sendTextToSession');
    expect(messenger).toContain("invoke<string>('team_handoff', { text, dry: false })");
    expect(phone).toContain('api.handoff(orch.id, text)');
    expect(phone).not.toContain('sendTextToSession');
    expect(web).toContain("handoff: (to, text) => post('/api/team-handoff', { to, text })");
  });
});

describe('폰 팀 보관함', () => {
  it('팀 폴더는 이름이 아니라 owner id(team-<팀 id>)로 고른다 — 같은 이름의 참모 폴더와 안 섞이게', () => {
    expect(phone).toContain('`team-${teamId}`');
    expect(phone).not.toContain('i.owner === team)');
  });
});

import settings from './TeamSettings.tsx?raw';
describe('팀 설정 — 되돌리기 어려운 건 확인 뒤에만, 메신저 창 기본 메뉴는 막음', () => {
  it('나가기·빼기는 Confirm 의 onOk 안에서만 부른다', () => {
    for (const f of ['teamLeave(', 'teamRemove(']) {
      const at = [...settings.matchAll(new RegExp(f.replace('(', '\\('), 'g'))].map((m) => m.index ?? 0);
      expect(at.length).toBe(1);
      const before = settings.slice(Math.max(0, at[0]! - 200), at[0]);
      expect(before).toContain('onOk=');
    }
  });
  it('메신저 창은 오른쪽 클릭을 문서에서 받아 quietContextMenu 로 거른다 — 팀 아이콘은 우리 메뉴', () => {
    expect(messenger).toContain("document.addEventListener('contextmenu', f)");
    expect(messenger).toContain('quietContextMenu(');
    expect(messenger).toMatch(/onContextMenu=\{\(e\) => \{ e\.preventDefault\(\); setMenu/);
  });
});

import bits from './RoomBits.tsx?raw';
import openTeam from './openTeamFile.ts?raw';
import space from '../space/SpaceView.tsx?raw';
import teamCss from './team.css?raw';
import profileCss from './profile.css?raw';
describe('팀 파일 열기 = 스페이스(10-26 사용자 292.png)', () => {
  it('오른쪽 미리보기 칸은 없다 — 파일을 누르면 바로 연다(한 번 누르기·두 번 누르기 같은 길)', () => {
    expect(locker).not.toContain('tlk-side');
    expect(locker).not.toMatch(/function Preview\(/);
    expect(locker).toMatch(/onClick=\{\(e\) => click\(e, i\)\}/);
    expect(locker).toContain('if (!opensOnClick(e) || pick.press(e, i.id)) return;\n    open(i);');
    expect(locker).not.toContain('onDoubleClick');
  });
  it('열기는 openTeamFile 하나 — 못 그리는 형식만 기본 앱, 그리는 건 show 길(openChatFile)', () => {
    expect(openTeam).toContain('opensInSpace(name)');
    expect(openTeam).toContain('openChatFile(path');
    expect(locker).toContain("openTeamFile((external) => invoke<string>('team_locker_open', { team: teamId, id: i.id, external })");
    expect(convo).toContain('openTeamFile((external) => files.open(');
  });
  it('누르는 즉시 그 줄에 여는 중 — 끝나거나 실패하면 풀고, 여는 중에 또 눌러도 한 번만(10-26 사용자 "바로 안 열린다")', () => {
    expect(locker).toContain('setOpening((x) => new Set(x).add(i.id))');
    expect(locker).toMatch(/\.finally\(\(\) => setOpening\(/);
    expect(locker).toContain('if (i.why || trash || opening.has(i.id)) return;');
    expect(locker).toContain("aria-busy={opening.has(i.id) || busy.has(i.id)}");
    expect(locker).toContain("tr('여는 중', 'Opening')");
  });
  it('탭을 열 때 연 곳은 업데이터 밖에서 잡는다 — 안에서 now.current.pick 을 읽으면 벌써 새 탭이라 닫으면 참모 보관함으로 갔다(10-26)', () => {
    expect(space).not.toMatch(/setLkHold\(\(h\) => open(Tab|Review)\([^)]*now\.current\.pick/);
  });
  it("오른쪽 메뉴에 '다른 앱으로 열기' — 보관함·대화 풍선 둘 다", () => {
    expect(locker).toContain("tr('다른 앱으로 열기', 'Open with default app')");
    expect(convo).toContain("tr('다른 앱으로 열기', 'Open with default app')");
  });
  it('대화 파일 풍선은 통째로 누르는 단추', () => {
    expect(bits).toMatch(/<button[^>]*className=\{`tmx-file /);
  });
  it('스페이스 탭 머리 — 팀 파일(풀어 둔 자리)이면 내려받기 아이콘', () => {
    expect(space).toContain('isTeamCache(path)');
    expect(space).toContain("invoke<string>('team_locker_download', { path })");
  });
});

describe('폴더·정렬', () => {
  it('폴더 만들기·이름 바꾸기·지우기는 team_locker_* 명령, 지우기는 안에 파일이 있으면 확인 창', () => {
    for (const c of ["'team_locker_mkdir'", "'team_locker_folder'"]) expect(locker).toContain(c);
    expect(locker).toContain('(f.n ? setRmFolder(f) : removeFolder(f.key))');
    expect(locker).toMatch(/onOk=\{\(\) => \{ const f = rmFolder; setRmFolder\(null\); removeFolder\(f\.key\); \}\}/);
  });
  it('파일을 폴더 칩에 끌어다 놓으면 옮긴다 — 웹 끌기(draggable)는 앱 창(Tauri)이 가로채서 안 됐다(10-26 사용자), 참모 보관함과 같은 포인터 길', () => {
    expect(locker).not.toMatch(/draggable[:=]\s*true|onDragStart|onDrop=/);
    expect(locker).toContain('dragTeam(teamId, ids,');
    expect(locker).toContain("'data-team-folder': f.key");
    expect(locker).toContain('window.addEventListener(TEAM_LOCKER_MOVE, mv)');
  });
  it('고르기는 참모 보관함과 같은 훅(usePick) · 오른쪽 클릭은 뒤따르는 click 을 삼킨다(열기 0번)', () => {
    expect(locker).toContain("import { usePick } from '../space/usePick'");
    for (const [from, to] of [['const onMenu = ', 'const blankMenu = '], ['const blankMenu = ', '// 폴더 —'], ['const chipMenu = ', 'const nameBox = ']] as const) {
      expect(locker.slice(locker.indexOf(from), locker.indexOf(to)), from).toContain('swallowTrailingClick();');
    }
    expect(locker).toContain('data-select-all=""');
  });
  it('바꾸기는 누르면 바로 화면에(기다리는 일) — 같은 열쇠는 또 안 보내고, 실패하면 떼고 무엇이 안 됐는지 알린다', () => {
    expect(locker).toContain('if (pendRef.current.some((p) => p.key === key)) return false;');
    expect(locker).toContain('setNote(failText(op, String(e)))');
    expect(locker).toContain('withPending(v.items, pend.map((p) => p.op))');
    expect(locker).toContain("if (shown && place && !folders.some((f) => f.key === place)) setPlace('');"); // 되돌아간 폴더에 갇히지 않게
    for (const c of ["invoke('team_locker_mkdir'", "invoke('team_locker_folder'", "invoke('team_locker_rename'", "invoke('team_locker_act'"]) {
      const at = locker.indexOf(c);
      expect(at, c).toBeGreaterThan(0);
      expect(locker.slice(Math.max(0, at - 160), at), c).toMatch(/run\(\{ k: '/);
    }
  });
  it('정렬은 머리 아이콘 하나(공용 SortButton) — 고른 건 기억', () => {
    expect(locker).toContain('<SortButton keys={SORTS} value={sort} onChange={(x) => { setSort(x); saveSort(x); }} />');
  });
});

describe('얼굴은 늘 정사각(290.png 타원)', () => {
  it('얼굴 칸은 크기 고정 — 부모 flex 규칙이 늘리거나 줄이지 못한다', () => {
    for (const cls of ['.tmx-pa', '.tmx-tm', '.tmx-face']) {
      const rule = teamCss.split('\n').find((l) => l.startsWith(`${cls} {`)) ?? '';
      expect([cls, rule]).toEqual([cls, expect.stringContaining('min-width: var(--s); max-width: var(--s);')]);
      expect(rule).toContain('aspect-ratio: 1;');
    }
  });
  it("카드 머리 이름 칸은 클래스로 — '> span' 이 얼굴까지 잡지 않게", () => {
    expect(teamCss.length * profileCss.length).toBeGreaterThan(0);
    expect(profileCss).not.toContain('.tmp-card-h > span');
  });
});

describe('팀 보관함 여는 속도(296.png — 빈 칸으로 한참)', () => {
  it('열자마자 봉해 둔 마지막 목록(team_locker_cached)을 먼저, 새 목록이 오면 갈아 끼운다', () => {
    const eff = locker.slice(locker.indexOf("invoke<LockerView | null>('team_locker_cached'"), locker.indexOf('void load();'));
    expect(eff).toContain('setV((x) => x ?? c)');
    expect(locker).toContain("const fresh = await invoke<LockerView>('team_locker_list'");
  });
  it('처음 열 땐 줄 모양 자리표시, 봉해 둔 목록을 보여 주는 동안엔 받는 중 표시', () => {
    expect(locker).toContain('!v && !err ? (');
    expect(locker).toContain('tlk-skel');
    expect(locker).toContain("busyList && v?.cached && <i className=\"tlk-sync\" role=\"status\">");
  });
});

describe('반응은 누르자마자(10-26 팀 지연)', () => {
  it('보낸 반응을 얹어 그리고, 보내는 중엔 같은 반응을 또 안 보내고, 실패하면 떼고 알린다', () => {
    expect(convo).toContain('withMyReacts(got, pendReact, myName)');
    expect(convo).toContain('if (pendReact.some((x) => x.seq === seq && x.mark === markKey)) return;');
    expect(convo).toMatch(/setPendReact\(\(x\) => x\.filter\(\(y\) => y !== mine\)\); setErr\(tr\(`반응을 못 달았어요/);
  });
});

import roomCreate from './RoomCreate.tsx?raw';
describe('기다리는 단추는 연타 한 번만·보내는 중 글(10-26 팀 지연)', () => {
  it('팀 이름 Enter 도 저장 중엔 안 보낸다(단추만 막혀 있어 Enter 연타면 두 번 갔다)', () => {
    expect(settings).toContain("e.key === 'Enter' && !e.nativeEvent.isComposing && !busy && name.trim()");
    expect(settings).toContain("{busy ? tr('저장 중', 'Saving') : tr('저장', 'Save')}");
  });
  it('방 만들기·바꾸기 단추는 보내는 중 글', () => {
    expect(roomCreate).toContain("if (!ok || busy) return;");
    expect(roomCreate).toContain("tr('만드는 중', 'Creating')");
  });
});
