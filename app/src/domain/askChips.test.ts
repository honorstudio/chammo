import { describe, expect, it } from 'vitest';
import { areaRef, selRef } from './askPick';
import { splitPaths, splitRefs, withRefs } from './chat';
import { addRef, nextRefLabel } from './refChips';
import { splitTokens } from './chatTokens';

// 고른 곳 칩(#sel·#area, domain/askPick)의 받는 쪽 — 보낼 글로 풀기, 보낸 말풍선에서 다시 읽기, 입력칸 이름표(2026-11-13 사용자)
const DOC = '# 주간 점검\n\n## B 안\nB = 지금 쓰는 판매(주말 장터, **창고 재고**이 30일 전보다 줄면 새 주문 금지,';

describe('받는 쪽 — 보낼 글로 풀기와 말풍선에서 다시 읽기', () => {
  const sel = { label: '#sel1', ...selRef('/Users/me/주간.md', DOC, '창고 재고이 30일 전보다 줄면 새 주문 금지,', 'B = 지금 쓰는 판매(주말 장터, ') };
  const area1 = { label: '#area1', ...areaRef('/Users/me/shot.png', [0.12, 0.3, 0.25, 0.18]) };
  const area2 = { label: '#area2', ...areaRef('/Users/me/shot.png', [0.5, 0, 0.5, 0.5]) };
  it('#sel 은 그 자리에 "경로:줄", 끝에 [참조 #sel1 · 파일:줄 · 제목] 인용 블록 — 머리는 head(화면 이름 who 는 파일:줄만)', () => {
    expect(sel.who).toBe('주간.md:4');
    expect(withRefs('#sel1 이 조건 왜 넣었어?', [sel])).toBe(
      '#sel1 "/Users/me/주간.md:4" 이 조건 왜 넣었어?\n\n[참조 #sel1 · 주간.md:4 · B 안]\n> 창고 재고이 30일 전보다 줄면 새 주문 금지,');
  });
  it('#area 는 그 자리에 "경로" box=… 만(인용 블록 없음), 여러 개면 각자', () => {
    expect(withRefs('#area1 이랑 #area2 차이?', [area1, area2])).toBe(
      '#area1 "/Users/me/shot.png" box=0.12,0.3,0.25,0.18 이랑 #area2 "/Users/me/shot.png" box=0.5,0,0.5,0.5 차이?');
  });
  it('입력칸에서 지운 이름표는 안 간다', () => {
    expect(withRefs('그냥 질문', [sel, area1])).toBe('그냥 질문');
  });
  it('보낸 말풍선 — #sel 인용 블록을 떼어 읽는다', () => {
    const sent = withRefs('#sel1 이거', [sel]);
    expect(splitRefs(sent)).toEqual({ body: '#sel1 "/Users/me/주간.md:4" 이거', refs: [{ label: '#sel1', who: '주간.md:4 · B 안', text: '창고 재고이 30일 전보다 줄면 새 주문 금지,' }] });
  });
  it('말풍선 경로 칸 — #sel 뒤 :줄은 짚을 자리로, #area 뒤 box= 는 상자로(누르면 그 자리에 열린다)', () => {
    expect(splitPaths('#sel1 "/Users/me/주간.md:7-8" 이거')).toEqual([
      { text: '#sel1 ' }, { path: '/Users/me/주간.md', name: '주간.md:7-8', at: { line: 7, lineEnd: 8 } }, { text: ' 이거' }]);
    expect(splitPaths('#area2 "/Users/me/shot 1.png" box=0.5,0,0.5,0.5 차이?')).toEqual([
      { text: '#area2 ' }, { path: '/Users/me/shot 1.png', name: 'shot 1.png', at: { box: [0.5, 0, 0.5, 0.5] } }, { text: ' 차이?' }]);
  });
  it('#sel·#area 가 아닌 경로 끝 :숫자는 그대로 경로(파일 이름일 수 있다)', () => {
    expect(splitPaths('#file1 "/Users/me/log:12" 봐')).toEqual([{ text: '#file1 ' }, { path: '/Users/me/log:12', name: 'log:12' }, { text: ' 봐' }]);
  });
  it('box= 값이 0~1 네 개가 아니면 상자로 안 읽는다', () => {
    expect(splitPaths('#area1 "/a/b.png" box=1.5,0,0.5,0.5')).toEqual([{ text: '#area1 ' }, { path: '/a/b.png', name: 'b.png' }, { text: ' box=1.5,0,0.5,0.5' }]);
  });
});

describe('입력칸 이름표 — #sel·#area 도 칠하고 번호를 이어 준다', () => {
  it('다음 번호는 종류마다', () => {
    expect(nextRefLabel([{ label: '#area1', who: '', text: '' }, { label: '#sel1', who: '', text: '' }], 'area')).toBe('#area2');
    expect(nextRefLabel([], 'sel')).toBe('#sel1');
  });
  it('홈 미니 대화 addRef 도 head(인용 머리)를 들고 간다', () => {
    const next = addRef('', [], { kind: 'sel', who: 'a.md:3', head: 'a.md:3 · 제목', text: '고른 글', at: '"/a.md:3"' });
    expect(withRefs(`${next.draft}왜?`, next.refs)).toBe('#sel1 "/a.md:3" 왜?\n\n[참조 #sel1 · a.md:3 · 제목]\n> 고른 글');
  });
  it('홈 미니 대화 addRef 도 at 을 그대로 들고 간다', () => {
    const next = addRef('이거', [], { kind: 'area', who: 'a.png', text: 'box=0,0,1,1', at: '"/a.png" box=0,0,1,1' });
    expect(next.draft).toBe('이거 #area1 ');
    expect(withRefs(next.draft, next.refs)).toBe('이거 #area1 "/a.png" box=0,0,1,1 ');
  });
  it('입력칸 칠하기(splitTokens)가 #sel1·#area2 를 이름표로 본다', () => {
    expect(splitTokens('#sel1 와 #area2 봐').filter((t) => typeof t !== 'string')).toEqual([{ ref: '#sel1' }, { ref: '#area2' }]);
  });
});
