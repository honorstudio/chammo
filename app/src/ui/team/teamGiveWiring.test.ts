// 팀 보관함 → 내 참모에게(10-26 사용자) — DOM 없이 소스로 지키는 연결 규칙(앱 테스트엔 jsdom 이 없다)
import { describe, expect, it } from 'vitest';
import locker from './TeamLocker.tsx?raw';
import give from './teamGive.tsx?raw';
import file from './TeamFile.tsx?raw';
import convo from './TeamConvo.tsx?raw';
import space from '../space/SpaceView.tsx?raw';
import drag from '../space/dragPath.ts?raw';
import orchRail from '../space/OrchRail.tsx?raw';
import mainRs from '../../../src-tauri/src/main.rs?raw';

describe('내 참모에게', () => {
  it('우클릭(하나·고른 묶음)과 줄·카드·고른 것 줄 아이콘이 같은 길(giveIds) — 아이콘은 글자 없이 이름만 aria·title', () => {
    expect(locker).toContain('giveMenu(roster, (o) => give([i.id], o))');
    expect(locker).toContain('giveMenu(roster, (o) => { give(ids, o); pick.end(); })');
    expect(locker.match(/label=\{GIVE_LABEL\(\)\}[^\n]*><IconChatSend \/><\/IconButton>/g)?.length).toBe(2);
    expect(give).toContain("tr('내 참모에게 보내기', 'Send to my assistant')");
    expect(locker).toContain('giveIds(teamId, go, o)');
    expect(give).toContain("invoke<string[]>('team_locker_give', { team, ids, orch: o.id, name: o.owner })");
  });
  it('저절로 보내지 않는다 — 입력칸에 칩을 붙이고 커서만(보내기는 사람이)', () => {
    expect(give).toContain('attachToChat(id, paths)');
    expect(give).not.toMatch(/sendTextToSession|team_handoff|key: 'Enter'|requestSubmit/);
  });
  it('메인 창이 참모 목록을 내놓고 __teamGive 로 받는다(따로 창은 Rust 가 메인 창에 eval)', () => {
    expect(space).toContain('useEffect(() => publishRoster(');
    expect(space).toContain('w.__teamGive = (r) => giveRef.current(r);');
    expect(space).toContain('team?.onLeave();\n    if (id !== now.current.view) switchTo(id, \'give\');');
    expect(mainRs).toContain('team_locker_cmd::team_locker_give,');
    expect(mainRs).toContain('team_locker_cmd::team_peek_give,');
  });
  it('팀 파일 탭 보내기 단추는 지금 채팅 탭 참모가 아니라 참모 고르기 — 메인 창·따로 창 둘 다', () => {
    expect(space).toContain('const attachOf = (path: string) => (isTeamCache(path) ?');
    expect(space.match(/onAttach=\{attachOf\((modal\.)?path\)\} attachTo=\{attachToOf\((modal\.)?path\)\}/g)?.length).toBe(4);
    expect(file).toContain('onAttach={onAttach} attachTo={give.to}');
  });
  it('끌어 놓기 — 띠 참모 프사(켜는 중·끄는 중 아님)와 팀 대화 칸이 놓는 자리', () => {
    expect(drag).toContain("const TEAM_SPOTS = '[data-team-folder], [data-orch-drop], .tmx-convo[data-team-drop]';");
    expect(orchRail).toContain('data-orch-drop={a.phase ? undefined : a.id}');
    expect(convo).toContain('data-team-room={convo.room || undefined}');
    expect(convo).toContain('d.refs!.filter((r) => !a.some((x) => x.ref?.id === r.id))');
  });
});

describe('따로 창 → 메인 창 참모로 끌어 놓기(10-28 사용자)', () => {
  it('받는 창이 team-give-in 을 받아 giveIn 으로 준다', () => {
    expect(give).toContain('window.addEventListener(TEAM_GIVE_IN, ');
    expect(drag).toContain('new CustomEvent(TEAM_GIVE_IN, { detail: { team: d.team, ids: d.ids, to: id } })');
  });
  it('안내 줄 \'팀 파일은 이 창 안에서만\'은 없앤다', () => {
    expect(locker).not.toContain('이 창 안에서만 끌어 놓을 수 있어요');
    expect(locker).toContain('if (d0.note) { setNote(d0.note); return; }');
  });
  it('Rust 명령을 단다', () => {
    expect(mainRs).toContain('team_ui::drag_out_team,');
    expect(mainRs).toContain('team_ui::drag_back,');
  });
});

// 지금 연 폴더째 참모에게(2026-10-30 사용자 '보관함 › 인앱' 같은 폴더를 채팅 아이콘 하나로)
import lockerPage from '../space/LockerPage.tsx?raw';
describe('폴더 머리줄 — 이 폴더를 참모에게', () => {
  it('참모 보관함: 폴더 안 머리줄에만(맨 위엔 없다) 같은 SendToOrch, 누르면 지금 채팅 참모 입력칸에 폴더 칩(끝 /)', () => {
    const [rootView, dirView] = lockerPage.split("  if (place.kind === 'root') {")[1]!.split('\n  return (\n');
    expect(rootView).not.toContain('onSendFolder');
    expect(dirView).toContain('<SendToOrch to={acts.sendTo} onClick={() => acts.onSendFolder!(abs(here))} />');
    expect(space).toContain('onSendFolder: (p) => attach(folderChip(p)),');
  });
  it('팀 보관함: 폴더 안 머리줄에 참모 고르기 → 폴더째 풀어 그 폴더 경로 하나(파일 칩 여럿이 아니라)', () => {
    expect(locker).toContain('giveFolder(teamId, folder, folderFiles(shown?.items ?? [], folder).map((x) => x.id), o)');
    expect(locker).toContain('{folderHas && <SendToOrch size="s"');
    expect(give).toContain("invoke<string>('team_locker_give_folder', { team, folder, ids, orch: o.id, name: o.owner })");
    expect(mainRs).toContain('team_locker_cmd::team_locker_give_folder,');
  });
});
