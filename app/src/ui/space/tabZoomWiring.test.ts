import { describe, expect, it } from 'vitest';
import app from '../../App.tsx?raw';
import view from './SpaceView.tsx?raw';
import doc from './DocPage.tsx?raw';
import sheet from './SheetPage.tsx?raw';
import file from './FileTab.tsx?raw';
import bar from './TabZoomBar.tsx?raw';
import anchor from '../zoomAnchor.ts?raw';
import preview from './Preview.tsx?raw';
import reader from '../reader/Reader.tsx?raw';
import icons from '../Icons.tsx?raw';
import css from './space.css?raw';
import tour from '../../domain/tour.ts?raw';
import skill from '../../../hq-template/.claude/skills/hq-app/SKILL.md?raw';
import { readmeEn, readmeKo } from '../readmes'; // 원본 public/ · 공개본 맨 위 둘 다

// 2026-10-12 사용자(참모-2 전달): 스페이스 탭에서 확대·축소·맞춤 — 머리 단추 · ⌘+ ⌘- ⌘0 ⌘9 · ⌘/Ctrl/Alt+휠 · 핀치. 배율은 파일마다 기억
describe('탭 확대 — 단축키(App)', () => {
  it('⌘+ ⌘- ⌘0 은 모달 → 리더 → 탭 → 글자 크기 순 — 탭이 받으면 글자 크기는 안 바뀐다', () => {
    const i = app.indexOf('previewZoomFn()) previewZoomFn()');
    const r = app.indexOf('readerZoom(sc.type');
    const t = app.indexOf("tabZoomFn()?.(sc.type === 'fontReset' ? 0 : sc.delta)");
    const f = app.indexOf("else if (sc.type === 'font') setFontSize");
    expect(i).toBeGreaterThan(0);
    expect(r).toBeGreaterThan(i);
    expect(t).toBeGreaterThan(r);
    expect(f).toBeGreaterThan(t);
  });
  it("⌘9 = 맞춤 — 확대할 탭이 떠 있을 때만(아니면 채팅 탭 9번 그대로)", () => {
    expect(app).toMatch(/if \(sc\.n === 9 && tabZoomFn\(\)\?\.\('fit'\)\) return;/);
  });
});

