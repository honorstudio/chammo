import { describe, expect, it } from 'vitest';
import src from './LicensesDialog.tsx?raw';
import css from './licenses.css?raw';

// 설치 파일에 전체 고지(소스는 공개 저장소, 팀 기능은 설치 파일에만) — 창이 큰 파일을 감당하고, 사용 조건·Chammo 자체 안내를 보여 준다
describe('라이선스 창', () => {
  it('사용 조건 — TERMS.md 를 읽고, 없으면 줄을 안 그린다', () => {
    expect(src).toContain("fetch('/licenses/TERMS.md')");
    expect(src).toContain('termsBody');
    expect(src).toMatch(/\{terms && \(/);
    expect(src).toContain("tr('사용 조건', 'Terms of use')");
  });
  it('Chammo 자체 안내 줄 — 한·영, 공개 저장소 소스는 AGPL-3.0', () => {
    expect(src).toMatch(/tr\('Chammo 는 Honor Studio[^']*공개 저장소[^']*AGPL-3\.0[^']*', 'Chammo is[^']*public repository[^']*AGPL-3\.0/);
  });
  it('고지 본문은 펼 때만 그린다 — 큰 파일이어도 창이 안 무겁게', () => {
    expect(src).toMatch(/onToggle=/);
    expect(src).toMatch(/\{open && <pre>/);
  });
  it('제목은 그대로, 긴 목록은 창 안에서 스크롤', () => {
    expect(src).toContain("<h2>{tr('오픈소스 라이선스', 'Open-source licenses')}</h2>");
    expect(src).toContain('lic-scroll');
    expect(css).toMatch(/\.lic-scroll \{[^}]*overflow: auto/);
    expect(css).not.toMatch(/border-left/);
  });
});
