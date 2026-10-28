import { describe, expect, it } from 'vitest';
import src from './openInCraft.tsx?raw';
import team from '../team/openTeamFile.ts?raw';
import chat from '../chat/openChatFile.ts?raw';
import space from '../space/SpaceView.tsx?raw';
import app from '../../App.tsx?raw';
import messenger from '../team/MessengerApp.tsx?raw';

// 2026-10-26 사용자: 참모 벡터가 있으면 팀 보관함의 .ai 는 벡터로 열려야 — 설치 안 됐으면 한 번 묻고 설치 뒤 연다
describe('참모 앱으로 열기', () => {
  it('깔린 앱이면 바로 craft_open_file, 아니면 묻는 창(서랍과 같은 설치 길)', () => {
    expect(src).toMatch(/if \(r\?\.installed\) return open\(app, path\)/);
    expect(src).toMatch(/invoke<void>\('craft_open_file', \{ app, path \}\)/);
    expect(src).toMatch(/<Confirm title=\{installAsk\(/);
    expect(src).toMatch(/tileUnavailable\(r\)/); // 받을 수 없는 앱은 묻지 않고 까닭
  });
  it('묻는 창은 메인·메신저 창에 하나씩', () => {
    expect(app).toMatch(/<CraftOpenAsk \/>/);
    expect(messenger).toMatch(/<CraftOpenAsk \/>/);
  });
  it('팀 파일·채팅 칩·참모 보관함이 같은 판정(craftFirst)으로 참모 앱에', () => {
    expect(team).toMatch(/craftFirst\(name\)/);
    expect(team).toMatch(/await openInCraft\(path\)/);
    expect(chat).toMatch(/if \(!preview && craftFirst\(path\)\)/);
    expect(space).toMatch(/if \(craftFirst\(p\)\) \{ void openInCraft\(p\)/);
  });
  it('팀 모드에서 연 참모 앱 칸은 팀 화면 탭 줄에 — 참모 화면으로 안 넘어가고 주인 참모도 안 적는다(10-28 사용자 "왜 비서 참모한테 열리는지")', () => {
    expect(team).toMatch(/markTeamCraft\(craftFor\(name\) \?\? '', path\)/); // 팀 파일에서 연다는 표시(+ 연 파일) — 열기 전에
    expect(space).toMatch(/const src = team\?\.on \? fromTeamCraft\(app\) : null;/);
    expect(space).toMatch(/if \(team\?\.on && team\.space && craftToTeam\(true, src !== null, by\)\) \{ team\.space\.craft\(key, src \?\? ''\); return; \}/);
    expect(space).not.toMatch(/team\.onLeave\(\); \/\/ 팀 보관함에서 연/);
    // 팀 칸 그리기 — Craft 열쇠면 참모 칸과 같은 CraftPane
    expect(space).toMatch(/team\.space\.view\(\(p\) => \(craftAppOf\(p\) \? craftPaneOf\(p\) : filePage\(p, \{\}\)\)/);
  });
  it('팀 칸의 참모 앱도 숨김·꺼짐을 받는다 — 모든 팀 탭 줄에서 거둔다', () => {
    expect(space).toMatch(/team\?\.space\?\.dropCraft\(key\)/);
  });
});
