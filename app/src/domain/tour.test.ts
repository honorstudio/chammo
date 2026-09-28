import { describe, expect, it } from 'vitest';
import { shortcutFor, menuAction } from './shortcuts';
import { shouldShowTour, tourSteps } from './tour';

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
