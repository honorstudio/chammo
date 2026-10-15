// 참모 바꾸기 시트(시안 phone-dash O1, 2026-10-11 사용자 "글자가 너무 많다") — 이름 + 마지막 말 한 줄, 상태 = 점, 컨텍스트 = 프사 고리, 닫기 = X
import { describe, expect, it } from 'vitest';
import picker from './OrchPicker.tsx?raw';
import wake from './OrchWake.tsx?raw';
import css from './mobile.css?raw';

describe('참모 바꾸기 시트', () => {
  it("글자 배지·'컨텍스트 N%' 글·맡은 일 글줄이 줄에 없다(맡은 일은 길게 눌러 메뉴)", () => {
    expect(picker).not.toMatch(/st-tag/);
    expect(picker).not.toMatch(/컨텍스트 \{/);
    expect(picker).not.toMatch(/m-orch-role/);
  });
  it("머리 '닫기'는 글자 대신 X 아이콘", () => {
    expect(picker).not.toMatch(/>닫기</);
    expect(picker).toMatch(/SheetHead|<BottomSheet[^>]*\stitle=/);
  });
  it('프사 = 컨텍스트 고리 + 상태 점(공용 kit)', () => {
    expect(picker).toMatch(/AvatarRing/);
    expect(picker).toMatch(/orchDot/);
  });
  it('꺼진 참모는 ▶ 없이 줄을 누르면 깨우기 확인', () => {
    expect(wake).not.toMatch(/m-off-go/);
    expect(wake).toMatch(/깨울까요/);
  });
  it('묻는 참모 줄은 그 참모 색을 옅게 깐 면(나한테 묻는 것 한 규칙, 2026-10-11 노랑에서 바꿈), 왼쪽 띠 없음', () => {
    expect(css).toMatch(/\.m-orch\.m-asking, \.m-need \{[^}]*background: color-mix\(in srgb, var\(--orch-solid/);
    expect(css).not.toMatch(/\.m-orch[^{]*\{[^}]*border-left/);
  });
});
