import { describe, expect, it } from 'vitest';
import { shortcutFor, menuAction } from './shortcuts';
import { shouldShowTour, tourSteps, tourVisible } from './tour';
import { assistant } from '../i18n';

describe('둘러보기 — 마법사 끝난 첫 사용자에게 한 번(아이맥: 단축키·기능을 몰랐다)', () => {
  it('설정을 끝냈고 아직 안 봤으면 띄운다', () => expect(shouldShowTour({ setupDone: true, seen: false })).toBe(true));
  it('본 적 있으면 안 띄운다', () => expect(shouldShowTour({ setupDone: true, seen: true })).toBe(false));
  it('마법사 중엔 안 띄운다', () => expect(shouldShowTour({ setupDone: false, seen: false })).toBe(false));
  it('카드는 4~6장 — 길면 안 읽는다', () => {
    expect(tourSteps().length).toBeGreaterThanOrEqual(4);
    expect(tourSteps().length).toBeLessThanOrEqual(6);
  });
  it('⌘/ 와 메뉴 둘러보기로 다시 연다', () => {
    expect(shortcutFor({ key: '/', metaKey: true, shiftKey: false, altKey: false, ctrlKey: false })).toEqual({ type: 'tour' });
    expect(menuAction('tour')).toEqual({ type: 'tour' });
  });
});

// 2026-10-22 처음 쓰는 사람 QA 9·10·11·22 — 첫 화면(참모 0명)에 맞지 않는 둘러보기
describe('둘러보기 글이 첫 화면과 맞다', () => {
  const all = (none: boolean) => tourSteps({ none }).map((s) => `${s.title} ${s.body} ${(s.keys ?? []).flat().join(' ')}`).join('\n');
  it('참모가 없으면 1장이 새 참모 만들기부터 말한다', () => {
    expect(tourSteps({ none: true })[0]!.body).toContain(`새 ${assistant()} 만들기`);
    expect(tourSteps({ none: false })[0]!.body).not.toContain(`새 ${assistant()} 만들기`);
  });
  it('없는 프로젝트(acme-shop)를 예로 들지 않는다 — 새 사용자 폴더는 비어 있다', () => {
    expect(all(true)).not.toMatch(/acme/);
  });
  // 2026-11-01 ux-start M5(시안 v1 사용자 '추천대로') — 3장이 전체 보기·사무실·다마고치·단축키 표였고 결과를 어디서 보는지는 0장이었다.
  // 맡기기 → 진행 → 결과 → 결정 → 키 셋 순서로
  it('2장 진행 — 오른쪽 스페이스 맨 위 진행 칸', () => {
    const s = tourSteps({ none: true })[1]!;
    expect(s.body).toContain('진행 칸');
    expect(s.body).toContain('오른쪽');
  });
  it('3장 결과 — 채팅의 파일 카드, 스페이스 탭, 보관함', () => {
    const b = tourSteps({ none: true })[2]!.body;
    expect(b).toContain('파일 카드');
    expect(b).toContain('보관함');
  });
  it('4장 결정 — 오른쪽 위 종', () => expect(tourSteps({ none: true })[3]!.body).toMatch(/오른쪽 위 종/));
  it('5장 키 셋(⌘, · ⌘/ · ⌘1~⌘9)만 — 키 표 없음, 놀이 기능은 설정에서', () => {
    const s = tourSteps({ none: true })[4]!;
    expect(s.body).toMatch(/⌘,[\s\S]*⌘\/[\s\S]*⌘1~⌘9/);
    expect(s.keys).toBeUndefined();
    expect(s.body).toContain('설정에서');
  });
  it('사무실·다마고치·전체 보기·리뷰 단축키는 둘러보기에서 뺀다', () => {
    expect(all(true)).not.toMatch(/다마고치|⌥⌘2|⌥⌘3|⌥⌘4|하니터/);
  });
});

describe('둘러보기 자리 말 — 채팅 뷰는 왼쪽 띠·가운데 채팅·오른쪽 스페이스(0.3.11 2차 검증)', () => {
  it('채팅은 가운데, 대시보드는 오른쪽 — 왼쪽이라고 하지 않는다', () => {
    const all = JSON.stringify(tourSteps());
    expect(all).not.toMatch(/왼쪽 [^"]{0,8}대시보드|dashboard on the left|오른쪽 채팅|chat on the right|chat opens on the right|오른쪽에 \S* ?채팅/);
  });
});

describe('둘러보기는 로그인 문이 닫힌 뒤에(2026-11-01 ux-start H1) — 로그인 문 위에 떠 안 보이는 첫 화면을 설명했다', () => {
  it('로그인 문이 떠 있으면(로그인·첫 기기·숫자 등) 둘러보기를 그리지 않는다', () => {
    expect(tourVisible(true, 'login')).toBe(false);
    expect(tourVisible(true, 'start')).toBe(false);
    expect(tourVisible(true, 'offline')).toBe(false);
  });
  it('로그인 문 상태를 아직 못 읽었으면(null) 기다린다 — 깜빡 떴다 덮이지 않게', () => expect(tourVisible(true, null)).toBe(false));
  it('문이 닫혔으면 연 둘러보기를 그린다, 안 열었으면 안 그린다', () => {
    expect(tourVisible(true, 'none')).toBe(true);
    expect(tourVisible(false, 'none')).toBe(false);
  });
});
