// 팀 겹창·따로 창·끌어 놓기 연결 — DOM 없이 소스로 지키는 규칙(앱 테스트엔 jsdom 이 없다). 10-26 사용자 제보 300.png
import { describe, expect, it } from 'vitest';
import dialog from './TeamDialog.tsx?raw';
import mode from './useTeamMode.tsx?raw';
import messenger from './MessengerApp.tsx?raw';
import convo from './TeamConvo.tsx?raw';
import home from './TeamHome.tsx?raw';
import teamDrop from './teamDrop.ts?raw';
import fileDrop from '../fileDrop.ts?raw';
import css from './team.css?raw';
import mainRs from '../../../src-tauri/src/main.rs?raw';
import windowRs from '../../../src-tauri/src/team_window.rs?raw';

const rule = (sel: string) => new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[2] ?? '';

describe('팀 겹창(팀챗 만들기·팀 설정·초대·팀 만들기)', () => {
  it('뒤를 가리는 판 + 판 위 카드 — 카드는 바탕색이 있어 뒤 글자가 안 비친다', () => {
    expect(rule('.tmx-dlg')).toMatch(/position: fixed; inset: 0/);
    expect(rule('.tmx-dlg')).toMatch(/background: color-mix\(in srgb, #000/);
    expect(rule('.tmx-dlg-card')).toContain('background: var(--surface)');
    expect(rule('.tmx-dlg-card')).toMatch(/max-height: calc\(100vh - /); // 창보다 길면 안쪽만 스크롤
  });
  it('겹창이 aria-modal 대화창이고, Esc·판 누르기로 닫고, Tab 은 안에서만 돈다', () => {
    expect(dialog).toContain('role="dialog" aria-modal="true"');
    expect(dialog).toContain("e.key === 'Escape'");
    expect(dialog).toContain('e.target === e.currentTarget'); // 판 자체를 누를 때만 — 카드 안·포털 메뉴의 누름은 아님
    expect(dialog).toContain('trapNext(');
    expect(dialog).toContain('back.current?.focus'); // 닫으면 연 자리로 포커스를 돌려준다
  });
  it('안에 또 뜬 카드·메뉴(내 프로필·더보기)가 있으면 Esc 는 그쪽 먼저', () => {
    expect(dialog).toContain(`querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')`);
  });
  it('팀 모드 팝업은 모두 TeamDialog 로 — 투명 판 + 누른 자리 상자(PopAt)는 없다', () => {
    expect(mode).toContain('<TeamDialog ');
    expect(mode).not.toContain('PopAt');
    expect(mode).not.toContain('tmx-pop-scrim');
  });
});

describe('메신저 따로 창 = 팀 모드 전체 창(참모만 없이)', () => {
  it('대화 하나만 뜨는 창은 없다 — 옛 주소(c=<방>)도 팀 모드 창에서 그 방을 고른다', () => {
    expect(messenger).not.toContain('MessengerOne');
    expect(messenger).toContain("room={win === 'all' ? room : win}");
  });
  it('떼기 단추(목록 머리·대화 머리)·떼어 둔 방 고르기는 다 같은 길(팀 모드 창 + 방)', () => {
    expect(mode).not.toContain('teamWindowOpen(k');
    expect(mode).not.toContain('teamWindowOpen(c.room');
    expect(mode).not.toContain('teamWindowOpen(room');
    expect(mode).toContain('const toWindow = (room?: string) => void teamWindowOpen(');
  });
  it('따로 창은 Rust 가 고를 방을 __teamPick 으로 넘긴다', () => {
    expect(mode).toContain('w.__teamPick = (room: string) =>');
    expect(windowRs).toContain('let (key, room) = target(&key);');
    expect(windowRs).toContain('w.eval(pick_js(r))');
  });
});

describe('따로 창 파일 끌어 놓기', () => {
  it('main.rs 가 메신저 따로 창(team-*)의 끌어 놓기도 넘긴다 — 메인 창만 넘겨서 따로 창엔 안 붙었다', () => {
    expect(mainRs).toContain('tauri::WindowEvent::DragDrop(e) if window.label() == "main" || window.label() == orch_bubble::LABEL || team_window::is_team_window(window.label()) => drop::forward(window, e)'); // 바탕 배지 대화창도(fix/bubble-pop)
  });
  it('팀 보관함 칸 끌어 놓기도 teamDrop 한 길 — 메인 창(fileDrop)·따로 창(messenger.tsx)이 같이', () => {
    expect(teamDrop).toContain("closest<HTMLElement>('[data-team-locker]')");
    expect(fileDrop).not.toContain("closest<HTMLElement>('[data-team-locker]')");
  });
});

describe('대화 입력칸 파일 붙이기', () => {
  it('아이콘은 더하기(+) — 문서+더하기 모양 말고(10-26 사용자)', () => {
    expect(convo).toMatch(/label=\{tr\('파일 붙이기', 'Attach files'\)\}[^\n]*<IconPlus \/><\/IconButton>/);
    expect(convo).not.toContain('IconAttachFile');
  });
});

describe('팀 홈 글 오류', () => {
  it('읽기·쓰기 실패를 postErr 로 가려 사람 말로', () => {
    expect(home).toContain("postErr('read'");
    expect(home).toContain("postErr('write'");
    expect(home).not.toContain('글을 못 읽었어요 — ${err}');
  });
});
