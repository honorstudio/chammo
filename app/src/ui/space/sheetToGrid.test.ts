import { describe, expect, it } from 'vitest';
import page from './SheetPage.tsx?raw';
import dock from '../../../src-tauri/src/craft_dock.rs?raw';

// 2026-10-21 사용자(A안): 엑셀 페이지는 빠른 보기·몇 칸 고치기 그대로, 머리줄에 '참모 표로 열기' — 같은 파일을 참모 표(GridCraft) 칸으로.
// 길은 서랍 '최근 파일'과 같은 craft_open_file(= scripts/craft open gridcraft --native <파일>, 닫으면 그 자리에 저장)
const at = page.indexOf('cv-chip cv-sheet-grid');
const btn = page.slice(page.lastIndexOf('<button', at), page.indexOf('</button>', at)); // 그 단추 하나

describe("엑셀 페이지 '참모 표로 열기'", () => {
  it('머리줄에 글자 단추 하나 — 아이콘+글자 줄줄이 아님', () => {
    expect(btn).toMatch(/className="cv-chip cv-sheet-grid"/);
    expect(btn).toMatch(/tr\('참모 표로 열기', 'Open in Chammo Grid'\)/);
    expect(btn).not.toMatch(/<Icon/);
  });
  it('누르면 그 파일을 참모 표로 — craft_open_file(app gridcraft, path)', () => {
    expect(page).toMatch(/invoke\('craft_open_file', \{ app: 'gridcraft', path \}\)/);
  });
  it('저장 중엔 못 누른다 — 고친 칸이 파일에 다 들어간 뒤 넘긴다', () => {
    expect(btn).toMatch(/disabled=\{status\.s === 'saving'/);
  });
  it('못 열면 머리 아래 알림 줄에 이유', () => {
    expect(page).toMatch(/setGridErr\(/);
    expect(page).toMatch(/gridErr/);
  });
  it("Rust 쪽 craft_open_file 은 scripts/craft open <앱> --native <파일> 그대로", () => {
    expect(dock).toMatch(/args\(\["open", &crate::craft_window::arg\(&app\), "--native", &path\]\)/);
  });
});
