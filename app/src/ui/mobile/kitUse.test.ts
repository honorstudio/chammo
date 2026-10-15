// 폰 화면 공용 조각(ui/mobile/kit) — 화면마다 따로 짜던 고리·시트 머리·닫기를 한 벌로(2026-10-11 사용자 "컴포넌트 정리 느낌으로")
import { describe, expect, it } from 'vitest';

const files = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const src = (name: string) => files[`./${name}`] ?? '';

describe('공용 조각 쓰기', () => {
  it('읽었다', () => {
    expect(Object.keys(files).length).toBeGreaterThan(20);
  });
  it('고리는 kit 의 AvatarRing·UsageRing — 컨텍스트 고리는 입력창 참모 프사로 옮겼다(시안 phone-dash v2 A, 머리줄 프사는 고리 없이)', () => {
    expect(src('Composer.tsx')).toMatch(/<AvatarRing/);
    expect(src('OrchDash.tsx')).not.toMatch(/<AvatarRing/);
    expect(src('OrchDash.tsx')).toMatch(/<UsageRing/);
    expect(src('OrchDash.tsx')).not.toMatch(/<circle/);
  });
  it('아래 시트 머리는 SheetHead(제목 + X) — 공용 시트(BottomSheet)에 title 을 주면 그 안에서 SheetHead', () => {
    for (const f of ['AccountSheet.tsx', 'ComposerExtras.tsx', 'OrchPicker.tsx', 'FileView.tsx', 'PdfSheet.tsx', 'OfficeSheet.tsx', 'LoadSheet.tsx', 'PhoneLogin.tsx']) expect(src(f), f).toMatch(/<SheetHead|<BottomSheet[^>]*\stitle=/);
    expect(src('BottomSheet.tsx')).toMatch(/<SheetHead/);
  });
  it('파일 받기(폰으로 받기) 버튼은 시트 머리 안 — 닫기 X 와 같은 줄', () => {
    for (const f of ['FileView.tsx', 'PdfSheet.tsx', 'OfficeSheet.tsx']) expect(src(f), f).toMatch(/<SheetHead[^]*?<ShareButton[^]*?<\/SheetHead>|<BottomSheet[^>]*actions=\{[^]*?<ShareButton/); // 공용 시트 actions = 머리 안
  });
  it("폰 화면 어디에도 '닫기' 글자 버튼이 없다 — X 아이콘", () => {
    const bad = Object.entries(files).filter(([, t]) => />닫기<\/button>/.test(t)).map(([f]) => f);
    expect(bad).toEqual([]);
  });
});
