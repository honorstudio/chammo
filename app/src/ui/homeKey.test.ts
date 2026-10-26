import { describe, expect, it } from 'vitest';
import app from '../App.tsx?raw';
import view from './space/SpaceView.tsx?raw';
import nav from './space/navSignal.ts?raw';
import tour from '../domain/tour.ts?raw';
import preview from './space/Preview.tsx?raw';
import mainRs from '../../src-tauri/src/main.rs?raw';
import keysMac from '../../src-tauri/src/keys_mac.rs?raw';
import skill from '../../hq-template/.claude/skills/hq-app/SKILL.md?raw';

// 2026-10-25 사용자(참모-2 전달): ⌘`(한글 ⌘₩) = 홈 대시보드 켜기, 다시 누르면 보던 화면. 창 크게/되돌리기는 ⌘⇧` 로
describe('⌘` 홈 토글', () => {
  it('메뉴: ⌘` = 홈, ⌘⇧` = 창 크게(둘 다 앱 메뉴 id 로 route_menu 가 받는다)', () => {
    expect(mainRs).toMatch(/item\("home_toggle", tr\("홈 대시보드 \/ 보던 화면", "Home Dashboard \/ Back"\), Some\(&\*platform::accel\("CmdOrCtrl\+`"\)\)\)/);
    expect(mainRs).toMatch(/item\("pane_max", [^\n]*Some\(&\*platform::accel\("CmdOrCtrl\+Shift\+`"\)\)\)/);
    expect(mainRs).toMatch(/const OURS: &\[&str\] = &\[[^\]]*"home_toggle"/);
  });
  it('맥이 ⌘` 를 같은 앱 창 돌기로 쓰니 앱 전체 키 감시가 먼저 잡아 삼킨다 — 메신저 따로 창에서도(Ctrl+Tab 과 같은 길)', () => {
    expect(keysMac).toMatch(/const GRAVE: u16 = 50;/);
    expect(keysMac).toMatch(/cmd_only && e\.keyCode\(\) == GRAVE/);
    expect(keysMac).toMatch(/if m\.contains\(NSEventModifierFlags::Shift\) \{ "pane_max" \} else \{ "home_toggle" \}/);
  });
  it('다른 창(메신저 등)에서 누르면 메인 창을 앞으로 + 홈 켜기만(돌아가기 아님)', () => {
    const r = mainRs.slice(mainRs.indexOf('pub fn route_menu'), mainRs.indexOf('fn quit_label'));
    expect(r).toMatch(/if id == "home_toggle" && !w\.is_focused\(\)\.unwrap_or\(false\) \{\s*let _ = w\.set_focus\(\);\s*"home_open"/);
  });
  it('앱: 채팅 뷰면 스페이스에 홈 토글, 터미널 뷰엔 홈 대시보드가 없어 참모 화면(open home 과 같은 규칙)', () => {
    expect(app).toMatch(/sc\.type === 'homeToggle'\) \{ if \(spaceShownRef\.current\) spaceCmd\(sc\.open \? 'dash' : 'dashToggle'\); else runRef\.current\(\{ type: 'goto', to: 'orchestrator' \}\); \}/);
    expect(nav).toMatch(/'dash' \| 'dashToggle'/);
  });
  it('스페이스: 홈이면 그 참모 탭이 보던 화면으로, 아니면 홈(domain/spaceNav dashToggle)', () => {
    expect(view).toMatch(/if \(c === 'dashToggle'\) \{ setPick\(dashToggle\(pick, orch \? ownPick\(screens\.current\.get\(orch\.id\)\?\.pick, orch\.id, homeOf\(orch\)\) : ''\), 'home'\); return; \}/);
  });
  it('안내: 둘러보기 단축키 줄·미리보기 가득 단추·hq-app 스킬(한·영)', () => {
    expect(tour).toMatch(/\[keyLabel\(tr\('⌘₩', '⌘`'\), IS_WIN\), tr\('홈 대시보드 \/ 보던 화면', 'Home dashboard \/ back'\)\]/);
    expect(tour).toMatch(/\[keyLabel\(tr\('⌘⇧₩', '⌘⇧`'\), IS_WIN\), tr\('보고 있는 창 크게 \/ 되돌리기', 'Maximize \/ restore the focused pane'\)\]/);
    expect(tour).toMatch(/⌘⇧₩ 로 크게 봤다가 되돌려요/);
    expect(tour).toMatch(/⌘⇧` maximizes and restores a pane/);
    expect(preview).toMatch(/'원래 크기 \(⌘⇧`\)', 'Restore \(⌘⇧`\)'/);
    expect(preview).not.toMatch(/\(⌘`\)/);
    expect(skill).toMatch(/⌘₩ 홈 대시보드 켜기\/보던 화면 · ⌘⇧₩ 보고 있는 창 크게\/되돌리기/);
    expect(skill).toMatch(/⌘` home dashboard \/ back · ⌘⇧` maximize\/restore/);
  });
});
