import { describe, expect, it } from 'vitest';
import file from './space/FileTab.tsx?raw';
import view from './space/SpaceView.tsx?raw';
import preview from './space/Preview.tsx?raw';
import reader from './reader/Reader.tsx?raw';
import hooks from './imageFit.ts?raw';
import css from './space/locker.css?raw';

// 2026-10-28 사용자 "이미지 확대가 안 된다잉" — 맞춤은 작은 그림도 칸에 맞게 키우고, 두 번 누르기·끌어서 이동·작은 배율 칩. 스페이스 탭·크게 보기·리더가 같은 조각
describe('그림 칸 — 같은 조각(useImageFit·useImagePan)', () => {
  it('탭·모달·리더 모두 맞춤 배율을 재서 폭을 정한다 — 옛 "맞춤 = CSS 축소만" 코드는 없다', () => {
    for (const src of [file, preview, reader]) {
      expect(src).toMatch(/useImageFit\(/);
      expect(src).toMatch(/useImagePan\(/);
      expect(src).toMatch(/imageWidth\(natural, (zoom|z), fit\)/);
      expect(src).not.toMatch(/natural \* zoom \/ 100/);
    }
  });
  it('두 번 누르기는 맞춤 ↔ 100% 를 누른 곳 기준으로 — 탭은 SpaceView 가 배율을 쥐고 있어 onZoom 으로 올린다', () => {
    expect(file).toMatch(/toggleFitActual\(z, fit\), at/);
    expect(file).toMatch(/const own = !onZoom && kind === 'image'/); // 메신저 따로 창은 탭 배율을 쥔 쪽이 없어 여기서 휠·핀치·두 번 누르기
    expect(view).toMatch(/onZoom=\{\(z, at\) => zoomTo\(path, z, at\)\}/);
    expect(view).toMatch(/markAnchor\([^\n]*pv-image'\), at\);\n\s+setTabZooms/);
    expect(preview).toMatch(/markAnchor\(imgBox\.current, at\); setZoomTo\(toggleFitActual\(zoom, fit\)\)/);
    expect(reader).toMatch(/onImageToggle=\{\(z, at\) => \{ markAnchor\(imgBox\(\), at\); setImageZoom\(z\); \}\}/);
  });
  it('끌어서 이동은 마우스만·넘칠 때만, 정리에서 이벤트를 다 뗀다', () => {
    expect(hooks).toMatch(/e\.pointerType !== 'mouse'/);
    expect(hooks).toMatch(/!over\(\)/);
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'dblclick']) {
      expect(hooks).toContain(`addEventListener('${ev}'`);
      expect(hooks).toContain(`removeEventListener('${ev}'`);
    }
  });
  it('탭 그림엔 눌리지 않는 작은 숫자 칩(배율)이 있다', () => {
    expect(file).toMatch(/className="pv-pct"/);
    expect(css).toMatch(/\.pv-pct \{[^}]*pointer-events: none/);
    expect(css).toMatch(/\.ft-body \{ position: relative/);
  });
});
