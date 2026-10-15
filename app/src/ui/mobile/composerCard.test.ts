// 폰 입력창 두 줄 카드(시안 phone-dash K) — 한 덩어리 둥근 카드, 아래 줄 버튼은 누르는 자리 44px, 왼쪽 색 띠 없음
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';
import src from './Composer.tsx?raw';
import icons from '../Icons.tsx?raw';
import app from './MobileApp.tsx?raw';
import extras from './ComposerExtras.tsx?raw';

const rule = (sel: string) => {
  const m = new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`${sel} 규칙 없음`);
  return m[1]!;
};

describe('입력창 두 줄 카드', () => {
  it('CSS 를 읽었다(빈 글이면 아래 시험이 다 헛돈다)', () => {
    expect(css.length).toBeGreaterThan(1000);
  });
  it('카드 = 한 덩어리 둥근 판, 세로로 글 줄 → 버튼 줄', () => {
    const r = rule('.m-input');
    expect(r).toMatch(/flex-direction\s*:\s*column/);
    expect(r).toMatch(/border-radius\s*:\s*2\dpx/);
    expect(r).not.toMatch(/border-left/);
  });
  it('버튼 줄의 버튼은 누르는 자리 44px', () => {
    const r = rule('.m-cbtn');
    expect(r).toMatch(/width\s*:\s*44px/);
    expect(r).toMatch(/height\s*:\s*44px/);
  });
  it('글 칸은 16px — 아이폰이 눌렀을 때 화면을 키우지 않게', () => {
    expect(rule('.m-input textarea')).toMatch(/font-size\s*:\s*16px/);
  });
  it('입력칸 안 ↵ 보내기는 없어지고 오른쪽 아래 한 자리가 보내기·참모를 바꿔 낀다(멈춤은 따로)', () => {
    expect(src).not.toMatch(/IconEnter/);
    expect(src).toMatch(/composerSlots/);
    expect(src).toMatch(/IconArrowUp/);
  });
  it('위 화살표는 직접 그린 SVG(Icons.tsx)', () => {
    expect(icons).toMatch(/export const IconArrowUp/);
  });
});

describe('오른쪽 아래 참모 프사', () => {
  it('아이콘 20px 규칙에서 빠져 칸 가운데 꽉 찬다(2026-10-11 왼쪽 위로 쏠림)', () => {
    const r = rule('.m-corch .m-cdot .oa svg');
    expect(r).toMatch(/width\s*:\s*100%/);
    expect(r).toMatch(/height\s*:\s*100%/);
  });
});

describe('일하는 중·쓰는 중에도 참모 바꾸기(2026-10-11 사용자 — 일하는 참모에서 못 돌아왔다)', () => {
  it('멈춤은 오른쪽 아래가 아니라 일하는 중일 때만 뜨는 따로 한 칸(44px, 이름 "하던 일 멈추기")', () => {
    expect(src).toMatch(/slots\.stop && \(?\s*<button[^>]*className="m-cbtn m-cstop-sm"[^>]*aria-label=\{`\$\{orchName\} 하던 일 멈추기`\}/);
    expect(rule('.m-cstop-sm > .m-cdot')).toMatch(/width\s*:\s*28px/);
  });
  it('참모 프사 둘레 = 그 참모 컨텍스트 고리(숫자 없음, 80% 넘으면 빨강), 일하는 중이면 고리 + 파란 점(시안 v2 A, 2026-10-11 사용자)', () => {
    // 다른 참모가 말하는 동안(speaker, 2026-10-12)엔 고리·점이 지금 참모 것이라 뺀다
    expect(src).toMatch(/<AvatarRing pct=\{other \? undefined : ctxPct\} dot=\{busy && !other \? 'st-work' : undefined\}/);
    expect(app).toMatch(/ctxPct=\{orch\.sessionId \? ctx\[orch\.sessionId\]\?\.used : undefined\}/);
    expect(rule('.m-corch .m-ring > .m-cdot')).toMatch(/width\s*:\s*32px/);
  });
  it("모델 칩 줄의 '● 일하는 중' 글은 멈춤 칸으로 바뀌어 빠진다", () => {
    expect(extras).not.toMatch(/m-mbusy/);
  });
  it('쓰던 글은 참모마다 — 입력창 칸 = 참모 id, 참모를 바꾸면 입력창이 새로 그려져 그 참모 글을 읽는다', () => {
    expect(app).toMatch(/draftKey=\{orch\.id\}/);
    expect(app).toMatch(/<OrchSpace key=\{orch\.id\}/);
    expect(src).toMatch(/readDraft\(storage\(\), draftKey\)/);
  });
});

describe('모델·에포트 칩(2026-10-11 사용자 "이렇게 클 필요 없어")', () => {
  it('누르는 자리는 다른 버튼과 같은 44px, 보이는 알약은 동그라미와 같은 38px·글자 13px', () => {
    expect(rule('.m-mchip')).toMatch(/height\s*:\s*44px/);
    expect(rule('.m-mchip')).toMatch(/background\s*:\s*transparent/);
    const pill = rule('.m-mchip > span');
    expect(pill).toMatch(/height\s*:\s*38px/);
    expect(pill).toMatch(/font-size\s*:\s*13px/);
  });
  it("칩 글은 짧게('Opus · high') — 판 번호는 시트 머리에서만", () => {
    expect(extras).toMatch(/modelChipShort\(info\)/);
    expect(extras).toMatch(/title=\{label\}/);
  });
});
