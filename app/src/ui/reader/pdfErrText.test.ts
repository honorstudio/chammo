// PDF 를 못 열면 'PDF 를 못 열었어 — Error: Setting up fake worker failed: …' 처럼 영어 오류 원문이 화면 글로 나왔다(폰 QA 10-23).
// 화면엔 읽을 말만(다른 오류 글과 같은 '~요'), 원문은 이름표(title)로
import { describe, expect, it } from 'vitest';
import src from './PdfView.tsx?raw';

describe('PDF 못 열었을 때 글', () => {
  const line = src.split('\n').find((l) => l.includes('pdfv-msg') && l.includes('err ?')) ?? '';
  it('읽을 말 — 못 열었어요', () => expect(line).toContain("tr('PDF 를 못 열었어요', \"Couldn't open the PDF\")"));
  it('오류 원문은 화면 글이 아니라 이름표로', () => { expect(line).toContain('title={err}'); expect(line).not.toMatch(/\}\s*—\s*\{err\}/); });
});
