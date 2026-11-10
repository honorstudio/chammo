import { describe, expect, it } from 'vitest';
import page from './SessionPage.tsx?raw';
import view from './SpaceView.tsx?raw';
import projectView from './ProjectView.tsx?raw';

// 2026-10-12 패널 하나로 S4·S6 — 세션 '크게' = 가운데 탭(옛 프로젝트 대시보드 o:/s: 대신): 큰 터미널 + 오른쪽 할 일·최근 결정
describe('옛 대시보드·메뉴는 지웠다(패널 하나로 7)', () => {
  it('스페이스에 옛 대시보드·옛 왼쪽 메뉴가 없다', () => {
    expect(view).not.toMatch(/DashboardView \b|<DashboardView|SpaceNav/);
  });
  it('옛 메뉴 \'프로젝트 폴더 더하기\'는 \'모든 프로젝트\' 목록의 + 메뉴로(2026-11-01 projects-view)', () => expect(projectView).toMatch(/label: tr\('있는 폴더 고르기…', 'Choose an existing folder…'\), run: onAddProject/));
});

describe('세션 탭', () => {
  it('s:<id> 로 가면 탭 줄에 그 세션 탭이 생긴다', () => expect(view).toMatch(/if \(k\.startsWith\('s:'\) && view\) setLkHold\(\(h\) => openTab\(h, view, here, k\)\)/));
  it('세션 탭은 탭 줄 안 가운데(독·나무 그대로) — SessionPage', () => expect(view).toMatch(/<SessionPage /));
  it('세션 페이지 = 머리(점·이름·하는 일·경로) + 큰 터미널 + 오른쪽 할 일·최근 결정', () => {
    expect(page).toMatch(/className="sp-term"/);
    expect(page).toMatch(/tr\('할 일', 'To do'\)/);
    expect(page).toMatch(/tr\('최근 결정', 'Recent decisions'\)/);
  });
  it('프로젝트 화면 머리줄에 세션 탭으로 가는 아이콘(이름은 aria-label)', () => expect(projectView).toMatch(/p\.session && onBig && <IconButton[^>]*label=\{tr\('대화 크게 열기', 'Open conversation'\)\}[^\n]*><IconChat \/>/));
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

// 2026-11-10 — 꺼진 세션 탭: 이름이 '꺼진 세션'으로 바뀌고, 고르면 '왼쪽 메뉴에서 골라 줘'만 떴다
import dead from './DeadSessionPage.tsx?raw';
describe('꺼진 세션 탭', () => {
  it('탭 이름은 살아 있을 때 본 이름(기억) — 기억도 꺼진 목록도 없을 때만 \'꺼진 세션\'', () => {
    expect(view).toMatch(/rememberTabSessions\(tabSess\.current, sessions, cardName, \(s\) => tidyLight\(s, helpers\)\)/);
    expect(view).toMatch(/const dead = ss \? null : deadTab\(p\.slice\(2\), tabSess\.current, stopped\);\n\s*const nm = ss \? cardName\(ss\) : dead\?\.name \?\? tr\('꺼진 세션', 'Ended session'\);/);
  });
  it('꺼진 세션 탭을 고르면 빈 안내 대신 꺼진 세션 화면(다시 켜기·탭 닫기)', () => {
    expect(view).toMatch(/\} else if \(pick\.startsWith\('s:'\) && lockerOrch\) \{[\s\S]{0,700}<DeadSessionPage key=\{pick\}[^>]*canResume=\{!!d\.resume && !!onResume\}[\s\S]{0,120}onClose=\{closeDead\} \/>/);
  });
  it('꺼진 세션 화면 = 이름 + 한 줄 + 아이콘 둘(Icons.tsx 직접 그린 SVG, 이름은 aria-label)', () => {
    expect(dead).toMatch(/tr\('꺼졌어 · 대화는 남아 있어', 'Stopped · conversation kept'\)/);
    expect(dead).toMatch(/label=\{tr\('다시 켜기', 'Resume'\)\}[^\n]*><IconResume \/><\/IconButton>/);
    expect(dead).toMatch(/label=\{tr\('탭 닫기', 'Close tab'\)\} onClick=\{onClose\}><IconClose \/><\/IconButton>/);
    expect(dead).not.toMatch(/lucide|[\u{1F300}-\u{1FAFF}]/u);
  });
  it('꺼진 도우미·예약 세션 탭은 세션 목록이 바뀔 때 저절로 닫힌다(지금 탭 줄 + 다른 참모 몫까지)', () => {
    expect(view).toMatch(/goneLightTabs\(h\.tabs, ids, tabSess\.current\);\n\s*if \(gone\.length\) holds\.current\.set\(o,/);
    expect(view).toMatch(/setLkHold\(hold\);\n\s*if \(to\) setPick\(to, 'close'\);\n\s*\}, \[sessions\]\);/);
  });
  it('꺼진 세션 탭 오른쪽 클릭에도 다시 켜기', () => expect(view).toMatch(/: wake \? \[\{ label: tr\('다시 켜기', 'Resume'\), run: \(\) => onResume\?\.\(wake\) \}\] : \[\]/));
});
