// UI 재조사 폰 몫(docs/research/2026-10-11-ui-audit.md, 사용자가 '추천대로' 맡김) — 12px 미만 글자·아래 홈 바 여백·가로 줄 끝·글자 버튼
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';
import composer from './Composer.tsx?raw';
import routine from './RoutineBoard.tsx?raw';
import login from './PhoneLogin.tsx?raw';
import office from './OfficeSheet.tsx?raw';

const rule = (sel: string) => {
  const m = new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`${sel} 규칙 없음`);
  return m[1]!;
};

describe('폰 글자 크기', () => {
  it('12px 미만 글자가 없다(코드 썸네일 미리보기 장식만 예외)', () => {
    const small = [...css.matchAll(/(^|\n)([^{}\n]+)\{([^}]*)\}/g)]
      .filter(([, , , body]) => /font(?:-size)?:[^;]*?\b(\d+(?:\.\d+)?)px/.test(body!) && Number(/font(?:-size)?:[^;]*?\b(\d+(?:\.\d+)?)px/.exec(body!)![1]) < 12)
      .map(([, , sel]) => sel!.trim())
      .filter((sel) => sel !== '.m-thumb-code .m-head');
    expect(small).toEqual([]);
  });
});

describe('아래 홈 바', () => {
  it('파일 크게 보기 본문·홈 화면 아래 여백은 safe-area 를 더한다(24px 고정이면 홈 바 34px 와 겹친다)', () => {
    expect(rule('.m-view-body')).toMatch(/safe-area-inset-bottom/);
    expect(rule('.m-home')).toMatch(/safe-area-inset-bottom/);
    expect(rule('.m-pdf .pdfv')).toMatch(/safe-area-inset-bottom/);
  });
});

describe('가로로 미는 줄', () => {
  it('프로필 시트 가로 줄 끝은 옅게 사라진다(칩이 반쯤 잘린 채 끝나지 않게)', () => {
    expect(rule('.m-prof-row')).toMatch(/mask-image/);
  });
});

describe('익숙한 동작은 아이콘', () => {
  it('붙인 것 빼기는 글리프 ✕ 대신 SVG', () => {
    expect(composer).not.toMatch(/>✕</);
  });
  it("예약 '지침서'·로그인 '그만'·사무실 '재생' 글자 버튼 → 아이콘", () => {
    expect(routine).not.toMatch(/>지침서<\/button>/);
    expect(login).not.toMatch(/>그만<\/button>/);
    expect(office).not.toMatch(/>재생<\/button>/);
  });
});
