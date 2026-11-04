import { describe, expect, it } from 'vitest';
import card from './DirectCard.tsx?raw';

// 컴퓨터끼리 숫자 확인 카드(계획 2026-11-01-peer-relay C-3b, Rust device_cards::peer_link_row) — 폰 숫자 카드처럼 6자리를 크게,
// 설명은 '그 컴퓨터 화면 숫자와 같을 때만'. 숫자 넣기 칸(새 기기 허용 device 카드 전용)은 안 뜬다
describe('컴퓨터 연결 카드(peer-link)', () => {
  it('6자리를 크게 보인다 — 폰 숫자 카드와 같은 자리', () => {
    expect(card).toMatch(/\(c\.sub === 'phone-link' \|\| c\.sub === 'peer-link'\) && c\.code && <div className="dc-code"/);
  });
  it('뜻 풀이가 따로 — 두 컴퓨터 참모가 이어진다, 10분 뒤 없던 일', () => {
    const at = card.indexOf("c.sub === 'peer-link' ? (");
    expect(at).toBeGreaterThan(-1);
    const part = card.slice(at, at + 700);
    expect(part).toContain('컴퓨터 화면 숫자와 같을 때만');
    expect(part).toContain('10분 뒤 없던 일');
  });
  it('숫자 넣기(NumberEntry)는 device 카드에서만', () => {
    expect(card).toContain("const dev = c.kind === 'link' && c.sub === 'device' ? c.dev : undefined;");
  });
});
