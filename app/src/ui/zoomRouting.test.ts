import { describe, expect, it } from 'vitest';
import app from '../App.tsx?raw';

// 2026-10-22 사용자 제보(윈도우 Ctrl +/-) — 판단은 domain/shortcuts zoomTarget·frameZoomCmd 시험에, 여기선 App 이 그 판단에 이어져 있는지만
describe('⌘+ ⌘- ⌘0 갈림 — App', () => {
  it('탭 확대는 zoomTarget 이 tab 일 때만(포커스·마지막으로 누른 곳)', () => {
    expect(app).toMatch(/zoomTarget\(zoomAreaOf\(document\.activeElement\), lastZoomArea\.current\) === 'tab' && tabZoomFn\(\)\?\.\(sc\.type === 'fontReset' \? 0 : sc\.delta\)/);
    expect(app).toMatch(/addEventListener\('pointerdown', onPointer, true\)/);
  });
  it('html 탭(iframe)이 넘긴 확대 키 — 보낸 창이 화면의 iframe 인지 보고 그 탭·미리보기 확대만(글자 크기·다른 단축키로 안 감)', () => {
    expect(app).toMatch(/const c = frameZoomCmd\(e\.data\);/);
    expect(app).toMatch(/f\.contentWindow === e\.source/);
    expect(app).toMatch(/if \(!fast\(JSON\.stringify\(same\), Date\.now\(\)\)\) return;/); // 맥 메뉴 ⌘+ 와 겹쳐 두 번 커지지 않게
    expect(app).toMatch(/if \(from\.closest\('\.dash-preview'\)\) previewZoomFn\(\)\?\.\(c\);\s*else if \(from\.closest\('\.space \.cv-main'\)\) tabZoomFn\(\)\?\.\(c\);/);
  });
});
