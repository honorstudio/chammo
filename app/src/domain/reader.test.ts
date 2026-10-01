import { describe, expect, it } from 'vitest';
import { docUrl, isDocUrl, dropIndex, inStrip, kindOf, titleOf, pageDoc } from './reader';

describe('kindOf — 확장자로 어떻게 보여줄지', () => {
  it('html·pdf·md·그림·나머지 글', () => {
    expect(kindOf('/a/v3.html')).toBe('html');
    expect(kindOf('/a/B.HTM')).toBe('html');
    expect(kindOf('/a/계약서.pdf')).toBe('pdf');
    expect(kindOf('/a/starter.md')).toBe('md');
    expect(kindOf('/a/shot.PNG')).toBe('image');
    expect(kindOf('/a/logo.svg')).toBe('image');
    expect(kindOf('/a/data.json')).toBe('text');
    expect(kindOf('/a/Makefile')).toBe('text');
  });
  // 2026-09-29 사용자: 리모션 영상을 띄웠는데 리더가 mp4 를 글로 읽으려 했다 → 앱 안에서 재생
  it('영상(mp4·mov·webm·m4v)은 video', () => {
    expect(kindOf('/a/project-x-promo-v1.mp4')).toBe('video');
    expect(kindOf('/a/clip.MOV')).toBe('video');
    expect(kindOf('/a/x.webm')).toBe('video');
    expect(kindOf('/a/x.m4v')).toBe('video');
  });
});

describe('kindOf — 더 많은 확장자(2026-09-30 사용자 "더 많은 확장자들도 열리게")', () => {
  it('그림·영상 확장자 더', () => {
    for (const e of ['avif', 'bmp', 'ico', 'tiff', 'heic']) expect(kindOf(`/a/x.${e}`)).toBe('image');
  });
  it('소리는 audio', () => {
    for (const e of ['mp3', 'm4a', 'wav', 'aac', 'flac']) expect(kindOf(`/a/x.${e}`)).toBe('audio');
  });
  it('워드·RTF 는 office(글자로 바꿔 보여 줌)', () => {
    for (const e of ['docx', 'doc', 'rtf', 'odt']) expect(kindOf(`/a/x.${e}`)).toBe('office');
  });
  it('코드·설정 파일은 글, 모르는 바이너리(엑셀·키노트·PSD·zip)는 other(미리보기 그림 + 기본 앱)', () => {
    for (const e of ['ts', 'tsx', 'py', 'rs', 'yml', 'csv', 'log', 'sql']) expect(kindOf(`/a/x.${e}`)).toBe('text');
    for (const e of ['xlsx', 'pptx', 'key', 'numbers', 'psd', 'zip', 'ai']) expect(kindOf(`/a/x.${e}`)).toBe('other');
  });
});

describe('titleOf — 탭 이름', () => {
  it('파일 이름, 흔한 이름(index.html·README.md)은 폴더/파일', () => {
    expect(titleOf('/x/pixel-office/v3.html')).toBe('v3.html');
    expect(titleOf('/x/pixel-office/index.html')).toBe('pixel-office/index.html');
    expect(titleOf('/x/pixel-office/README.md')).toBe('pixel-office/README.md');
  });
});

describe('dropIndex·inStrip — 탭 끌어 옮기기(열기·닫기·옮기기 자체는 Rust reader.rs Store)', () => {
  const rects: [number, number][] = [[0, 100], [100, 200], [200, 300]];
  it('탭 가운데 왼쪽이면 그 앞, 끝을 넘으면 맨 뒤', () => {
    expect(dropIndex(rects, 10)).toBe(0);
    expect(dropIndex(rects, 60)).toBe(1);
    expect(dropIndex(rects, 240)).toBe(2);
    expect(dropIndex(rects, 280)).toBe(3);
    expect(dropIndex([], 5)).toBe(0);
  });
  it('줄 위아래 24px 까지는 줄 안', () => {
    const strip = { top: 0, bottom: 36, left: 0, right: 500 };
    expect(inStrip(strip, 100, 50)).toBe(true);
    expect(inStrip(strip, 100, 70)).toBe(false);
    expect(inStrip(strip, 600, 10)).toBe(false);
  });
});

describe('docUrl — 리더 전용 주소(hodoc)', () => {
  it('한글·공백은 인코딩, 슬래시는 그대로', () => {
    expect(docUrl('/Users/h/문서 1/a b.pdf')).toBe('hodoc://localhost/Users/h/%EB%AC%B8%EC%84%9C%201/a%20b.pdf');
  });
});

describe('pageDoc — QuickLook 이 슬라이드·페이지로 보여 주는 것(짚어 보여 주기)', () => {
  it('워드·파워포인트·엑셀·키노트·페이지스', () => {
    for (const e of ['docx', 'doc', 'pptx', 'ppt', 'key', 'xlsx', 'xls', 'odp', 'pages', 'numbers']) expect(pageDoc(`/a/x.${e}`)).toBe(true);
  });
  it('그림·압축·PDF 자체는 아니다', () => {
    for (const e of ['png', 'zip', 'psd', 'pdf', 'md']) expect(pageDoc(`/a/x.${e}`)).toBe(false);
  });
});

describe('docUrl — 윈도우(WebView2 는 사용자 주소를 http://<이름>.localhost 로 바꾼다, 윈도우판 2단계)', () => {
  it('윈도우 경로는 역슬래시를 슬래시로, 드라이브 앞에 / 를 붙여 http://hodoc.localhost 로', () => {
    expect(docUrl('C:\\Users\\a\\문서 1.md', true)).toBe('http://hodoc.localhost/C%3A/Users/a/%EB%AC%B8%EC%84%9C%201.md');
  });
  it('맥은 그대로 hodoc://localhost', () => {
    expect(docUrl('/Users/a/x.md', false)).toBe('hodoc://localhost/Users/a/x.md');
  });
  it('isDocUrl — 두 모양 다 알아본다', () => {
    expect(isDocUrl(new URL('hodoc://localhost/Users/a/x.md'))).toBe(true);
    expect(isDocUrl(new URL('http://hodoc.localhost/C%3A/x.md'))).toBe(true);
    expect(isDocUrl(new URL('https://example.com/x'))).toBe(false);
  });
});
