import { describe, expect, it } from 'vitest';
import tab from './FileTab.tsx?raw';
import space from './SpaceView.tsx?raw';
import preview from './Preview.tsx?raw';

// 2026-11-01 ux-daily M17·M18 — 채팅 뷰는 show 를 탭으로 여는데 짚기(--page·--find·--box·--line)가 md 말고는 안 넘어갔고,
// 고친 파일을 다시 show 해도 이미 열린 탭(key=경로)은 다시 안 읽어 옛 판이었다
describe('보관함 탭 — show 짚기·다시 띄우기', () => {
  it('SpaceView 가 그 파일의 짚은 곳(focus)과 마지막 show 도장(stamp)을 탭에 넘긴다', () => {
    expect(space).toMatch(/<FileTab key=\{path\} path=\{path\} focus=\{focus\?\.path === path \? focus : undefined\} stamp=\{showStamp\[path\]\}/);
    expect(space).toMatch(/setShowStamp\(\(m\) => \(\{ \.\.\.m, \[f\.path\]: f\.ts \}\)\);/);
  });
  it('PDF 쪽·html 찾기는 미리보기 모달과 같은 길로, 그림 네모는 같은 훅(useImageBox)', () => {
    expect(tab).toMatch(/<PdfView path=\{path\} zoom=\{zoom\} at=\{focus\?\.at\} atKey=\{focus\?\.key\} \/>/);
    expect(tab).toMatch(/<HtmlFrame className="rd-frame" src=\{docUrl\(path\)\} zoom=\{zoom\} point=\{focus\?\.at\} pointKey=\{focus\?\.key\} record=\{path\} \/>/);
    expect(tab).toMatch(/useImageBox\(imgBox, focus\?\.at\?\.box, \[focus\?\.key, natural, z\]\)/);
    expect(preview).toMatch(/useImageBox\(imgBox, at\?\.box, \[f\.ts, natural, zoom\]\)/);
  });
  it('도장이 바뀌면 글은 다시 읽고 그림·영상·html·pdf 는 다시 그린다', () => {
    expect(tab).toMatch(/\}, \[path, kind, stamp\]\);/);
    // 다시 불러오기 아이콘(11-05)도 같은 열쇠에 — 도장·누른 수 둘 중 하나가 바뀌면 다시 그린다
    expect(tab).toMatch(/<div className="ft-body" key=\{`\$\{stamp \?\? ''\}:\$\{reload\}`\}>/);
  });
});
