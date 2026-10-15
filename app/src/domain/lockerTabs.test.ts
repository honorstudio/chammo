import { describe, expect, it } from 'vitest';
import { closeTab, leaveFolder, openReview, openTab, pathLine, reviewKey, showInTab, tabPick, tabRow } from './lockerTabs';

// 보관함 탭 줄(2026-10-11 사용자) — 맨 왼쪽 폴더 탭(=보관함)은 늘 고정, 파일은 종류 상관없이 탭으로
describe('openTab — 보관함에서 파일을 열면 탭', () => {
  it('처음 열면 탭 하나, 돌아갈 곳 = 지금 보관함 자리', () => {
    expect(openTab(null, 'a', 'l:a#d:10월', '/L/x.md')).toEqual({ orch: 'a', back: 'l:a#d:10월', tabs: ['/L/x.md'] });
  });
  it('그림·영상·html·pdf 도 같은 탭 줄에 쌓인다', () => {
    let h = openTab(null, 'a', 'l:a', '/L/x.md');
    for (const p of ['/L/y.png', '/L/z.mp4', '/L/w.html', '/L/v.pdf']) h = openTab(h, 'a', `d:${h.tabs[h.tabs.length - 1]}`, p);
    expect(h.tabs).toEqual(['/L/x.md', '/L/y.png', '/L/z.mp4', '/L/w.html', '/L/v.pdf']);
    expect(h.back).toBe('l:a'); // 탭에서 탭으로 열어도 돌아갈 폴더는 그대로
  });
  it('이미 열린 파일은 자리를 안 옮긴다', () => {
    const h = openTab(openTab(null, 'a', 'l:a', '/L/x.md'), 'a', 'l:a', '/L/y.png');
    expect(openTab(h, 'a', 'l:a', '/L/x.md').tabs).toEqual(['/L/x.md', '/L/y.png']);
  });
  it('다른 참모 보관함에서 열면 그 참모 탭 줄로 새로', () => {
    const h = openTab(null, 'a', 'l:a', '/L/x.md');
    expect(openTab(h, 'b', 'l:b', '/M/q.png')).toEqual({ orch: 'b', back: 'l:b', tabs: ['/M/q.png'] });
  });
  it('8개 넘으면 오래된 것부터 닫힌다', () => {
    let h = openTab(null, 'a', 'l:a', '/L/0.md');
    for (let i = 1; i < 10; i++) h = openTab(h, 'a', 'l:a', `/L/${i}.md`);
    expect(h.tabs).toHaveLength(8);
    expect(h.tabs[0]).toBe('/L/2.md');
  });
});

describe('tabRow — 탭 줄', () => {
  const h = { orch: 'a', back: 'l:a#d:10월', tabs: ['/L/x.md', '/L/y.png'] };
  it('보관함 화면에서도 보인다 — 폴더 탭이 켜짐', () => {
    expect(tabRow(h, 'a', 'l:a#d:10월')).toEqual({ homeOn: false, folderOn: true, folderTo: 'l:a#d:10월', tabs: [{ path: '/L/x.md', on: false }, { path: '/L/y.png', on: false }] });
  });
  it('파일 탭에선 그 탭이 켜짐', () => {
    expect(tabRow(h, 'a', 'd:/L/y.png')).toEqual({ homeOn: false, folderOn: false, folderTo: 'l:a#d:10월', tabs: [{ path: '/L/x.md', on: false }, { path: '/L/y.png', on: true }] });
  });
  it('연 탭이 없거나 다른 참모면 줄이 없다', () => {
    // 2026-10-12 사용자: 홈·보관함 고정 탭 둘이 있으니 탭 줄은 늘 — 연 탭이 없거나 다른 참모면 고정 탭만
    expect(tabRow(null, 'a', 'l:a')).toEqual({ homeOn: false, folderOn: true, folderTo: 'l:a', tabs: [] });
    expect(tabRow({ ...h, tabs: [] }, 'a', 'l:a#h')).toEqual({ homeOn: true, folderOn: false, folderTo: 'l:a#d:10월', tabs: [] });
    expect(tabRow(h, 'b', 'l:b').tabs).toEqual([]);
    expect(tabRow(h, 'b', 'l:b').folderTo).toBe('l:b');
  });
});

