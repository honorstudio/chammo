// 폰 스크롤 칸 가장자리 — 첫 카드 바깥 테두리(box-shadow 1px)가 위에서 잘리고, 화면 끝까지 닿는 보기는 마지막 줄이 홈 바 밑으로 숨었다
// (2026-10-11 사용자 폰: 참모 바꾸기 '재울까요?' 카드 위 테두리, 세션 자세히 보기 마지막 진행 줄). 머리 '닫기' 글자는 X 아이콘으로
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';
import peekSrc from './SessionPeek.tsx?raw';
import kitSrc from './kit.tsx?raw';
import pickerSrc from './OrchPicker.tsx?raw';
import browserSrc from './BrowserView.tsx?raw';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rule = (sel: string) => [...css.matchAll(new RegExp(`(?:^|\\n|\\})\\s*${esc(sel)}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]!).join(';');

describe('폰 스크롤 칸 가장자리', () => {
  it('CSS 를 읽었다(빈 글이면 시험이 헛돈다)', () => expect(css.length).toBeGreaterThan(1000));
  it('참모 바꾸기 목록은 위에 틈이 있다 — 맨 위 확인 카드 바깥 테두리가 안 잘린다', () => {
    expect(rule('.m-picker-list')).toMatch(/padding:\s*[1-9]\d*px 16px/);
  });
  it('전체 화면 보기(세션 자세히·파일 글) 맨 아래는 홈 바 위로', () => {
    expect(rule('.m-view .m-log')).toMatch(/padding-bottom:\s*calc\([^)]*env\(safe-area-inset-bottom\)/);
    for (const sel of ['.m-view-body', '.m-pdf .pdfv', '.m-home']) expect(rule(sel)).toMatch(/env\(safe-area-inset-bottom\)/);
  });
  it("머리 '닫기'는 글자 말고 X 아이콘(aria-label·title)", () => {
    for (const src of [peekSrc, pickerSrc, browserSrc]) {
      expect(src).not.toMatch(/>닫기<\/button>/);
    }
    // 공용 조각(kit) — IconBtn 이 aria-label·title 을 붙이고, SheetHead 의 닫기는 IconBtn + IconClose
    expect(peekSrc).toMatch(/<IconBtn label="닫기"[^>]*><IconClose \/>/);
    expect(pickerSrc).toMatch(/<SheetHead [^>]*onClose=|<BottomSheet[^>]*\stitle=/); // 공용 시트에 title 을 주면 그 안 SheetHead
    expect(kitSrc).toMatch(/aria-label=\{label\} title=\{label\}/);
    expect(kitSrc).toMatch(/<IconBtn label="닫기"[^>]*><IconClose \/><\/IconBtn>/);
  });
});
