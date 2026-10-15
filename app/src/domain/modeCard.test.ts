import { describe, expect, it } from 'vitest';
import { cardView } from './modeCard';

// 고르기 카드 그림(10/12 사용자) — chammo.json card(Svg 글·모드 폴더 그림) 먼저, 없으면 마지막으로 그려진 칸, 없으면 자리표시
describe('cardView — 카드 그림 고르기', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#36c"/></svg>';
  it('Svg 는 거른 뒤 data: 그림으로', () => {
    const v = cardView({ kind: 'svg', svg });
    expect(v?.kind).toBe('img');
    expect(v && v.kind === 'img' && decodeURIComponent(v.src.replace('data:image/svg+xml;charset=utf-8,', ''))).toBe(svg);
  });
  it('거름에 걸린 Svg 는 자리표시(null)', () => {
    expect(cardView({ kind: 'svg', svg: '<svg><script>alert(1)</script></svg>' })).toBeNull();
    expect(cardView({ kind: 'svg', svg: '<svg onload="x()"/>' })).toBeNull();
  });
  it('그림은 data:image png·jpeg·webp 만', () => {
    expect(cardView({ kind: 'img', src: 'data:image/png;base64,iVBORw==' })).toEqual({ kind: 'img', src: 'data:image/png;base64,iVBORw==' });
    expect(cardView({ kind: 'img', src: 'https://evil.example/x.png' })).toBeNull();
    expect(cardView({ kind: 'img', src: 'data:text/html;base64,PHNjcmlwdD4=' })).toBeNull();
  });
  it('칸 트리는 그리기 트리로 고쳐서', () => {
    const v = cardView({ kind: 'tree', tree: { type: 'Box', props: {}, children: [{ type: 'Text', props: {}, children: ['우유'] }] } });
    expect(v?.kind).toBe('tree');
  });
  it('모르는 모양·빈 값은 자리표시', () => {
    expect(cardView(null)).toBeNull();
    expect(cardView({ kind: 'video', src: 'x' })).toBeNull();
    expect(cardView({ kind: 'tree', tree: 'x' })).toBeNull();
  });
});