describe('closeTab / leaveFolder', () => {
  const h = { orch: 'a', back: 'l:a', tabs: ['/L/x.md', '/L/y.png', '/L/z.pdf'] };
  it('보던 탭을 닫으면 마지막 탭으로, 다 닫으면 폴더로', () => {
    expect(closeTab(h, '/L/z.pdf', 'd:/L/z.pdf')).toEqual({ hold: { ...h, tabs: ['/L/x.md', '/L/y.png'] }, pick: 'd:/L/y.png' });
    expect(closeTab({ ...h, tabs: ['/L/x.md'] }, '/L/x.md', 'd:/L/x.md')).toEqual({ hold: { ...h, tabs: [] }, pick: 'l:a' });
  });
  it('안 보던 탭을 닫으면 화면은 그대로', () => {
    expect(closeTab(h, '/L/x.md', 'd:/L/z.pdf').pick).toBeNull();
    expect(closeTab(h, '/L/x.md', 'l:a').pick).toBeNull();
  });
  it('폴더 화면에서 파일 탭으로 가면 돌아올 폴더를 지금 자리로', () => {
    expect(leaveFolder(h, 'a', 'l:a#d:견적')?.back).toBe('l:a#d:견적');
    expect(leaveFolder(h, 'a', 'd:/L/x.md')).toBe(h);
  });
  // 2026-10-12 사용자('열받는 포인트'): 폴더에서 홈 탭 갔다 보관함 탭을 누르면 맨 위 보관함으로 갔다 — 연 탭이 없으면 돌아갈 자리를 안 적어서
  it('연 탭이 없어도(홈 탭으로 갈 때) 돌아올 폴더를 적는다', () => {
    expect(leaveFolder(null, 'a', 'l:a#d:자료')).toEqual({ orch: 'a', back: 'l:a#d:자료', tabs: [] });
    expect(tabRow(leaveFolder(null, 'a', 'l:a#d:자료'), 'a', 'l:a#h').folderTo).toBe('l:a#d:자료');
  });
  it('맨 위 보관함이면 새로 안 만든다(기본이 맨 위) · 다른 참모 탭 줄은 이 참모 것으로 바뀐다', () => {
    expect(leaveFolder(null, 'a', 'l:a')).toBeNull();
    expect(leaveFolder({ orch: 'b', back: 'l:b', tabs: ['/L/q.md'] }, 'a', 'l:a#d:자료')).toEqual({ orch: 'a', back: 'l:a#d:자료', tabs: [] });
  });
});

describe('pathLine — 탭 문서 머리 작은 경로 한 줄', () => {
  it('보관함 안이면 보관함 속 폴더', () => {
    expect(pathLine('/H/Documents/Chammo/가나/자료/x.md', '/H/Documents/Chammo/가나', '/H')).toBe('자료');
    expect(pathLine('/H/Documents/Chammo/가나/x.md', '/H/Documents/Chammo/가나', '/H')).toBe('보관함');
    expect(pathLine('/H/Documents/Chammo/가나/10월/세부/y.xlsx', '/H/Documents/Chammo/가나', '/H')).toBe('10월 / 세부');
  });
  it('밖이면 ~ 로 줄인 폴더', () => {
    expect(pathLine('/H/Desktop/dev/sheet-demo/out/매출_정리.xlsx', '/H/Documents/Chammo/가나', '/H')).toBe('~/Desktop/dev/sheet-demo/out');
    expect(pathLine('/opt/x/y.md', '', '/H')).toBe('/opt/x');
  });
});

