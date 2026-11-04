import { describe, expect, it } from 'vitest';
import { paneEscCloses } from './paneClose';

// 기능 화면(예약·리플레이·도구·하니터·리뷰) Esc 닫기 — 입력칸·한글 조합·다른 창이 먼저 가진 Esc 는 건드리지 않는다(2026-11-01 사용자)
describe('paneEscCloses — 기능 화면을 Esc 로 닫나', () => {
  const base = { key: 'Escape', composing: false, prevented: false, editable: false, overlay: false };
  it('글 칸 밖에서 누른 Esc 는 닫는다', () => {
    expect(paneEscCloses(base)).toBe(true);
  });
  it('입력칸(글 칸·터미널·문서 편집)에서 누른 Esc 는 그 칸 것 — 닫지 않는다', () => {
    expect(paneEscCloses({ ...base, editable: true })).toBe(false);
  });
  it('한글 조합 중 Esc 는 닫지 않는다', () => {
    expect(paneEscCloses({ ...base, composing: true })).toBe(false);
  });
  it('다른 곳이 이미 쓴 Esc(채팅 멈추기 등 preventDefault)는 닫지 않는다', () => {
    expect(paneEscCloses({ ...base, prevented: true })).toBe(false);
  });
  it('위에 뜬 창(더보기 펼침·확인 창)이 있으면 그 창이 먼저 — 닫지 않는다', () => {
    expect(paneEscCloses({ ...base, overlay: true })).toBe(false);
  });
  it('Esc 가 아니면 닫지 않는다', () => {
    expect(paneEscCloses({ ...base, key: 'Enter' })).toBe(false);
  });
});
