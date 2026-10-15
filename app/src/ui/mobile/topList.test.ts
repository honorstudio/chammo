// 폰 대시보드 위 칸 한 칸 목록(시안 phone-tabs v2 A) · 나한테 묻는 것 색(v3 C) — CSS 규칙 시험
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';
import dash from './OrchDash.tsx?raw';
import picker from './OrchPicker.tsx?raw';

const rule = (sel: string) => {
  const m = new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`${sel} 규칙 없음`);
  return m[1]!;
};

describe('위 칸 한 칸 목록', () => {
  it('CSS 를 읽었다(빈 글이면 아래 시험이 다 헛돈다)', () => {
    expect(css.length).toBeGreaterThan(1000);
  });
  it('줄·다음 할 일은 누르는 자리 44px 이상', () => {
    for (const sel of ['.m-lrow', '.m-lnext', '.m-ldone', '.m-wait-top']) expect(rule(sel)).toMatch(/min-height\s*:\s*4[4-9]px/);
  });
  it('흐름 안에서 늘어난다 — 떠서 아래 파일 칸을 덮지 않고 층도 안 쌓는다(2026-10-04 실기기)', () => {
    for (const sel of ['.m-top', '.m-need, .m-runcard', '.m-runcard']) expect(rule(sel)).not.toMatch(/position\s*:\s*(absolute|fixed)|z-index|max-height/);
  });
  it('왼쪽 색 띠 없음', () => {
    expect(css).not.toMatch(/\.m-(need|runcard|lrow|ldone|wait-card|ask)[^{]*\{[^}]*border-left/);
  });
  it('옛 탭 숫자(일·할 일·결정)는 없다', () => {
    expect(dash).not.toMatch(/m-dtab|dashTabs/);
    expect(css).not.toMatch(/\.m-dtab/);
  });
});

describe('나한테 묻는 것 = 그 참모 색을 옅게 깐 면(노랑 아님)', () => {
  const ASK = '.m-ask, .m-wait-card, .m-orch.m-asking, .m-need';
  it('네 자리가 한 규칙 — 참모 색(--orch-solid)을 --ask-mix 만큼 깐다', () => {
    expect(rule(ASK)).toMatch(/background\s*:\s*color-mix\(in srgb,\s*var\(--orch-solid, var\(--working\)\)\s*var\(--ask-mix\)/);
  });
  it('밝음 9% · 다크 18%', () => {
    expect(css).toMatch(/--ask-mix:\s*9%/);
    expect(css).toMatch(/prefers-color-scheme:\s*dark[\s\S]*--ask-mix:\s*18%/);
  });
  it('네 자리 어디에도 노란 면(--warn-bg)이 남지 않았다', () => {
    for (const sel of ['.m-ask', '.m-wait-card']) expect(rule(sel)).not.toMatch(/warn-bg/);
    expect(css).not.toMatch(/\.m-orch\.m-asking\s*\{[^}]*warn-bg/);
  });
  it("답을 기다림 카드 — '그 참모로 가서 보기' 글 버튼 없이 머리줄이 그 참모로 가는 버튼(화살표 아이콘)", () => {
    expect(picker).not.toMatch(/가서 보기<\/button>/);
    expect(picker).toMatch(/className="m-wait-top" onClick=\{\(\) => onPick\(w\.orch\)\}[^>]*aria-label=/);
    expect(picker).toMatch(/<IconChevron \/>\s*\n?\s*<\/button>/);
  });
});