// 홈·모드 v2 A(사용자 10/11 "추천대로") — 보여 주기(scripts/show·채팅 파일 카드)는 화면을 안 옮기고 지금 참모 탭 줄에 새 탭
describe('showInTab — 보여 준 파일을 지금 자리 새 탭으로 여나', () => {
  it('참모 화면(보관함·문서·홈)이면 탭', () => {
    expect(showInTab('l:a', 'a')).toBe(true);
    expect(showInTab('l:a#d:견적', 'a')).toBe(true);
    expect(showInTab('d:/L/x.md', 'a')).toBe(true);
    expect(showInTab('o:a', 'a')).toBe(true);
  });
  // 10/12 사용자 — 홈(oh:)·기능 화면(f:)에서 띄운 PDF 가 화면을 덮는 모달로 떴다. 거기서도 새 탭으로 열고 그 탭으로 간다
  it('오케스트레이터 홈·기능 화면에서도 탭', () => {
    expect(showInTab('oh:', 'a')).toBe(true);
    expect(showInTab('f:', 'a')).toBe(true);
  });
  // 시안 검토도 탭이라(fix/curation-space) 검토 중에 띄운 것도 같은 탭 줄 새 탭
  it('시안 검토 중이어도 탭, 보는 참모가 없으면 예전 길', () => {
    expect(showInTab('c:/L/v1.html', 'a')).toBe(true);
    expect(showInTab('l:a', null)).toBe(false);
  });
});

describe('tabRow — 홈(l:<참모>#h)에선 켜진 탭이 없다(홈·모드 v1 1b)', () => {
  const h = { orch: 'a', back: 'l:a', tabs: ['/L/x.md'] };
  it('홈에서 연 탭의 폴더 탭은 홈이 아니라 보관함으로 돌아간다', () => {
    expect(openTab(null, 'a', 'l:a#h', '/L/y.md').back).toBe('l:a');
    expect(leaveFolder(h, 'a', 'l:a#h')).toBe(h);
  });
  it('홈이면 홈 탭 켜짐·폴더 탭 꺼짐, 보관함이면 폴더 탭 켜짐', () => {
    expect(tabRow(h, 'a', 'l:a#h').homeOn).toBe(true);
    expect(tabRow(h, 'a', 'l:a#h')?.folderOn).toBe(false);
    expect(tabRow(h, 'a', 'l:a').homeOn).toBe(false);
    expect(tabRow(h, 'a', 'l:a')?.folderOn).toBe(true);
    expect(tabRow(h, 'a', 'l:a#d:견적')?.folderOn).toBe(true);
  });
});

// 2026-10-12 패널 하나로 S4 — 세션 '크게' = 가운데 탭. 탭 줄에 문서 탭과 나란히(열쇠 s:<id>), 옛 프로젝트 대시보드(o:/s:) 대신
describe('세션 탭(s:<id>)', () => {
  it('세션을 크게 열면 탭 줄 끝에 s:<id>, 돌아갈 보관함 자리는 그대로', () => {
    const h = openTab(null, 'a', 'l:a#d:자료', '/L/x.md');
    expect(openTab(h, 'a', 'd:/L/x.md', 's:ses1')).toEqual({ orch: 'a', back: 'l:a#d:자료', tabs: ['/L/x.md', 's:ses1'] });
  });
  it('세션 화면이면 그 탭이 켜짐', () => {
    const h = { orch: 'a', back: 'l:a', tabs: ['/L/x.md', 's:ses1'] };
    expect(tabRow(h, 'a', 's:ses1').tabs).toEqual([{ path: '/L/x.md', on: false }, { path: 's:ses1', on: true }]);
  });
  it('보던 세션 탭을 닫으면 앞 탭 화면으로(문서는 d:, 세션은 s:)', () => {
    const h = { orch: 'a', back: 'l:a', tabs: ['s:ses0', 's:ses1'] };
    expect(closeTab(h, 's:ses1', 's:ses1').pick).toBe('s:ses0');
    expect(closeTab({ ...h, tabs: ['/L/x.md', 's:ses1'] }, 's:ses1', 's:ses1').pick).toBe('d:/L/x.md');
    expect(closeTab(h, 's:ses0', 's:ses1').pick).toBeNull();
  });
  it('tabPick — 탭 열쇠 → 화면 키', () => {
    expect(tabPick('s:ses1')).toBe('s:ses1');
    expect(tabPick('/L/x.md')).toBe('d:/L/x.md');
  });
});

