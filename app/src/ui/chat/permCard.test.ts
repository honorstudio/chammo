import { describe, expect, it } from 'vitest';
import card from './DirectCard.tsx?raw';

// 회사 정책 아래 권한 카드(ADR 0023, Rust perm_card sub "perm") — 기존 직접 카드 모양 그대로, 뜻 풀이·'직접 답 쓰기'만 갈린다
describe('권한 카드(perm)', () => {
  it('뜻 풀이가 따로 — 이번 한 번·안 된다고 알림·답할 때까지 기다림', () => {
    const at = card.indexOf("c.sub === 'perm' ? (");
    expect(at).toBeGreaterThan(-1);
    const part = card.slice(at, at + 900);
    expect(part).toContain('이번 명령 한 번만 실행해요');
    expect(part).toContain('세션에 안 된다고 알려요');
    expect(part).toContain('답할 때까지 세션이 기다려요');
  });
  it('글 답(직접 답 쓰기)은 안 보인다 — Rust 도 글 답을 거절한다', () => {
    expect(card).toContain("c.kind !== 'link' && c.sub !== 'perm' && <button");
  });
  it('앱이 대신 안 누르는 이유 한 줄', () => {
    expect(card).toContain("c.sub === 'perm' && <div className=\"dc-muted\">");
  });
});
