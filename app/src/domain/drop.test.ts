import { describe, expect, it } from 'vitest';
import { dropText, paneAt, shellEscape, docDropBlocks, dropSlot } from './drop';

describe('shellEscape — iTerm 처럼 경로를 백슬래시로 이스케이프', () => {
  it('평범한 경로는 그대로', () => {
    expect(shellEscape('/Users/a/Desktop/shot.png')).toBe('/Users/a/Desktop/shot.png');
  });
  it('공백은 \\ 로 — macOS 스크린샷 이름', () => {
    expect(shellEscape('/Users/a/Desktop/스크린샷 2026-09-27 오후 7.09.02.png')).toBe(
      '/Users/a/Desktop/스크린샷\\ 2026-09-27\\ 오후\\ 7.09.02.png',
    );
  });
  it('한글은 건드리지 않는다', () => {
    expect(shellEscape('/Users/a/바탕화면/사진.jpg')).toBe('/Users/a/바탕화면/사진.jpg');
  });
  it('셸 특수문자는 전부 앞에 \\', () => {
    expect(shellEscape(`/a/b (1)&'"$!;*?[]{}|<>#~^\`\\=.png`)).toBe(
      `/a/b\\ \\(1\\)\\&\\'\\"\\$\\!\\;\\*\\?\\[\\]\\{\\}\\|\\<\\>\\#\\~\\^\\\`\\\\=.png`,
    );
  });
  it('탭도 이스케이프', () => {
    expect(shellEscape('/a/x\ty.png')).toBe('/a/x\\\ty.png');
  });
  it('줄바꿈이 섞이면 $\'…\' 로 — 입력칸에서 Enter 로 먹히지 않게', () => {
    expect(shellEscape("/a/x\ny'z.png")).toBe("$'/a/x\\ny\\'z.png'");
  });
});

describe('dropText — 여러 개는 공백으로, 끝에 공백 하나(이어서 쓰기 좋게)', () => {
  it('하나', () => {
    expect(dropText(['/a/b c.png'])).toBe('/a/b\\ c.png ');
  });
  it('여러 개', () => {
    expect(dropText(['/a/1.png', '/a/스크린샷 2.png'])).toBe('/a/1.png /a/스크린샷\\ 2.png ');
  });
  it('없으면 빈 글자', () => {
    expect(dropText([])).toBe('');
  });
});

describe('paneAt — 드롭한 점이 어느 칸인가', () => {
  const panes = [
    { id: 'a', left: 0, top: 0, right: 100, bottom: 100 },
    { id: 'b', left: 100, top: 0, right: 200, bottom: 100 },
    { id: 'c', left: 0, top: 100, right: 200, bottom: 200 },
  ];
  it('안쪽 점은 그 칸', () => {
    expect(paneAt(panes, 50, 50)).toBe('a');
    expect(paneAt(panes, 150, 20)).toBe('b');
    expect(paneAt(panes, 10, 150)).toBe('c');
  });
  it('경계는 왼쪽·위 칸이 가진다(오른쪽·아래 끝은 제외)', () => {
    expect(paneAt(panes, 100, 50)).toBe('b');
    expect(paneAt(panes, 50, 100)).toBe('c');
  });
  it('어느 칸도 아니면(사이드바·작업 패널 위) null', () => {
    expect(paneAt(panes, 250, 50)).toBeNull();
    expect(paneAt(panes, -1, 50)).toBeNull();
    expect(paneAt([], 10, 10)).toBeNull();
  });
  it('겹치면 나중 것(위에 그려진 것)', () => {
    expect(paneAt([...panes, { id: 'top', left: 40, top: 40, right: 60, bottom: 60 }], 50, 50)).toBe('top');
  });
});

describe('docDropBlocks — 문서 편집기에 끌어다 놓은 파일의 블록 종류', () => {
  it('그림·영상·소리는 그 블록, 나머지(PDF·문서·압축)는 파일 블록', () => {
    expect(docDropBlocks(['/a/b.PNG', '/a/c.mp4', '/a/d.mp3', '/a/e.pdf', 'C:\\x\\f.zip'])).toEqual([
      { path: '/a/b.PNG', type: 'image' },
      { path: '/a/c.mp4', type: 'video' },
      { path: '/a/d.mp3', type: 'audio' },
      { path: '/a/e.pdf', type: 'file' },
      { path: 'C:\\x\\f.zip', type: 'file' },
    ]);
  });
  it('빈 목록은 빈 배열', () => {
    expect(docDropBlocks([])).toEqual([]);
  });
});

describe('dropSlot — 문서에 놓을 자리(가장 가까운 블록의 위/아래)', () => {
  const blocks = [
    { id: 'a', top: 0, bottom: 40 },
    { id: 'b', top: 50, bottom: 90 },
    { id: 'c', top: 100, bottom: 140 },
  ];
  it('블록 위쪽 절반이면 그 앞, 아래쪽 절반이면 그 뒤', () => {
    expect(dropSlot(blocks, 55)).toEqual({ id: 'b', place: 'before', y: 50 });
    expect(dropSlot(blocks, 85)).toEqual({ id: 'b', place: 'after', y: 90 });
  });
  it('블록 사이 빈 곳은 가까운 쪽 블록에 붙는다', () => {
    expect(dropSlot(blocks, 43)).toEqual({ id: 'a', place: 'after', y: 40 });
    expect(dropSlot(blocks, 48)).toEqual({ id: 'b', place: 'before', y: 50 });
  });
  it('맨 위보다 위면 첫 블록 앞, 맨 아래보다 아래면 마지막 블록 뒤', () => {
    expect(dropSlot(blocks, -20)).toEqual({ id: 'a', place: 'before', y: 0 });
    expect(dropSlot(blocks, 400)).toEqual({ id: 'c', place: 'after', y: 140 });
  });
  it('겹치면(목록 속 블록) 안쪽 작은 블록', () => {
    expect(dropSlot([{ id: 'list', top: 0, bottom: 100 }, { id: 'child', top: 60, bottom: 80 }], 75)).toEqual({ id: 'child', place: 'after', y: 80 });
  });
  it('블록이 없으면 null', () => {
    expect(dropSlot([], 10)).toBeNull();
  });
});
