import { describe, expect, it } from 'vitest';
import { docUrl, dropIndex, inStrip, kindOf, titleOf } from './reader';

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
