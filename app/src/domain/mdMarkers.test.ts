import { describe, expect, it } from 'vitest';
import { keepMarkers, keepNumbers } from './mdMarkers';

// 편집기(BlockNote)는 저장할 때 목록 기호를 모두 `*`, 구분선을 `***` 로 쓴다 — `-` 로 쓴 문서는 한 글자만 고쳐도 목록 줄이 다 바뀌었다(2026-10-04 실측)
describe('keepMarkers — 목록 기호·구분선을 원래 파일 모양으로', () => {
  it('재현: `-` 목록·`---` 구분선 문서', () => {
    const orig = ['# 제목', '', '- 하나', '  - 안쪽', '- [ ] 할 일', '- [x] 한 일', '', '---', '', '끝'].join('\n');
    const next = ['# 제목', '', '* 하나', '  * 안쪽', '* [ ] 할 일', '* [x] 한 일', '', '***', '', '끝', ''].join('\n');
    expect(keepMarkers(orig, next)).toBe(orig + '\n');
  });
  it('새로 넣은 항목도 문서가 쓰던 기호로', () => {
    expect(keepMarkers('- a\n- b', '* a\n* 새것\n* b\n')).toBe('- a\n- 새것\n- b\n');
  });
  it('원래 `*`·`+` 로 쓴 줄은 그 기호 그대로(섞여 있으면 줄마다 원래 것, 새 줄은 많이 쓴 것)', () => {
    const orig = '- a\n  + 안\n- b\n- c';
    expect(keepMarkers(orig, '* a\n  * 안\n* b\n* c\n* 새\n')).toBe('- a\n  + 안\n- b\n- c\n- 새\n');
  });
  it('원래 문서에 목록·구분선이 없으면 그대로', () => {
    expect(keepMarkers('글만', '* a\n\n***\n')).toBe('* a\n\n***\n');
  });
  it('구분선 원래 모양(`___`·`* * *`)', () => {
    expect(keepMarkers('a\n\n___\n\nb', 'a\n\n***\n\nb\n')).toBe('a\n\n___\n\nb\n');
  });
  it('제목 밑줄(setext `---`)은 구분선으로 세지 않는다', () => {
    expect(keepMarkers('제목\n---\n\n본문', '## 제목\n\n본문\n\n***\n')).toBe('## 제목\n\n본문\n\n***\n');
  });
  it('코드 블록 안 `* `·`***` 줄은 안 건드린다', () => {
    const orig = '- a\n\n---\n';
    const next = '* a\n\n```\n* 코드\n***\n```\n';
    expect(keepMarkers(orig, next)).toBe('- a\n\n```\n* 코드\n***\n```\n');
  });
  it('탈출된 별(`\\*`)과 굵게(`**`)로 시작하는 줄은 목록이 아니다', () => {
    expect(keepMarkers('- a', '\\* 별\n**굵게**\n')).toBe('\\* 별\n**굵게**\n');
  });
  it('인용 안 목록도', () => {
    expect(keepMarkers('> - a\n> - b', '> * a\n> * b\n')).toBe('> - a\n> - b\n');
  });
});

// 번호 목록 — 편집기는 0. 으로 시작한 목록을 1. 부터 다시 매기고, 고친 항목 하나만 쓰면 1. 이다(2026-10-04 실측)
describe('keepNumbers — 번호 목록 번호', () => {
  it('재현: 0. 으로 시작한 목록', () => {
    expect(keepNumbers('0. 영\n1. 일', '1. 영 X\n2. 일\n')).toBe('0. 영 X\n1. 일\n');
  });
  it('고친 항목 하나만 — 앞뒤 조각 줄을 보고(그 줄은 안 바꾼다)', () => {
    expect(keepNumbers('0. 영\n1. 일', '1. X영', '', '1. 일')).toBe('0. X영');
    expect(keepNumbers('1. 가\n2. 나\n3. 다', '1. X나', '1. 가', '3. 다')).toBe('2. X나');
  });
  it('같은 줄이 있으면 그 번호, 새 항목은 앞 항목 + 1', () => {
    expect(keepNumbers('3. 셋\n4. 넷', '1. 셋\n2. 새\n3. 넷\n')).toBe('3. 셋\n4. 새\n4. 넷\n');
    expect(keepNumbers('1. a', '1. b\n2. c\n')).toBe('1. b\n2. c\n');
  });
  it('같은 글이 두 목록에 다른 번호로 — 지금 번호가 그중 하나면 그대로', () => {
    expect(keepNumbers('1. 확인\n\n문단\n\n3. 확인', '3. 확인')).toBe('3. 확인');
  });
});

// 검토 지적(2026-10-04): 첫 항목을 지우거나 맨 위에 넣으면 목록이 2. 나 0. 부터 시작했다 — 목록 첫 항목은 편집기 모델의 시작 번호(start, 없으면 1)
describe('keepNumbers — 목록 첫 항목은 편집기 시작 번호', () => {
  it('재현: 맨 위에 새 항목을 넣으면 다음 항목 - 1 = 0. 이 됐다', () => {
    expect(keepNumbers('1. a\n2. b', '1. X', '', '1. a', [1])).toBe('1. X');
  });
  it('원래 2. 였던 항목이 첫 항목이 되면 1.', () => {
    expect(keepNumbers('1. a\n2. b', '1. b', '', '', [1])).toBe('1. b');
  });
  it('0. 으로 시작하는 목록(start 0)', () => {
    expect(keepNumbers('0. 영\n1. 일', '1. X영', '', '1. 일', [0])).toBe('0. X영');
  });
  it('안쪽 번호 목록 첫 항목은 시작 번호를 안 쓴다', () => {
    expect(keepNumbers('1. a\n   1. a1', '1. a\n   1. a1', '', '', [1])).toBe('1. a\n   1. a1');
  });
});
