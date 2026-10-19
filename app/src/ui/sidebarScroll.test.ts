// 2026-10-19 사용자(report-241): 터미널 뷰 사이드바가 휠로 안 내려간다 — 스크롤 칸이 맨 아래 프로젝트 목록(.list) 하나뿐이라
// 예약이 14개쯤 되면 위 칸들이 자리를 다 먹어 .list 높이가 0, 예약 아래쪽·프로젝트 목록이 창 밖으로 잘렸다
// (하네스 .shots/fix-sidebar-scroll: .list 739/0, 단추 22개가 아래로 숨음, 휠이 걸릴 칸 없음).
// 고친 모양: 검색칸 아래부터 프로젝트 목록 끝까지 한 스크롤 칸(.side-scroll) — 머리·검색·발은 제자리
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from './Sidebar';
import type { RoutineItem } from '../domain/routine';
import styles from './styles.css?raw';

const routines: RoutineItem[] = Array.from({ length: 14 }, (_, i) => ({ name: `demo-routine-${i + 1}`, state: 'ok', status: '끝 09:00', line: '매일 09:00', cloud: false, next: null, ref: '' }));
const html = renderToStaticMarkup(createElement(Sidebar, {
  routines, orchestrator: undefined, projects: [], selected: { kind: 'all' }, onSelect: () => {},
  footer: 'claude 0.0.0', badges: {}, idleProjects: ['idle-a', 'idle-b'], query: '', onQuery: () => {}, searchRef: { current: null },
}));
// .side-scroll 칸 안의 글(닫는 태그는 aside 바로 앞 발 칸 직전까지)
const inner = html.split('<div class="side-scroll">')[1]?.split('<div class="sidefoot">')[0] ?? '';
const rule = (sel: string) => styles.match(new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[2] ?? '';

describe('터미널 뷰 사이드바 — 한 줄기로 스크롤', () => {
  it('CSS 를 읽었다(빈 글이면 vite test.css.include 밖)', () => {
    expect(styles.length).toBeGreaterThan(1000);
  });
  it('스크롤 칸이 하나 있고 예약·프로젝트 목록이 다 그 안에', () => {
    expect(html.match(/class="side-scroll"/g)?.length).toBe(1);
    expect(inner).toContain('demo-routine-14');
    expect(inner).toContain('demo-routine-1<');
    expect(inner).toContain('class="list"');
    expect(inner).toContain('idle-b');
  });
  it('머리·검색·발은 스크롤 칸 밖(검색 ⌘K 는 늘 보인다)', () => {
    expect(inner).not.toContain('class="panel-head"');
    expect(inner).not.toContain('class="search"');
    expect(html).toContain('<div class="sidefoot">');
  });
  it('.side-scroll 은 남은 높이를 받고(min-height 0) 세로로 스크롤', () => {
    const r = rule('.side-scroll');
    expect(r).toMatch(/flex:\s*1/);
    expect(r).toMatch(/min-height:\s*0/);
    expect(r).toMatch(/overflow-y:\s*auto/);
  });
  it('칸으로 감싸도 고른 줄 표시(on)는 그대로 — 오케스트레이터 홈', () => {
    const on = renderToStaticMarkup(createElement(Sidebar, {
      routines, orchestrator: undefined, projects: [], selected: { kind: 'orchHome' }, onSelect: () => {},
      badges: {}, idleProjects: [], query: '', onQuery: () => {}, searchRef: { current: null },
    }));
    expect(on).toContain('class="grp-link on"');
  });
  it('안쪽 .list 는 따로 스크롤하지 않는다(칸 안 칸 스크롤이면 휠이 또 갇힌다)', () => {
    expect(styles).not.toMatch(/\.side \.list[^{]*\{[^}]*overflow/);
  });
});
