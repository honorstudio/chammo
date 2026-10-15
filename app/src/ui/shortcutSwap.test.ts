import { describe, expect, it } from 'vitest';
import app from '../App.tsx?raw';
import view from './space/SpaceView.tsx?raw';
import nav from './space/navSignal.ts?raw';
import tour from '../domain/tour.ts?raw';
import mainRs from '../../src-tauri/src/main.rs?raw';
import skill from '../../hq-template/.claude/skills/hq-app/SKILL.md?raw';
import { readmeEn, readmeKo } from './readmes'; // 원본 public/ · 공개본 맨 위 둘 다
import chat from './chat/ChatView.tsx?raw';
import rail from './space/OrchRail.tsx?raw';
import home from './space/OrchHome.tsx?raw';

// 2026-10-12 사용자(참모-2 전달): ⌘W = 스페이스 탭 닫기, ⌘T = 새 문서, 세션 끄기·새 세션은 ⌘⇧W·⌘⇧T, 홈·보관함으로는 ⌘⇧H·⌘⇧L
describe('단축키 교체 — App 이 스페이스로 넘긴다', () => {
  it('스페이스 명령 신호가 있다(뒤로·앞으로 SPACE_NAV 와 같은 길)', () => {
    expect(nav).toMatch(/export const SPACE_CMD = 'space-cmd'/);
    expect(nav).toMatch(/export type SpaceCmd = 'closeTab' \| 'newDoc' \| 'home' \| 'locker'/);
  });
  it('⌘W: 리더를 보고 있으면 리더 탭, 채팅 뷰면 스페이스 탭 닫기, 터미널 뷰의 그 밖엔 아무것도 안 한다 — 세션은 안 끈다', () => {
    const b = app.slice(app.indexOf("sc.type === 'closeTab'"), app.indexOf("sc.type === 'toggleReader'"));
    expect(b).toMatch(/readerFocused\(\)\) void readerCloseActive\(\)/);
    expect(b).toMatch(/spaceShownRef\.current\) spaceCmd\('closeTab'\)/);
    expect(b).not.toMatch(/closePaneRef|closeSession/);
  });
  it('⌘T: 채팅 뷰면 새 문서, 터미널 뷰면 새 세션은 ⌘⇧T 라고 알려 준다', () => {
    const b = app.slice(app.indexOf("sc.type === 'newDoc'"), app.indexOf("sc.type === 'widget'"));
    expect(b).toMatch(/spaceShownRef\.current\) spaceCmd\('newDoc'\)/);
    expect(b).toMatch(/setError\(tr\([\s\S]*?⌘⇧T/);
  });
  it('⌘⇧H·⌘⇧L: 스페이스 홈·보관함 고정 탭으로', () => {
    expect(app).toMatch(/sc\.type === 'goHome'\) spaceCmd\('home'\)/);
    expect(app).toMatch(/sc\.type === 'goLocker'\) spaceCmd\('locker'\)/);
  });
  it('⌘⇧W 세션 끄기는 어느 세션이든 확인 창을 한 번 거친다(되돌리기 어려운 일)', () => {
    const b = app.slice(app.indexOf('closePaneRef.current = () => {'), app.indexOf('// ⌘T: 보고 있는'));
    expect(b).toMatch(/askStopRef\.current\?\.\(s\)/);
    expect(b).not.toMatch(/closeSession\(s, 'cmd-w'\)/);
  });
});

