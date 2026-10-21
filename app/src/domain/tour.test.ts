import { describe, expect, it } from 'vitest';
import { shortcutFor, menuAction } from './shortcuts';
import { shouldShowTour, tourSteps } from './tour';
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
  it('2장 — 채팅 뷰(기본)엔 작업 패널이 없다: 대시보드를 먼저, ⌘J 는 터미널 뷰라고', () => {
    const b = tourSteps({ none: true })[1]!.body;
    expect(b).toContain('대시보드');
    expect(b).toMatch(/터미널 뷰.*⌘J|⌘J.*터미널 뷰/);
  });
  it('5장 — 하니터는 채팅 뷰(기본)에선 왼쪽 아래다: 오른쪽 위라고만 하지 않는다(QA 2차)', () => {
    const b = tourSteps({ none: true })[4]!.body;
    expect(b).toContain('하니터');
    expect(b).toMatch(/채팅 뷰.*왼쪽 아래/);
  });
  it('단축키 표에 ⌘9 가 두 번 나오지 않는다', () => {
    const keys = tourSteps({ none: true }).flatMap((s) => s.keys ?? []).map(([k]) => k).join(' ');
    expect(keys.match(/⌘9/g)?.length).toBe(1);
  });
});

describe('둘러보기 자리 말 — 채팅 뷰는 왼쪽 띠·가운데 채팅·오른쪽 스페이스(0.3.11 2차 검증)', () => {
  it('채팅은 가운데, 대시보드는 오른쪽 — 왼쪽이라고 하지 않는다', () => {
    const all = JSON.stringify(tourSteps());
    expect(all).not.toMatch(/왼쪽 [^"]{0,8}대시보드|dashboard on the left|오른쪽 채팅|chat on the right|chat opens on the right|오른쪽에 \S* ?채팅/);
  });
});
