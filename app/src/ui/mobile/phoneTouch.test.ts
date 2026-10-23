// 폰 누름 칸 44px — 데스크톱과 같이 쓰는 카드(chat/DirectCard)는 데스크톱 크기(단추 40·'직접 답 쓰기' 글 링크 19)라
// 폰 자기 카드(.m-direct)만 키웠고 다른 기기 카드·채팅 안 카드는 작았다(2026-10-23 폰 QA)
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';

const rule = (sel: string) => css.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';

describe('폰 카드 누름 칸', () => {
  it('카드 단추는 폰 어디서나 44 이상', () => expect(rule('.m-app .dc-btn')).toMatch(/min-height: 44px/));
  it("'직접 답 쓰기' 글 링크도 누름 칸 44", () => expect(rule('.m-app .dc-link')).toMatch(/min-height: 44px/));
  it('카드 아이콘 단추 44', () => { expect(rule('.m-app .dc-acts .dc-ib')).toMatch(/width: 44px/); expect(rule('.m-app .dc-acts .dc-ib')).toMatch(/height: 44px/); });
});

describe('폰 작은 단추들 44(폰 QA 10-23 자동 점검)', () => {
  const minH = (sel: string) => Number(rule(sel).match(/min-height: (\d+)px/)?.[1] ?? 0);
  it("세션 줄 펼침 '대화 보기'", () => expect(minH('.m-speek-go')).toBeGreaterThanOrEqual(44));
  it('칩(보관함 프로젝트 칩 포함)', () => { expect(minH('.m-chip')).toBeGreaterThanOrEqual(44); expect(minH('.m-lk-chips .m-chip')).toBeGreaterThanOrEqual(44); });
  it('보관함 카드·목록 토글', () => expect(rule('.m-lk-seg button')).toMatch(/height: 44px/));
});
