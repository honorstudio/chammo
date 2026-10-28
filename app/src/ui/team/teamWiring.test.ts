// 메신저 화면 연결 — DOM 없이 소스로 지키는 규칙(앱 테스트엔 jsdom 이 없다)
import { describe, expect, it } from 'vitest';
import convo from './TeamConvo.tsx?raw';
import mode from './useTeamMode.tsx?raw';
import rail from './TeamRail.tsx?raw';
import orchRail from '../space/OrchRail.tsx?raw';
import api from '../../data/teamApi.ts?raw';

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
    expect(phone).toContain('sendAllowed(at, Date.now()) && text.trim() ? api.say(to, text, cidFor(to, text), extra?.re) : null');
    expect(phone).not.toMatch(/fetch\(|'\/api\/team/);
    expect(web).toContain("say: (to, text, cid, re) => post('/api/team-say', re ? { to, text, cid, re } : { to, text, cid })");
  });
});

import locker from './TeamLocker.tsx?raw';
import page from '../space/LockerPage.tsx?raw';
describe('팀 보관함(중계 R2)', () => {
  it('목록·올리기·열기는 team_locker_* 명령으로만, 끌어 넣기는 [data-team-locker] 칸', () => {
    for (const c of ["'team_locker_list'", "'team_locker_put'", "'team_locker_poll'", "'team_locker_open'"]) expect(locker).toContain(c);
    expect(api).toContain("'team_locker_peek'"); // 썸네일은 말풍선과 같은 teamApi 길
    expect(locker).toContain('data-team-locker={room ? undefined : teamId}'); // 대화 파일 보기엔 파인더 놓기 자리가 없다(팀 전체에 올라가 버린다)
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
    expect(messenger).toContain("invoke<string>('team_handoff', { text, dry: false, to })");
    expect(phone).toContain('api.handoff(orch.id, text)');
    expect(phone).not.toContain('sendTextToSession');
    expect(web).toContain("handoff: (to, text) => post('/api/team-handoff', { to, text })");
  });
});

describe('폰 팀 보관함', () => {
  it('참모 보관함(이름으로 고르던 팀 폴더)이 아니라 팀 id 로 중계 팀 보관함을 읽는다 — 같은 이름의 참모 폴더와 안 섞이게(10-28)', () => {
    expect(phone).toContain('<PhoneTeamLocker api={api} teamId={view.teamId} />');
    expect(phone).not.toContain('readLocker');
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
    expect(bits).toMatch(/<button[^>]*className=\{cls\}/);
    expect(bits).toContain('const cls = `tmx-file ');
  });
  it('스페이스 탭 머리 — 팀 파일(풀어 둔 자리)이면 내려받기 아이콘', () => {
    expect(space).toContain('isTeamCache(path)');
    expect(space).toContain("invoke<string>('team_locker_download', { path })");
  });
});