// 시안 검토 = 띄운 참모 탭 줄의 한 탭(c:<경로>) — 창 전체를 덮는 검토 모드가 X 로 안 닫혔다(2026-10-12 사용자, 앱 재시작).
// 원인: html 탭(d:<경로>)에서 시안을 알아보고 검토(c:)로 가면, 닫기 = 그 탭으로 돌아가기 → 그 탭이 또 시안을 알아보고 검토로 튀는 고리
describe('시안 검토 탭(c:<경로>)', () => {
  it('reviewKey·tabPick — 검토 탭 열쇠는 화면 키 그대로', () => {
    expect(reviewKey('/L/v1.html')).toBe('c:/L/v1.html');
    expect(tabPick('c:/L/v1.html')).toBe('c:/L/v1.html');
  });
  it('띄운 시안은 탭 줄 끝에 검토 탭', () => {
    const h = openTab(null, 'a', 'l:a', '/L/x.md');
    expect(openReview(h, 'a', 'd:/L/x.md', '/L/v1.html').tabs).toEqual(['/L/x.md', 'c:/L/v1.html']);
    expect(openReview(null, 'a', 'l:a#h', '/L/v1.html')).toEqual({ orch: 'a', back: 'l:a', tabs: ['c:/L/v1.html'] });
  });
  it('같은 시안의 html 탭은 그 자리에서 검토 탭으로 바뀐다(둘이 나란히 남지 않는다)', () => {
    const h = { orch: 'a', back: 'l:a', tabs: ['/L/x.md', '/L/v1.html', '/L/y.png'] };
    expect(openReview(h, 'a', 'd:/L/v1.html', '/L/v1.html').tabs).toEqual(['/L/x.md', 'c:/L/v1.html', '/L/y.png']);
  });
  it('이미 검토 탭이 있으면 자리 그대로', () => {
    const h = { orch: 'a', back: 'l:a', tabs: ['c:/L/v1.html', '/L/x.md'] };
    expect(openReview(h, 'a', 'd:/L/x.md', '/L/v1.html').tabs).toEqual(['c:/L/v1.html', '/L/x.md']);
  });
  it('검토 화면이면 그 탭이 켜짐', () => {
    const h = { orch: 'a', back: 'l:a', tabs: ['/L/x.md', 'c:/L/v1.html'] };
    expect(tabRow(h, 'a', 'c:/L/v1.html').tabs).toEqual([{ path: '/L/x.md', on: false }, { path: 'c:/L/v1.html', on: true }]);
  });
  it('재현 — html 탭에서 연 검토를 닫으면 그 html 탭(d:)으로 돌아가지 않는다(돌아가면 또 검토로 튄다)', () => {
    const fromTab = openReview(openTab(null, 'a', 'l:a', '/L/v1.html'), 'a', 'd:/L/v1.html', '/L/v1.html');
    const r = closeTab(fromTab, 'c:/L/v1.html', 'c:/L/v1.html');
    expect(r.pick).not.toBe('d:/L/v1.html');
    expect(r.pick).toBe('l:a');
    expect(r.hold.tabs).toEqual([]);
  });
  it('검토를 닫으면 앞 탭으로, 다른 탭을 보던 중이면 화면 그대로', () => {
    const h = { orch: 'a', back: 'l:a#d:자료', tabs: ['/L/x.md', 'c:/L/v1.html'] };
    expect(closeTab(h, 'c:/L/v1.html', 'c:/L/v1.html').pick).toBe('d:/L/x.md');
    expect(closeTab(h, 'c:/L/v1.html', 'd:/L/x.md').pick).toBeNull();
  });
});
