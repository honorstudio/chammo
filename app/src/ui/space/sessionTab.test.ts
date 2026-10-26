import { describe, expect, it } from 'vitest';
import page from './SessionPage.tsx?raw';
import view from './SpaceView.tsx?raw';
import locker from './LockerPage.tsx?raw';

// 2026-10-12 패널 하나로 S4·S6 — 세션 '크게' = 가운데 탭(옛 프로젝트 대시보드 o:/s: 대신): 큰 터미널 + 오른쪽 할 일·최근 결정
describe('옛 대시보드·메뉴는 지웠다(패널 하나로 7)', () => {
  it('스페이스에 옛 대시보드·옛 왼쪽 메뉴가 없다', () => {
    expect(view).not.toMatch(/DashboardView \b|<DashboardView|SpaceNav/);
  });
  it('옛 메뉴 \'프로젝트 폴더 더하기\'는 \'모든 프로젝트\' 펼침 맨 아래로', () => expect(locker).toMatch(/className="lk-pop-add"/));
});

describe('세션 탭', () => {
  it('s:<id> 로 가면 탭 줄에 그 세션 탭이 생긴다', () => expect(view).toMatch(/if \(k\.startsWith\('s:'\) && view\) setLkHold\(\(h\) => openTab\(h, view, here, k\)\)/));
  it('세션 탭은 탭 줄 안 가운데(독·나무 그대로) — SessionPage', () => expect(view).toMatch(/<SessionPage /));
  it('세션 페이지 = 머리(점·이름·하는 일·경로) + 큰 터미널 + 오른쪽 할 일·최근 결정', () => {
    expect(page).toMatch(/className="sp-term"/);
    expect(page).toMatch(/tr\('할 일', 'To do'\)/);
    expect(page).toMatch(/tr\('최근 결정', 'Recent decisions'\)/);
  });
  it('진행 중 칩 머리줄에도 크게(아이콘, 이름은 aria-label)', () => expect(locker).toMatch(/onBigProject && <IconButton[^>]*label=\{tr\('크게', 'Open large'\)\}[^\n]*><IconMaximize \/>/));
});

// 191.png — 우클릭(맥 웹뷰는 우클릭 뒤에 click 을 하나 더 보낸다)이 먼저 열기로 처리되던 것: 우클릭 메뉴를 열면 뒤따라오는 click 을 삼키고, 끌기도 안 시작
import actions from '../orchActions.tsx?raw';
import drag from './dragPath.ts?raw';
describe('우클릭은 열기·끌기가 아니다', () => {
  it('우클릭으로 메뉴를 열면 뒤따라오는 click 을 삼킨다(메뉴 안 click 은 그대로)', () => {
    expect(actions).toMatch(/if \(e\.type === 'contextmenu'\) swallowTrailingClick\(\);/);
    expect(actions).toMatch(/closest\?\.\('\.od-menu'\)\) return;/);
  });
  it('끌기는 왼쪽 버튼 + ctrl 없을 때만', () => expect(drag).toMatch(/if \(e\.button !== 0 \|\| e\.ctrlKey\) return;/));
});
