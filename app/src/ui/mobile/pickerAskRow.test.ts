import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';
import src from './OrchPicker.tsx?raw';

// 2026-10-11 사용자 폰: 묻는 참모 줄에 '.m-ask'(결정 카드 세로 판)를 붙여 줄이 세로로 무너졌고,
// 바로 답하기 보내기는 지워진 .m-in-btn·.m-key 를 써서 빈 파란 네모였다
describe('참모 바꾸기 — 묻는 참모 줄·바로 답하기', () => {
  it('CSS 를 읽었다', () => expect(css.length).toBeGreaterThan(1000));
  it('묻는 참모 줄은 결정 카드 클래스(.m-ask)를 안 쓴다', () => {
    expect(src).not.toMatch(/' m-ask'/);
    expect(css).toMatch(/\.m-orch\.m-asking[\s,{]/);
  });
  it('바로 답하기 보내기는 자기 규칙이 있는 클래스를 쓴다', () => {
    expect(src).not.toMatch(/m-in-btn|m-key/);
    expect(css).toMatch(/\.m-wait-go\s*\{/);
  });
});
