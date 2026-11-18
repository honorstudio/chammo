// 대화창(.od-box) 글 칸 모양이 체크·스위치에 새지 않는다 — 프로필 '키즈 참모' 스위치가 56×38 흰 칸이 됐다(11-17 사용자 "체크버튼 왜 이렇게 큼").
// 실제 그림·크기는 app/e2e/kids-profile 하네스가 본다
import { describe, expect, it } from 'vitest';
import css from './styles.css?raw';
import picker from './avatar/AvatarPicker.tsx?raw';

describe('od-box 글 칸 규칙', () => {
  it('체크박스·라디오는 빼고 글 칸에만', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]*\.od-box input[^{]*\{/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r).toMatch(/:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/);
  });
  it('프로필 키즈 스위치는 설정 줄과 같은 cfg-sw', () => {
    expect(picker).toMatch(/role="switch" className="cfg-sw"/);
  });
  it('키즈 상태는 nick 객체가 아니라 hasNick·key 로 한 번만 읽는다', () => {
    expect(picker).toMatch(/\}, \[hasNick, key\]\);/);
    expect(picker).not.toMatch(/\}, \[nick, key\]\);/);
  });
});
