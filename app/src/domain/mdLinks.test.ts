import { describe, expect, it } from 'vitest';
import { readableLinks, safeDecode, writeLinks } from './mdLinks';

// 편집기(BlockNote)는 주소에 띄어쓰기가 든 md 링크를 첫 낱말에서 잘라 읽고(`다른 문서.md` → `다른`), 꺾쇠(<…>)로 감싼 건 온전히
// 읽지만 쓸 때 꺾쇠를 벗겨 다시 띄어쓰기로 내보낸다(2026-10-04 실측) — 읽기 전·쓴 뒤에 표준 꺾쇠로
describe('readableLinks — 읽기 전에 띄어쓰기 주소를 꺾쇠로', () => {
  it('재현: 띄어쓰기 주소·괄호 든 이름·그림·웹 주소', () => {
    expect(readableLinks('앞 [다른 문서](다른 문서.md) 뒤')).toBe('앞 [다른 문서](<다른 문서.md>) 뒤');
    expect(readableLinks('[회의](회의 (1차).md)')).toBe('[회의](<회의 (1차).md>)');
    expect(readableLinks('![그림](assets/스크린샷 2026.png)')).toBe('![그림](<assets/스크린샷 2026.png>)');
    expect(readableLinks('[웹](https://example.com/a b)')).toBe('[웹](<https://example.com/a b>)');
  });
  it('띄어쓰기 없는 주소·이미 꺾쇠·%20 은 그대로', () => {
    for (const md of ['[한글](한글이름.md)', '[a](<a b.md>)', '[a](%EB%8B%A4%20x.md)', '[괄호](a(1).md)', '[x](a\\(1.md)']) expect(readableLinks(md)).toBe(md);
  });
  it('툴팁(따옴표·괄호) 붙은 링크는 건드리지 않는다', () => {
    for (const md of ['[제목](a.md "툴팁")', "[제목](a.md '툴팁')", '[제목](a.md (툴팁))']) expect(readableLinks(md)).toBe(md);
  });
  it('코드(백틱·코드 블록) 안은 그대로', () => {
    const md = '`[코드](a b.md)` 와 [진짜](a b.md)\n\n```\n[펜스](a b.md)\n```\n\n~~~\n[물결](c d.md)\n~~~\n';
    expect(readableLinks(md)).toBe('`[코드](a b.md)` 와 [진짜](<a b.md>)\n\n```\n[펜스](a b.md)\n```\n\n~~~\n[물결](c d.md)\n~~~\n');
  });
  it('한 줄에 여럿·줄을 넘는 괄호는 안 건드림·닫는 괄호 없음', () => {
    expect(readableLinks('[a](x y.md) [b](z w.md)')).toBe('[a](<x y.md>) [b](<z w.md>)');
    expect(readableLinks('[a](x\ny.md)')).toBe('[a](x\ny.md)');
    expect(readableLinks('[a](x y.md')).toBe('[a](x y.md');
  });
  it('꺾쇠를 쓸 수 없는 주소(<·> 가 든)는 그대로', () => {
    expect(readableLinks('[a](x <y>.md)')).toBe('[a](x <y>.md)');
  });
});

describe('writeLinks — 쓸 때 띄어쓰기 주소를 꺾쇠로(다음에 읽을 때 안 잘리게), 원래 모양은 되도록 그대로', () => {
  it('편집기가 내보낸 띄어쓰기 주소 → 꺾쇠, 괄호 탈출은 꺾쇠 안에선 푼다', () => {
    expect(writeLinks('[다른 문서](다른 문서.md)\n')).toBe('[다른 문서](<다른 문서.md>)\n');
    expect(writeLinks('[회의](회의 \\(1차\\).md)\n')).toBe('[회의](<회의 (1차).md>)\n');
    expect(writeLinks('![그림](assets/스크린샷 2026.png)\n')).toBe('![그림](<assets/스크린샷 2026.png>)\n');
  });
  it('띄어쓰기 없이 짝 맞는 괄호는 탈출을 풀어 원래 모양으로(a(1).md)', () => {
    expect(writeLinks('[괄호](a\\(1\\).md)')).toBe('[괄호](a(1).md)');
    expect(writeLinks('[반쪽](a\\(1.md)')).toBe('[반쪽](a\\(1.md)'); // 짝이 안 맞으면 탈출 그대로
  });
  it('보통 주소·%20·코드 안은 그대로', () => {
    for (const md of ['[한글](한글이름.md)', '[a](%EB%8B%A4%20x.md)', '`[코드](a b.md)`', '[웹](https://example.com/a)']) expect(writeLinks(md)).toBe(md);
  });
  it('읽기 → 쓰기를 거쳐도 같은 꺾쇠 모양(두 번 감싸지 않는다)', () => {
    const once = writeLinks(readableLinks('[다른 문서](다른 문서.md)'));
    expect(writeLinks(readableLinks(once))).toBe(once);
    expect(once).toBe('[다른 문서](<다른 문서.md>)');
  });
});

describe('safeDecode — 이름에 진짜 % 가 든 파일도 깨지지 않게', () => {
  it('%20 은 풀고, 풀 수 없는 % 는 그대로', () => {
    expect(safeDecode('%EB%8B%A4%EB%A5%B8%20%EB%AC%B8%EC%84%9C.md')).toBe('다른 문서.md');
    expect(safeDecode('100% 계획.md')).toBe('100% 계획.md');
  });
});