describe('탭 확대 — SpaceView', () => {
  it('배율은 파일(경로)마다 기억해 localStorage 에 저장', () => {
    expect(view).toMatch(/parseTabZooms\(localStorage\.getItem\(TAB_ZOOM_KEY\)\)/);
    expect(view).toMatch(/localStorage\.setItem\(TAB_ZOOM_KEY, JSON\.stringify\(tabZooms\)\)/);
    expect(view).toMatch(/withTabZoom\(m, zoomPath, nextTabZoom\(zoomPath, z, cmd,/);
  });
  it('가운데 파일 탭(d:)이고 모달이 안 떠 있을 때만 받는다 — 아니면 false 로 돌려 글자 크기로', () => {
    expect(view).toMatch(/const zoomPath = pick\.startsWith\('d:'\) && !modal \? pick\.slice\(2\) : ''/);
    expect(view).toMatch(/if \(!canZoom\) return false;/);
  });
  it('window.__tabZoom 을 걸고, 휠(⌘·Ctrl·Alt)·사파리 핀치는 기본 동작을 막고(passive false) capture 로 받는다', () => {
    expect(view).toMatch(/w\.__tabZoom = \(c\) => zoomRef\.current\(c\)/);
    expect(view).toMatch(/useWheelZoom\(\(\) => \(canZoomRef\.current \? document\.querySelector\('\.space \.cv-main'\) : null\), \(dir, at\) => zoomRef\.current\(dir, at\)\)/);
    expect(anchor).toMatch(/addEventListener\('wheel', wheel, \{ passive: false, capture: true \}\)/);
    expect(anchor).toMatch(/addEventListener\('gesturechange', gChange, \{ passive: false, capture: true \}\)/);
    expect(anchor).toMatch(/if \(wheelDir\(e\) === null \|\| !inside\(e\.target\)\) return;/);
    expect(view).toMatch(/delete w\.__tabZoom/);
  });
  it('그림 확대 기준점 — 핀치·휠은 커서 자리를 넘기고, 배율 바꾸기 직전 markAnchor·다시 그린 뒤 applyAnchor(탭·크게 보기·리더 같은 함수)', () => {
    expect(anchor).toMatch(/cb\.current\.step\(s, \{ x: e\.clientX, y: e\.clientY \}\)/);
    expect(view).toMatch(/markAnchor\(document\.querySelector<HTMLElement>\('\.space \.cv-main \.ft-body \.pv-image'\), at\)/);
    expect(file).toMatch(/useLayoutEffect\(\(\) => applyAnchor\(imgBox\.current\), \[zoom\]\)/);
    expect(preview).toMatch(/markAnchor\(imgBox\.current, at\)/);
    expect(preview).toMatch(/useLayoutEffect\(\(\) => applyAnchor\(imgBox\.current\), \[zoom\]\)/);
    expect(reader).toMatch(/markAnchor\(imgBox\(\), at\)/);
    expect(reader).toMatch(/useLayoutEffect\(\(\) => applyAnchor\(imgBox\(\)\), \[zoom\]\)/);
  });
  it('머리 단추는 지금 가운데에 떠 있는 탭에만, 세 페이지(md·엑셀·그 밖)가 배율을 받는다', () => {
    expect(view).toMatch(/const zoomUi = \(path: string\) => \(path === zoomPath && canZoom \? <TabZoomBar/);
    expect((view.match(/zoom=\{zoomOf\(path\)\}/g) ?? []).length).toBe(3);
    expect(view).toMatch(/zoomUi=\{zoomUi\(path\)\}/);
  });
});

describe('탭 확대 — 각 페이지가 배율을 그린다', () => {
  it('md·txt 편집(DocPage)·엑셀(SheetPage)은 CSS zoom, 100 이면 style 없음', () => {
    expect(doc).toMatch(/className="cv-doc-body" ref=\{bodyRef\} style=\{zoom === 100 \? undefined : \{ zoom: zoom \/ 100 \}\}/);
    expect(sheet).toMatch(/className="cv-sheet-body" style=\{zoom === 100 \? undefined : \{ zoom: zoom \/ 100 \}\}/);
  });
  it('그림·html·pdf·오피스·글 미리보기(FileTab)는 배율을 받는다 — 그림은 실제 픽셀 기준, 맞춤(0)은 창 안에', () => {
    expect(file).toMatch(/<HtmlFrame className="rd-frame" src=\{docUrl\(path\)\} zoom=\{zoom\}/);
    expect(file).toMatch(/<PdfView path=\{path\} zoom=\{zoom\} \/>/);
    expect(file).toMatch(/<OfficeDoc f=\{at\} zoom=\{zoom\}/);
    expect(file).toMatch(/const sized = kind === 'image' && zoom !== FIT && natural > 0/);
    expect(file).toMatch(/width: `\$\{natural \* zoom \/ 100\}px`/);
    expect(file).toMatch(/\{zoomUi\}/);
  });
});

describe('탭 확대 — 머리 단추', () => {
  it('축소·배율 글자(누르면 100%)·확대·맞춤 — 아이콘은 직접 그린 SVG, 이름은 aria-label·title(단축키 포함)', () => {
    expect(bar).toMatch(/onCmd\(-1\)[\s\S]*onClick=\{\(\) => onCmd\(0\)\}[\s\S]*onCmd\(1\)[\s\S]*onCmd\('fit'\)/);
    expect(bar).toMatch(/keyLabel\('⌘9', IS_WIN\)/);
    expect(bar).toMatch(/<button className="tz-pct"/);
    expect(icons).toMatch(/export const IconZoomFit = \(\) => \(\s*<svg viewBox="0 0 16 16" \{\.\.\.P\}>/);
    expect(bar).not.toMatch(/lucide/);
  });
  it('왼쪽 색 띠 없음', () => expect(css).not.toMatch(/\.tz[^{]*\{[^}]*border-left/));
});

describe('탭 확대 — 안내 글', () => {
  it('둘러보기·README·hq-app 스킬에 ⌘+ ⌘- ⌘0 ⌘9 확대', () => {
    expect(tour).toMatch(/⌘\+ · ⌘- · ⌘0/);
    expect(tour).toMatch(/⌘9 는 맞춤/); // ⌘9 는 채팅 탭 줄에 한 번만(2026-10-22 QA 22)
    for (const d of [readmeKo, readmeEn, skill]) expect(d).toMatch(/⌘9/);
  });
});
