import { describe, expect, it } from 'vitest';
import pdfCss from './pdf.css?raw';
import mobileCss from '../mobile/mobile.css?raw';
import view from './PdfView.tsx?raw';

// 2026-11-01 사용자: 스페이스에서 PDF 를 키운 뒤 끌어서 옮기면 좌우가 안 움직이고 위아래만 됐다(가로로 긴 A4 발주서).
// ① .pdfv 가 세로 flex + align-items:center 라 페이지가 칸보다 넓어지면 양쪽으로 넘치고, 왼쪽 넘침은 스크롤로 못 가는 자리로 잘렸다
//    (하네스 250%: 페이지 왼쪽 548px 가 scrollLeft 0 에서도 화면 밖 — 폰만 .m-pdf 에서 따로 막아 뒀었다)
// ② PDF 엔 마우스로 끌어 옮기는 손이 없었다(그림만 useImagePan) — 위아래는 트랙패드 스크롤이라 됐던 것

const rules = (css: string, sel: string) => {
  const esc = sel.replace(/[.>[\]()]/g, '\\$&');
  const re = new RegExp(`(?:^|\\n|,)\\s*${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'g');
  return [...css.matchAll(re)].map((m) => m[1]).join(' ');
};

describe('PDF 를 키우면 페이지 어디든 갈 수 있다', () => {
  it('css 를 읽었다(빈 글이면 아래 검사가 헛돈다)', () => {
    expect(pdfCss.length).toBeGreaterThan(100);
    expect(view.length).toBeGreaterThan(100);
  });
  it('.pdfv 는 가운데 정렬(align-items:center)로 넘친 왼쪽을 자르지 않는다 — 가운데는 페이지의 auto 여백이 맡는다', () => {
    const box = rules(pdfCss, '.pdfv');
    expect(box).not.toMatch(/align-items:\s*center/);
    expect(box).toMatch(/align-items:\s*flex-start/);
    expect(rules(pdfCss, '.pdfv-page')).toMatch(/margin:\s*0 auto|margin-inline:\s*auto/);
  });
  it('폰도 같은 규칙을 기본에서 받는다 — 폰 쪽에서 다시 가운데 정렬로 덮지 않는다', () => {
    expect(rules(mobileCss, '.m-pdf .pdfv')).not.toMatch(/align-items:\s*center/);
  });
  it('끄는 중엔 손 커서·글 고르기 막힘, 끌 수 있을 때만 손 커서', () => {
    expect(rules(pdfCss, '.pdfv.can-pan .pdfv-page')).toMatch(/cursor:\s*grab/);
    expect(pdfCss).toMatch(/\.pdfv\.panning[^{]*\{[^}]*cursor:\s*grabbing/);
  });
});

describe('PDF 도 마우스로 끌어 옮긴다', () => {
  it('PdfView 가 그림과 같은 끌기(useImagePan)를 붙인다', () => {
    expect(view).toMatch(/import \{[^}]*useImagePan[^}]*\} from '\.\.\/imageFit'/);
    expect(view).toMatch(/useImagePan\(\s*\(\)\s*=>\s*box\.current/);
  });
  it('글자 위에서 시작한 끌기는 글 고르기로 둔다(찾기·복사용 글 층)', () => {
    expect(view).toMatch(/closest\('\.textLayer span/);
  });
});
