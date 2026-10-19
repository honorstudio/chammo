import { describe, expect, it } from 'vitest';
import dialog from './QuitDialog.tsx?raw';
import app from '../App.tsx?raw';
import main from '../../src-tauri/src/main.rs?raw';

// 2026-10-13 사용자 "종료하려고 해도 제대로 안 꺼지고, 앱이 제대로 껐다 켜지지 않는다" — ⌘Q 는 숨기기(세션 계속)라 껐다 켜도 같은 상태였고,
// 진짜 종료(⌥⌘Q)는 웹이 그리는 종료 창을 거쳐 웹이 굳으면 아무 일도 없었다. 세션까지 끄는 길뿐이라 앱만 다시 켤 길도 없었다
describe('완전히 종료 — 늘 끝까지 간다', () => {
  it('종료 창이 뜨면 Rust 에 알린다 — 못 들으면 Rust 가 4초 뒤 앱만 끈다(quit.rs)', () => {
    expect(app).toMatch(/sc\.type === 'quitAsk'\) \{ setQuitOpen\(true\); void invoke\('app_quit_shown'\)/); // 이미 떠 있어도 매번(창 마운트로 알리면 두 번째 ⌥⌘Q 에 꺼졌다)
    expect(main).toMatch(/if id == "app_quit_all" \{\s*quit::ask_or_exit\(app\);/);
    expect(main).toMatch(/fn app_quit_shown\(\)/);
  });
  it('세션은 두고 앱만 끄는 단추가 있다 — 문구가 ⌘Q 로 앱만 닫는다고 안내하지 않는다(⌘Q 는 숨기기)', () => {
    expect(dialog).toMatch(/onClick=\{\(\) => go\(false\)\}/);
    expect(dialog).not.toMatch(/앱만 닫으려면 ⌘Q/);
  });
  it('세션 끄기가 걸려도 시간 제한 뒤 종료로 간다', () => {
    expect(app).toMatch(/Promise\.race\(\[Promise\.allSettled\(mine\.map/);
  });
  it('app_exit 는 정리가 걸려도 강제로 끝난다', () => {
    expect(main).toMatch(/fn app_exit\(app: tauri::AppHandle\) \{[\s\S]*?dock_quit::finish\(&app, 0[\s\S]*?quit::exit_now\(&app,/); // 독 종료를 미뤄 둔 길도 finish 가 같은 강제 종료 감시를 건다
  });
});

describe('끌 때 Craft 저장 — 진행·건너뛰기(2026-10-19 끄기 QA)', () => {
  it('세션을 끈 뒤 Craft 저장을 시작하고, 떠 있으면 저장 중 글과 건너뛰기를 보인다 — 다 저장되면 종료', () => {
    expect(dialog).toMatch(/invoke<string\[\]>\('craft_quit_start'\)/);
    expect(dialog).toMatch(/invoke<string\[\]>\('craft_quit_left'\)/);
    expect(dialog).toMatch(/건너뛰기/);
    expect(main).toMatch(/craft_screen::close_apps_on_exit\b/);
  });
});

describe('독 종료 — 한 번에, 기다림은 눈에 보이게(2026-10-19 사용자 "독에서 종료할 때 어려움")', () => {
  it('Rust 가 끄기를 미루면(Craft 저장) 묻지 않고 바로 저장 중 창 — 띄웠다고 알리고 끝나면 app_exit', () => {
    expect(app).toMatch(/__dockQuit/);
    expect(app).toMatch(/setQuitOpen\('dock'\)/);
    expect(dialog).toMatch(/dock\?: boolean/);
    expect(dialog).toMatch(/if \(dock\) void go\(false\)/);
    expect(main).toMatch(/dock_quit::finish\(&app, 0/);
  });
});
