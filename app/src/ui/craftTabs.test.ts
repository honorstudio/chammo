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
    const dock = space.slice(space.indexOf('dock.map((it)'), space.indexOf('row.tabs.map'));
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
    expect(space).toMatch(/craftTarget\(showOwner\(by \?\? '', orchIds, holders\)/);
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

describe('Craft 는 지금 맥만', () => {
  it('윈도우에선 탭 줄의 앱 서랍 단추를 숨긴다(0.3.4 2차 검증 — 열면 os error 원문)', () => {
    expect(space).toMatch(/\{!IS_WIN && \( \/\/ Craft 는 지금 맥만[\s\S]{0,200}setPick\(APPS_KEY\)/);
  });
});
