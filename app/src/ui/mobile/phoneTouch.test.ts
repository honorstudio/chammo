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
  // 폰 QA 2차(10-24) — 사무실 스킨 시트 칩 36·찾기 입력 20, 방 코인 29
  // 스킨 칸 칩·찾기 입력은 G1 인벤토리 가방(10-24)으로 바뀌며 없어짐 — 자리 슬롯 48·칸 최소 44·바닥 단추는 officeG1.test
  it('사무실 아이콘 칩(뽑기·스킨) 44×44', () => { expect(rule('.m-office-chips button.m-ico-chip')).toMatch(/width: 44px/); expect(minH('.m-office-chips button')).toBeGreaterThanOrEqual(44); });
  it('팀 탭 대화·보관함 칸', () => expect(minH('.m-seg button')).toBeGreaterThanOrEqual(44));
  it('팀 대화 머리 아이콘 단추(뒤로)', () => { expect(rule('.m-team-convo .tmx-head .kit-ib')).toMatch(/width: 44px/); expect(rule('.m-team-convo .tmx-head .kit-ib')).toMatch(/height: 44px/); });
  it('방 코인 — 보이는 알약은 그대로, 누름 칸만 44 로 넓힌다', () => {
    expect(rule('.m-office .office-coin::before')).toMatch(/inset:\s*-\d+px/);
    expect(rule('.m-office .office-coin::before')).toMatch(/content:\s*''/);
  });
});
