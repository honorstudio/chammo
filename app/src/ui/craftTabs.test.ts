import { describe, expect, it } from 'vitest';
import space from './space/SpaceView.tsx?raw';
import pane from './craft/CraftPane.tsx?raw';
import drawer from './craft/CraftDrawer.tsx?raw';
import win from '../../src-tauri/src/craft_window.rs?raw';
import handback from './useCraftHandback.ts?raw';

// 2026-10-19 사용자 확정 — 스페이스의 Craft 글자 탭 없애기(독 아이콘이 탭), 끄기 v7 A1·B1·B3
describe('Craft 탭은 독 아이콘만', () => {
  it('k: 글자 탭을 그리지 않는다 · 떠나면 숨기기(craft_leave)', () => {
    expect(space).toMatch(/if \(p\.startsWith\('k:'\)\) return null/);
    expect(space).toMatch(/craft_leave/);
  });
  it('독 오른쪽 클릭에 따로 창·꺼내기·끄기·최근 문서', () => {
    const dock = space.slice(space.indexOf('myDock(lo.id).map((it'), space.indexOf('row.tabs.map'));
    expect(dock).toMatch(/따로 창으로/);
    expect(dock).toMatch(/맥 앱으로 꺼내기/);
    expect(dock).toMatch(/끄기 — 바뀐 게 있으면 저장하고/);
  });
});

describe('끄기 v7', () => {
  it('B1 머리줄 전원 · B3 저장하고 끄는 중', () => {
    expect(pane).toMatch(/<IconPower \/>/);
    expect(pane).toMatch(/저장하고 끄는 중/);
  });
  it('A1 서랍 떠 있는 앱 점 + 올리면 전원', () => {
    expect(drawer).toMatch(/cd-run/);
    expect(drawer).toMatch(/<IconPower \/>/);
  });
});

// 2026-10-19 사용자 "세션이 Craft 로 만드는 걸 사람이 보면서 따라가게" — 프로젝트 세션이 띄운 칸은 그 세션을 맡긴 참모 탭에
describe('Craft 칸은 띄운 세션을 맡긴 참모에게', () => {
  it('Rust 가 띄운 세션(by)을 넘기고, 웹은 show 와 같은 주인 판단(showOwner·craftTarget)으로 고른다', () => {
    expect(win).toMatch(/"by": by/);
    expect(space).toMatch(/__craftSpace = \(\{ app, name, place, by \}\)/);
    expect(space).toMatch(/const owner = craftOwnerOf\(by, app, \(b\) => showOwner\(b, orchIds, holders\), craftOwner, orchIds\);\s+const t = craftTarget\(owner,/);
    expect(space).toMatch(/if \(\(owner \|\| by\) && t\.to\) setCraftOwner\(app, t\.to\);/);
  });
  it('다른 참모 몫이면 보던 화면은 그대로 두고 그 참모 탭 줄에 넣어 둔다(점 알림)', () => {
    expect(space).toMatch(/if \(t\.queue\) \{[\s\S]{0,400}holds\.current\.set\(t\.to!, openTab\(/);
  });
});

describe('돌려받음 줄은 그 앱을 연 세션에도', () => {
  it('참모에게 가고, 연 세션(by)이 따로면 그 세션에도 — 돌던 스크립트를 띄운 세션이 상황을 안다', () => {
    expect(handback).toMatch(/if \(p\.by && p\.by !== targets\[i\]\) void sendToSession\(p\.by, line\)/);
  });
});

describe('Craft 서랍은 윈도우에도(2026-10-21 단계 3 — scripts/craft 윈도우 길)', () => {
  it('탭 줄의 앱 서랍 단추를 윈도우에서도 보인다', () => {
    expect(space).not.toMatch(/!IS_WIN && \( \/\/ Craft 는 지금 맥만/);
    expect(space).toMatch(/onClick=\{\(\) => setPick\(APPS_KEY\)\}/);
  });
});

// 2026-10-21 사용자 '주인 가르기' — 참모가 여럿일 때 모든 참모 탭에 같은 참모 앱이 보였다, 같은 앱을 세션 2~3개가 같이 못 썼다
describe('참모 앱은 주인 참모 스페이스에만', () => {
  it('독은 그 참모 것만(dockFor), 번호도 그 독 안에서', () => {
    expect(space).toMatch(/myDock\(lo\.id\)\.map\(\(it, _i, mine\)/);
    expect(space).toMatch(/dockNo\(mine, it\)/);
  });
  it('주인이 정해진 칸은 다른 참모 탭 줄에서 거둔다(2초 독 읽기마다)', () => {
    expect(space).toMatch(/d\.forEach\(\(it\) => strayCraft\.current\(it\)\)/);
    expect(space).toMatch(/dropCraftEverywhere\(key, holds\.current, screens\.current, o\)/);
  });
  it('꺼진 앱은 칸이 놓인 참모 기억도 지운다', () => {
    expect(space).toMatch(/forgetCraftOwner\(craftAppOf\(key\), Date\.now\(\), goneFor\)/);
    expect(space).toMatch(/dropCraft\.current\(craftKey\(a\), GONE_TICKS \* 2000\)/);
  });
  it('주인이 늦게 정해지면 거둔 칸을 주인 참모 탭 줄로', () => {
    expect(space).toMatch(/holds\.current\.set\(o, openTab\(holds\.current\.get\(o\) \?\? null, o, sv\.pick, key\)\)/);
  });
  it('서랍은 참모마다 새로(여는 중 표시가 안 섞이게) · 지우기 판단은 모든 인스턴스로', () => {
    expect(space).toMatch(/<CraftDrawer key=\{lockerOrch\?\.id \?\? ''\} running=\{mine\} all=\{dock\.map\(\(d\) => d\.app\)\}/);
    expect(drawer).toMatch(/tileCorner\(r, on, others\(r\.app\)\)/);
  });
  it('서랍은 이 참모 것만 · 누르면 내 것 보이기 또는 빈 자리 새로(drawerOpen)', () => {
    expect(space).toMatch(/drawerOpen\(app, dock\.map\(\(d\) => d\.app\), mine\)/);
    expect(drawer).toMatch(/invoke\('craft_launch', \{ app: r\.app, key: how\?\.key \?\? null \}\)/);
  });
  it('Rust 는 부른 쪽이 주인을 모르면 상태 파일 주인(space_by)', () => {
    expect(win).toMatch(/let by = space_by\(by, &info\.by\);/);
  });
});
