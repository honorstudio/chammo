import { describe, expect, it } from 'vitest';
import css from './chat.css?raw';

// 2026-11-13 perf-night: 채팅 뷰에선 참모마다 터미널(xterm WebGL)이 불투명한 채팅 판(.chat) 밑에 깔려 있는데,
// 덮여 있어도 세션 출력마다 다시 그렸다(가려진 칸은 visibility:hidden 이라 xterm 의 '안 보이면 멈춤'(IntersectionObserver)이 안 걸렸다).
// 하네스 실측(참모 3명 일하는 중 20초): GL 그리기 3,402 → 0, GPU 프로세스 2.8 → 0.0%, 웹 6.1 → 4.4%.
// 화면(.xterm-screen)만 빼면 xterm 이 멈췄다가 채팅이 닫히면 통째로 다시 그린다 — 버퍼(채팅이 읽는 화면 글)·크기 맞추기는 그대로
describe('채팅에 덮인 터미널은 안 그린다', () => {
  it('채팅 판이 덮은 칸의 xterm 화면은 display:none', () => {
    expect(css.length).toBeGreaterThan(100); // ?raw 가 빈 글이면 시험이 헛돈다
    expect(css).toMatch(/\.pane:has\(> \.chat\) \.xterm-screen\s*\{\s*display:\s*none;?\s*\}/);
  });
});
