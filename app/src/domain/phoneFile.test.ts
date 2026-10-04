import { describe, expect, it } from 'vitest';
import { askBeforePlay, fileError, csvRows, docImgSrcOk, fileKind, prettyJson, resolveRel, sizeLabel, textHead, webParts, wordDoc } from './phoneFile';

describe('fileKind — 폰 보기 종류', () => {
  it('확장자·웹 주소로 가른다', () => {
    expect(fileKind('/u/a.PNG')).toBe('image');
    expect(fileKind('/u/a.pdf')).toBe('pdf');
    expect(fileKind('/u/a.md')).toBe('md');
    expect(fileKind('/u/a.html')).toBe('html');
    expect(fileKind('/u/a.json')).toBe('json');
    expect(fileKind('/u/a.csv')).toBe('csv');
    expect(fileKind('/u/a.tsv')).toBe('csv');
    expect(fileKind('/u/a.ts')).toBe('code');
    expect(fileKind('/u/a.txt')).toBe('text');
    expect(fileKind('/u/a.log')).toBe('text');
    expect(fileKind('https://example.com/x')).toBe('web');
    expect(fileKind('/u/a.docx')).toBe('office');
    expect(fileKind('/u/a.mov')).toBe('video');
  });
});

describe('webParts — 웹 주소 카드', () => {
  it('도메인(www 뺌)과 나머지', () => {
    expect(webParts('https://www.example.com/a/b?q=1')).toEqual({ host: 'example.com', rest: '/a/b?q=1' });
    expect(webParts('http://localhost:3000/')).toEqual({ host: 'localhost:3000', rest: '' });
    expect(webParts('이상한')).toBeNull();
  });
});

describe('csvRows — 따옴표·구분자', () => {
  it('따옴표 안 쉼표·줄바꿈·"" 를 지킨다', () => {
    expect(csvRows('a,b\n"1,2","x ""y"""\n"줄\n바꿈",3\n', ',')).toEqual([['a', 'b'], ['1,2', 'x "y"'], ['줄\n바꿈', '3']]);
  });
  it('tsv 와 줄 수 상한', () => {
    expect(csvRows('a\tb\nc\td', '\t')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(csvRows('x\n'.repeat(10), ',', 3)).toHaveLength(3);
  });
});

describe('prettyJson', () => {
  it('들여쓰기, 못 읽으면 null', () => {
    expect(prettyJson('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(prettyJson('{깨짐')).toBeNull();
  });
});

describe('resolveRel — md 속 그림 경로(서버 md_images 와 같은 규칙)', () => {
  it('상대 경로만 문서 폴더 기준으로', () => {
    expect(resolveRel('/u/docs/plan.md', './shots/a.png')).toBe('/u/docs/shots/a.png');
    expect(resolveRel('/u/docs/plan.md', '../assets/b%20c.jpg')).toBe('/u/assets/b c.jpg');
    expect(resolveRel('/u/docs/plan.md', 'https://x.com/a.png')).toBeNull();
    expect(resolveRel('/u/docs/plan.md', '/etc/a.png')).toBeNull();
    expect(resolveRel('/u/docs/plan.md', 'data:image/png;base64,x')).toBeNull();
  });
});

describe('textHead — 카드 썸네일 앞부분', () => {
  it('글은 한 덩어리로(머리표·강조 뺌), 코드는 줄 그대로 앞 12줄', () => {
    expect(textHead('# 제목\n\n**굵게** 글', false)).toBe('제목 굵게 글');
    const code = Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`).join('\n');
    expect(textHead(code, true).split('\n')).toHaveLength(12);
    expect(textHead('\tx', true)).toBe('  x');
  });
});

describe('docImgSrcOk — 폰 문서 속 그림은 상대 경로만 남긴다', () => {
  it('상대만 예, 웹·data·절대·// 는 아니오', () => {
    expect(docImgSrcOk('./shots/a.png')).toBe(true);
    expect(docImgSrcOk('img/b.jpg')).toBe(true);
    for (const s of ['https://evil.com/p.png', 'data:image/png;base64,x', '/etc/c.png', '//evil.com/x.png', 'javascript:x', '']) expect(docImgSrcOk(s)).toBe(false);
  });
});

describe('영상·오피스 — 데이터 확인과 크기 글', () => {
  it('20MB 넘으면 재생 전에 묻는다', () => {
    expect(askBeforePlay(20 * 1024 * 1024)).toBe(false);
    expect(askBeforePlay(20 * 1024 * 1024 + 1)).toBe(true);
  });
  it('크기 글', () => {
    expect(sizeLabel(900)).toBe('1KB');
    expect(sizeLabel(1536 * 1024)).toBe('1.5MB');
    expect(sizeLabel(250 * 1024 * 1024)).toBe('250MB');
  });
  it('워드만 글로', () => {
    expect(wordDoc('/u/a.DOCX')).toBe(true);
    expect(wordDoc('/u/a.doc')).toBe(true);
    expect(wordDoc('/u/a.pptx')).toBe(false);
  });
});

describe('fileError — 폰에서 파일을 못 열었을 때 한 줄', () => {
  it('없는 파일(not found)은 빨간 오류가 아니라 지워졌다고', () => {
    expect(fileError('not found')).toEqual({ text: '지워졌어요', gone: true });
  });
  it('아는 이유는 그 말, 모르는 건 서버 말 그대로', () => {
    expect(fileError('not allowed', { 'not allowed': '폰에서 열 수 없는 파일이에요' })).toEqual({ text: '폰에서 열 수 없는 파일이에요', gone: false });
    expect(fileError('boom')).toEqual({ text: '못 열었어요: boom', gone: false });
  });
});