describe('단축키 교체 — SpaceView 가 받아 한다', () => {
  const b = view;
  it('SPACE_CMD 를 듣는다(최신 상태는 ref 로)', () => {
    expect(b).toMatch(/window\.addEventListener\(SPACE_CMD, on\)/);
    expect(b).toMatch(/window\.removeEventListener\(SPACE_CMD, on\)/);
  });
  it('탭 닫기는 closeCurrentTab — 고정 탭·탭 없음이면 null 이라 아무 일 없음', () => {
    expect(b).toMatch(/closeCurrentTab\(/);
  });
  it('새 문서는 보관함 + → 새 문서 와 같은 길(lockerApi.newDoc md → onOpen), 폴더는 newDocFolder', () => {
    expect(b).toMatch(/lockerApi\.newDoc\(lockerOwner\([^)]*\), newDocFolder\(/);
  });
  it('탭을 닫아도 입력 초안은 그대로 — 탭 닫기 길은 draft 저장소를 건드리지 않고, 채팅 입력칸은 바뀔 때마다 저장한다', () => {
    const i = view.indexOf('const cmd = ');
    expect(i).toBeGreaterThan(0);
    expect(view.slice(i, i + 1500)).not.toMatch(/draft/i);
    expect(chat).toMatch(/useEffect\(\(\) => \{ drafts\.save\(draftKey\.current, \{ text: draft, refs \}\); \}, \[draft, refs\]\)/);
  });
  it('홈·보관함 탭 버튼은 단축키와 같은 함수를 부르고, 이름 옆에 단축키 안내(title)', () => {
    expect(view).toMatch(/aria-label=\{tr\('홈', 'Home'\)\} title=\{`\$\{tr\('홈', 'Home'\)\} \$\{keyLabel\('⌘⇧H', IS_WIN\)\}`\}/);
    expect(view).toMatch(/aria-label=\{tr\('보관함', 'Locker'\)\} title=\{`\$\{tr\('보관함', 'Locker'\)\} \$\{keyLabel\('⌘⇧L', IS_WIN\)\}`\}/);
  });
});

describe('단축키 교체 — 메뉴·안내', () => {
  it('앱 메뉴: ⌘W 탭 닫기·⌘T 새 문서·⌘⇧W 세션 끄기·⌘⇧T 새 세션·⌘⇧H 홈·⌘⇧L 보관함', () => {
    expect(mainRs).toMatch(/item\("close_tab", [^;]*accel\("CmdOrCtrl\+W"\)/);
    expect(mainRs).toMatch(/item\("new_doc", [^;]*accel\("CmdOrCtrl\+T"\)/);
    expect(mainRs).toMatch(/item\("close_pane", [^;]*accel\("CmdOrCtrl\+Shift\+W"\)/);
    expect(mainRs).toMatch(/item\("new_session", [^;]*accel\("CmdOrCtrl\+Shift\+T"\)/);
    expect(mainRs).toMatch(/item\("go_home", [^;]*accel\("CmdOrCtrl\+Shift\+H"\)/);
    expect(mainRs).toMatch(/item\("go_locker", [^;]*accel\("CmdOrCtrl\+Shift\+L"\)/);
  });
  it('메뉴 id 는 앱 것 목록(OURS)에 있고, 떼어 낸 리더 창을 보고 있으면 ⌘W(close_tab)는 그 창 탭 닫기', () => {
    for (const id of ['close_tab', 'new_doc', 'go_home', 'go_locker']) expect(mainRs).toMatch(new RegExp(`const OURS: &\\[&str\\] = &\\[[^\\]]*"${id}"`));
    expect(mainRs).toMatch(/matches!\(id, "close_tab" \|/);
  });
  it('둘러보기·README·hq-app 스킬의 단축키 줄', () => {
    expect(tour).not.toMatch(/'⌘T · ⌘W'/);
    expect(tour).toMatch(/⌘W · ⌘T/);
    expect(tour).toMatch(/⌘⇧T · ⌘⇧W/);
    expect(tour).toMatch(/⌘⇧H · ⌘⇧L/);
    for (const doc of [readmeKo, readmeEn, skill]) {
      expect(doc).toMatch(/⌘W/);
      expect(doc).toMatch(/⌘⇧W/);
      expect(doc).toMatch(/⌘⇧T/);
      expect(doc).toMatch(/⌘⇧H/);
      expect(doc).toMatch(/⌘⇧L/);
      expect(doc).not.toMatch(/⌘T · ⌘W/);
    }
  });
  it('새 참모 + 호버 카드·홈의 새 참모 단추는 ⌘⇧T 로 안내(⌘T 는 새 문서가 됐다)', () => {
    expect(rail).toMatch(/data-tip-key=\{keyLabel\('⌘⇧T', IS_WIN\)\}/);
    expect(home).toMatch(/⌘⇧T/);
    expect(home).not.toMatch(/\(⌘T\)/);
  });
});
