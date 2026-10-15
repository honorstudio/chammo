import { describe, expect, it } from 'vitest';
import { backdropStyle } from './backdrop';
import view from './ChatView.tsx?raw';

// 2026-10-11 사용자(185·186.png): 입력칸에 @img3·@img4 를 넣으면 칩 하이라이트가 실제 글자 자리에서 밀려 '여기 겹치'를 덮고 빈 자리에 떴다.
// 채팅 뷰 입력칸은 테두리 0(space.css)인데 뒤판(.chat-backdrop)은 1px 그대로라 뒤판 글 폭이 2px 좁았다 — 칸 끝에 걸린 줄이 뒤판에서만
// 한 번 더 꺾여 그 뒤 칩이 전부 한 줄씩 밀렸다(하네스 chip.cjs 'edge'). CSS 를 두 곳에 손으로 맞추지 말고 입력칸 계산값을 그대로 옮긴다
const cs = (v: Record<string, string>) => (k: string) => v[k] ?? '';
const SPACE = { 'font-family': 'Pretendard', 'font-size': '14.85px', 'line-height': '21.5325px', 'letter-spacing': 'normal', 'padding-top': '8px', 'padding-right': '8px', 'padding-bottom': '8px', 'padding-left': '8px',
  'border-top-width': '0px', 'border-right-width': '0px', 'border-bottom-width': '0px', 'border-left-width': '0px', 'box-sizing': 'border-box', 'white-space': 'pre-wrap', 'overflow-wrap': 'break-word', 'word-break': 'normal', 'tab-size': '8' };

describe('입력칸 뒤판(@img 칩 칠하는 층)은 입력칸 계산값을 그대로', () => {
  it('글꼴·글 크기·줄 높이·여백·테두리 두께를 입력칸에서 — 채팅 뷰 테두리 0 이면 뒤판도 0', () => {
    const s = backdropStyle(cs(SPACE), { offsetWidth: 317, clientWidth: 317 });
    expect(s['border-left-width']).toBe('0px');
    expect(s['border-right-width']).toBe('0px');
    expect(s['font-size']).toBe('14.85px');
    expect(s['line-height']).toBe('21.5325px');
    expect(s['padding-left']).toBe('8px');
    expect(s['font-family']).toBe('Pretendard');
  });
  it('입력칸에 스크롤바가 떠서 글 폭이 줄면 뒤판 오른쪽 여백에 그만큼 더한다(줄바꿈이 같게)', () => {
    expect(backdropStyle(cs(SPACE), { offsetWidth: 317, clientWidth: 302 })['padding-right']).toBe('23px');
    expect(backdropStyle(cs({ ...SPACE, 'border-left-width': '1px', 'border-right-width': '1px' }), { offsetWidth: 319, clientWidth: 317 })['padding-right']).toBe('8px');
  });
  it('ChatView 가 쓸 때마다(글·글 크기·칸 폭·스크롤) 맞춘다', () => {
    expect(view).toMatch(/backdropStyle\(/);
    expect(view).toMatch(/new ResizeObserver\(syncBackdrop\)/);
    expect(view).toMatch(/onScroll=\{syncBackdrop\}/);
  });
});