describe('폴더·정렬', () => {
  it('폴더 만들기·이름 바꾸기·지우기는 team_locker_* 명령, 지우기는 안에 파일이 있으면 확인 창', () => {
    for (const c of ["'team_locker_mkdir'", "'team_locker_folder'"]) expect(locker).toContain(c);
    expect(locker).toContain('(f.n ? setRmFolder({ keys: [f.key], n: f.n }) : removeFolder(f.key))');
    expect(locker).toContain('onOk={() => { const f = rmFolder; setRmFolder(null); f.keys.forEach(removeFolder); pick.end(); }}');
  });
  it('폴더는 참모 보관함과 같은 조각 — 폴더 타일(FolderTile)·경로 줄(PathCrumbs)·뒤로, 칩 거름 줄은 없다(10-28 사용자 "진짜 파인더처럼")', () => {
    expect(locker).toContain("import { FolderTile, PathCrumbs } from '../space/FolderTile';");
    expect(locker).toContain('<PathCrumbs root={tr(\'팀 보관함\', \'Team locker\')} crumbs={crumbsOf(place)} onGo={setPlace} dropOf={dropAt} back={place ? () => setPlace(parentOf(place)) : undefined} />');
    expect(locker).toContain('onOpen={() => setPlace(f.key)}');
    expect(locker).not.toContain("tr('전체', 'All')");
    expect(page).toContain('<FolderTile ');
    expect(page).toContain('<PathCrumbs ');
  });
  it('파일을 폴더 칩에 끌어다 놓으면 옮긴다 — 웹 끌기(draggable)는 앱 창(Tauri)이 가로채서 안 됐다(10-26 사용자), 참모 보관함과 같은 포인터 길', () => {
    expect(locker).not.toMatch(/draggable[:=]\s*true|onDragStart|onDrop=/);
    expect(locker).toContain('dragTeam(teamId, ids,');
    expect(locker).toContain("const dropAt = (key: string) => ({ 'data-team-folder': key });");
    expect(locker).toContain('drop={dropAt(f.key)}');
    expect(locker).toContain('drag: dragDir(f.key)'); // 폴더도 끌어서 다른 폴더로
    expect(locker).toContain('window.addEventListener(TEAM_LOCKER_MOVE, mv)');
  });
  it('고르기는 참모 보관함과 같은 훅(usePick) · 오른쪽 클릭은 뒤따르는 click 을 삼킨다(열기 0번)', () => {
    expect(locker).toContain("import { usePick } from '../space/usePick'");
    for (const [from, to] of [['const onMenu = ', 'const blankMenu = '], ['const blankMenu = ', '// 폴더 —'], ['const folderMenu = ', 'const dropAt = ']] as const) {
      expect(locker.slice(locker.indexOf(from), locker.indexOf(to)), from).toContain('swallowTrailingClick();');
    }
    expect(locker).toContain('data-select-all=""');
  });
  it('바꾸기는 누르면 바로 화면에(기다리는 일) — 같은 열쇠는 또 안 보내고, 실패하면 떼고 무엇이 안 됐는지 알린다', () => {
    expect(locker).toContain('if (pendRef.current.some((p) => p.key === key)) return false;');
    expect(locker).toContain('setNote(failText(op, String(e)))');
    expect(locker).toContain('withPending(v.items, pend.map((p) => p.op))');
    expect(locker).toContain('while (up && !all.includes(up)) up = parentOf(up);'); // 되돌아간 폴더에 갇히지 않게 — 가장 가까운 위 폴더로
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

import home from './TeamHome.tsx?raw';
describe('폰 팀 프로필·팀 홈(10-26 사용자: 폰에 별명·사진·팀 홈이 없었다)', () => {
  it('폰도 데스크톱과 같은 프로필 규칙 — ProfilesCtx 를 깔고 사람 대화 이름은 namedConvos, 판은 본 판 번호로 묻는다', () => {
    expect(phone).toContain('<ProfilesCtx.Provider value={profiles}>');
    expect(phone).toContain('namedConvos(');
    expect(phone).toContain('api.profiles(teamId, rev.current)');
    expect(web).toContain("profiles: (team, rev) => getJson(`/api/team-profiles?team=${encodeURIComponent(team)}&rev=${rev}`)");
  });
  it('폰 방 목록도 이 팀 방만(모든 팀 방이 한 목록으로 온다)', () => {
    expect(phone).toContain('view.rooms.filter((r) => (r.team || view.teamId) === view.teamId)');
  });
  it('폰 팀 홈 = 데스크톱 TeamHome 그대로, 글 길만 폰 것(고치기·고정 바꾸기·지우기는 데스크톱)', () => {
    expect(phone).toContain('<TeamHome ');
    expect(phone).toMatch(/role="tab"[^\n]*seg === 'home'/);
    expect(web).toContain("post: (team, title, body, pin) => post('/api/team-post', { team, title, body, pin })");
    expect(home).toContain('api.pin && b?.owner');
    expect(home).toContain('{api.remove && (cur.mine || b?.owner)');
    expect(home).toContain('{api.edit && cur.mine');
    expect(home).not.toMatch(/invoke\(/);
  });
});
describe('폰 팀 탭 시트·팀 홈 이름', () => {
  it('팀 탭도 시트 자리를 깐다 — 없으면 글쓰기 시트가 팀 홈(.tmh position:relative) 안에 갇혀 단추가 잘렸다', () => {
    expect(phone).toContain('<SheetHostProvider kb={kb}>');
    expect(mobileApp).toContain('<PhoneTeam kb={vp.kb}');
  });
  it('팀 홈 글쓴이도 프로필 별명(목록·대화와 같은 lookOf) — 색은 명부 이름', () => {
    expect(home).toContain('lookOf(board, id, roster(id)).name');
    expect(home).toContain('personColor(roster(id))');
  });
});
import mobileApp from '../mobile/MobileApp.tsx?raw';
describe('팀 홈 오류 문구', () => {
  it('다시 읽기가 되면 읽기 실패만 지운다 — 고정만 실패한 쓰기 문구가 바로 다시 읽기에 지워져 안 보였다', () => {
    expect(home).toContain("if (readErr.current) { readErr.current = false; setErr(''); }");
    expect(home).toMatch(/readErr\.current = false; setErr\(postErr\('write'/);
  });
});

describe('썸네일(10-28 사용자 "말풍선 그림이 빈 네모") — 말풍선에 썸네일 길이 아예 없었다', () => {
  it('말풍선은 thumb 길로 그림·PDF 첫 장을 그린다 — 못 받으면 아이콘으로', () => {
    expect(bits).toContain('thumbKind(f.name, f.size)');
    expect(bits).toContain('<img src={src}');
    expect(bits).toContain('onError={() => { forget(f); setSrc(null); }}');
  });
  it('데스크톱은 teamApi 로 감싼 peek(+PDF 는 QuickLook) — 대화 칸은 invoke 를 직접 안 부른다, 시험이 바꿔 끼운다', () => {
    expect(api).toContain("invoke<string>('team_locker_peek', { team, id })");
    expect(api).toContain("invoke<string>('ql_thumb', { path })");
    expect(convo).toContain('thumb = teamFileThumb');
    expect(convo).toContain('thumb={thumbOf}');
  });
  it('폰은 맥이 줄인 JPEG 길(/api/team-file-thumb) — 파일 열기·저장은 여전히 데스크톱만', () => {
    expect(web).toContain('/api/team-file-thumb?team=');
    expect(phone).toContain('thumb={teamThumbBlob}');
  });
  it('팀 보관함 카드도 같은 길 — PDF 첫 장까지', () => {
    expect(locker).toContain('teamFileThumb(team, item.id, item.name');
  });
});

describe('입력칸 ⌘V(10-28 사용자) — 파인더 파일 복사·스크린샷 복사가 첨부로', () => {
  it('붙여넣기는 teamApi 로 감싼 맥 클립보드 읽기(team_clip_files) → 같은 attach 길, 글만이면 웹뷰 기본 붙여넣기', () => {
    expect(api).toContain("invoke<string[]>('team_clip_files', { name })");
    expect(convo).toContain('onPaste={(e) => {');
    expect(convo).toContain('pasteTakes([...e.clipboardData.items]');
    expect(convo).toContain('files.clip(pasteName(new Date()))');
    expect(convo).toContain('clip: teamClipFiles');
  });
});

describe('참모 보관함 → 팀 보관함(10-28 사용자 "끌어도 반응 없음")', () => {
  it('카드 우클릭·묶음 메뉴에 팀 보관함에 올리기 — 든 팀이 있을 때만', async () => {
    const lockerPage = (await import('../space/LockerPage.tsx?raw')).default;
    expect(lockerPage).toContain('team: teams ? { sub: teamUploadSub([c.path], uploadApi, setTeamNote)');
    expect(lockerPage).toContain('folders: folders.length, teams });');
    expect(lockerPage).toContain('{undoBar || teamBar}');
  });
  it('팀 보관함 칸은 팀 id 를 달고(대화 파일 보기 포함) 끌어 놓은 경로를 그 폴더나 지금 폴더에 올린다 — 올린 뒤 알림 줄은 없다(10-28 사용자)', () => {
    expect(locker).toContain('data-team-id={teamId}');
    expect(locker).toContain('const to = d.folder !== undefined ? d.folder || null : folder;');
    expect(locker).not.toContain('팀 모두에게 바로 보여요');
    expect(locker).toContain('if (d0.note) { setNote(d0.note); return; }'); // 창 밖 놓기는 못 받은 때만 한 줄(10-28 사용자 '창 안에서만' 안내 줄 지움)
  });
});

import useTeamSrc from './useTeam.ts?raw';
describe('읽음(10-28 사용자 카톡처럼 · 같은 계정 기기끼리)', () => {
  it('중계엔 사람이 보고 있을 때만 올린다 — 데스크톱은 포커스+보임(looking), 폰은 화면 보임', () => {
    expect(useTeamSrc).toContain('looking(document)');
    expect(useTeamSrc).toContain('teamMarkRead(room, seq)');
    expect(phone).toContain("document.visibilityState === 'visible') : null;");
    expect(phone).toContain('focused={shown}');
    expect(web).toContain("read: (room, seq) => post('/api/team-read', { room, seq })");
  });
  it('내 안 읽음은 이 창 값과 다른 기기 값(feed.reads)을 합친다 — 메인·따로 창·폰', () => {
    expect(useTeamSrc).toContain('mergedRead(local, feed?.reads');
    expect(phone).toContain('mergedRead(local, feed?.reads');
  });
  it('말풍선 숫자는 메인·따로 창(useTeamMode)과 폰 모두 같은 TeamConvo 에 reads 로', () => {
    expect(mode).toContain('reads={feed.reads}');
    expect(phone).toContain('reads={t.feed.reads}');
    expect(convo.match(/\{rd\}/g)?.length).toBe(3); // 내 풍선·남의 풍선·참모 말
  });
});

import chatView from '../chat/ChatView.tsx?raw';
import jumpSrc from '../kit/JumpBottom.tsx?raw';
describe('팀챗 스크롤 — 맨 아래 붙어 있기·읽던 자리·맨 아래로 단추(10-28 사용자)', () => {
  it('칸 크기(창·폭)와 글 높이(그림 로드)를 둘 다 지켜본다 — 스크롤 칸과 안쪽 글 칸', () => {
    expect(convo).toContain('new ResizeObserver(');
    expect(convo).toContain('ro.observe(el)');
    expect(convo).toContain('ro.observe(inner.current)');
    expect(convo).toContain('className="tmx-msgs-in" ref={inner}');
    expect(convo).toContain('keepTop({ near: near.current');
  });
  it('새 말이 와도 올려 읽는 중이면 끌어내리지 않는다 — 대화를 바꾸거나 내가 보냈을 때만 무조건 맨 아래', () => {
    expect(convo).not.toContain('el.scrollTop = el.scrollHeight; }, [convo.key, top, handing, sending.length]');
    expect(convo).toContain('stickBottom({ wasNear: near.current, sentMine })');
  });
  it('맨 아래로 단추는 참모 채팅과 같은 조각(kit/JumpBottom) — 새 말 수는 숫자 배지', () => {
    expect(chatView).toContain('<JumpBottom');
    expect(chatView).not.toContain('<button className="chat-bottom"');
    expect(convo).toContain('<JumpBottom');
    expect(convo).toContain('n={unseen}');
    expect(jumpSrc).toContain('<Badge n={n}');
  });
});
