// 모드 안 '뒤로' vs 칸 끄기(2026-10-15 사용자 B 확정, docs/design-drafts/mode-nav-v1) — 뒤로는 모드가 그린 키트 BackBar(key mode-back) 하나,
// 칸 끄기는 머리 ⋯ 메뉴 안 글자, 폰은 칸 왼쪽 끝에서 밀면 그 뒤로를 누른다. 값은 지어낸 것
import { describe, expect, it } from 'vitest';
import { BACK_KEY, backText, edgeSwipe } from './modeNav';
import panel from '../ui/mode/ModePanel.tsx?raw';
import phone from '../ui/mobile/PhoneModes.tsx?raw';
import tree from '../ui/mode/ModeTree.tsx?raw';
import kit from '../../hq-template/.claude/skills/hq-mode-kit/kit.tsx?raw';

describe('뒤로 단추 — 키트 BackBar 와 같은 key', () => {
  it('키트가 쓰는 key 를 앱도 쓴다', () => {
    expect(BACK_KEY).toBe('mode-back');
    expect(kit).toContain(`key="${BACK_KEY}"`);
  });
  it('글은 앞 ‹ 를 떼고 돌아갈 곳만(앱은 ‹ 를 아이콘으로 그린다)', () => {
    expect(backText('‹ 오늘', '뒤로 — 오늘')).toBe('오늘');
    expect(backText('‹10월', '')).toBe('10월');
    expect(backText('', '뒤로 — 10월')).toBe('10월');
    expect(backText('', '')).toBe('');
  });
  it('렌더러는 mode-back 을 표시해 그린다(data-mode-back — 폰 밀기가 찾는다)', () => {
    expect(tree).toMatch(/BACK_KEY/);
    expect(tree).toMatch(/data-mode-back/);
  });
});

describe('폰 밀기 = 뒤로 — 칸 왼쪽 끝에서 오른쪽으로', () => {
  const card = { left: 12, width: 378 };
  it('왼쪽 끝 24px 안에서 시작해 60px 넘게 거의 가로로 밀면 뒤로', () => {
    expect(edgeSwipe(card, { x: 20, y: 300 }, { x: 120, y: 310 })).toBe(true);
  });
  it('가운데서 시작한 밀기·짧은 밀기·세로 스크롤·왼쪽으로 민 것은 아니다', () => {
    expect(edgeSwipe(card, { x: 80, y: 300 }, { x: 200, y: 300 })).toBe(false);
    expect(edgeSwipe(card, { x: 18, y: 300 }, { x: 60, y: 300 })).toBe(false);
    expect(edgeSwipe(card, { x: 18, y: 300 }, { x: 100, y: 420 })).toBe(false);
    expect(edgeSwipe(card, { x: 30, y: 300 }, { x: 0, y: 300 })).toBe(false);
  });
  it('폰 모드 칸이 밀기를 듣고 그 칸의 뒤로 단추를 누른다', () => {
    expect(phone).toMatch(/edgeSwipe\(/);
    expect(phone).toMatch(/data-mode-back/);
  });
});

describe('칸 머리 — X 대신 ⋯ 메뉴, 끄기는 그 안 글자', () => {
  it('데스크톱 칸 머리에 끄기 X 아이콘이 없다', () => {
    expect(panel).not.toMatch(/onClick=\{\(\) => turnOff\(m\.name\)\}[^>]*><IconClose/);
    expect(panel).toMatch(/IconMore/);
    expect(panel).toMatch(/label: off, run: \(\) => turnOff\(m\.name\), warn: true/);
  });
  it('폰 칸 머리도 X 대신 ⋯ — 끄기·모드 고르기는 메뉴 안', () => {
    expect(phone).not.toMatch(/<IconBtn label="이 홈에서 끄기"/);
    expect(phone).toMatch(/IconMore/);
  });
});
